"""Background execution of studio.pipeline.run_pipeline for the API.

A plain threading.Thread per job, not FastAPI BackgroundTasks: the API needs
to reject a second /process call for a project that's already running
(re-entrancy guard), which requires tracking thread identity either way, and
progress is polled by later, unrelated requests -- not tied to the request
that started the job.

`status.json` (studio.status) is the single source of truth for job state;
this module keeps only an in-memory `{name: Thread}` liveness guard, never a
mirrored copy of status content.
"""
from __future__ import annotations

import threading
import traceback
from pathlib import Path

from studio.pipeline import run_pipeline
from studio.status import initial_steps, write_status

_running: dict[str, threading.Thread] = {}
_lock = threading.RLock()  # RLock: start_process_job calls is_running() while already holding _lock


def is_running(name: str) -> bool:
    with _lock:
        thread = _running.get(name)
        return thread is not None and thread.is_alive()


def start_process_job(
    name: str,
    project_dir: Path,
    usdz_path: Path,
    robot_map_prefix: Path | None,
    trajectory_path: Path | None,
    remove_isolated_clusters: bool,
    isolated_cluster_min_area: float,
    classify: bool,
) -> None:
    """Start (or raise if already running) the pipeline for `name` in a
    background thread."""
    with _lock:
        if is_running(name):
            raise RuntimeError(f"a processing job is already running for project {name!r}")

        steps = initial_steps(has_robot_map=robot_map_prefix is not None, classify=classify)
        write_status(project_dir, phase="running", steps=steps, log_line="처리 시작")

        thread = threading.Thread(
            target=_run,
            args=(
                name,
                project_dir,
                usdz_path,
                robot_map_prefix,
                trajectory_path,
                remove_isolated_clusters,
                isolated_cluster_min_area,
                classify,
                dict(steps),
            ),
            daemon=True,
        )
        _running[name] = thread
        thread.start()


def _run(
    name: str,
    project_dir: Path,
    usdz_path: Path,
    robot_map_prefix: Path | None,
    trajectory_path: Path | None,
    remove_isolated_clusters: bool,
    isolated_cluster_min_area: float,
    classify: bool,
    steps: dict[str, str],
) -> None:
    def on_progress(step_key: str, status: str, data: dict) -> None:
        if status in ("active", "done", "skip", "error"):
            steps[step_key] = status
        log_line = _format_log_line(step_key, status, data)
        write_status(project_dir, phase="running", steps=dict(steps), log_line=log_line)

    try:
        run_pipeline(
            project_dir,
            usdz_path,
            robot_map_prefix=robot_map_prefix,
            trajectory_path=trajectory_path,
            remove_isolated_clusters=remove_isolated_clusters,
            isolated_cluster_min_area=isolated_cluster_min_area,
            classify=classify,
            on_progress=on_progress,
        )
        write_status(project_dir, phase="done", steps=dict(steps), log_line="처리 완료")
    except Exception as exc:  # noqa: BLE001 -- must not let this vanish silently in a bg thread
        tb = traceback.format_exc()
        # Flip whichever step was in flight to "error" so the UI's step rail
        # shows a red dot at the failure point, not just the top-level pill.
        for key, value in steps.items():
            if value == "active":
                steps[key] = "error"
        write_status(
            project_dir,
            phase="error",
            steps=dict(steps),
            log_line=f"오류: {exc}",
            error=tb,
        )


def _format_log_line(step_key: str, status: str, data: dict) -> str:
    label = {
        "import": "가져오기",
        "preprocess": "전처리",
        "rasterize": "래스터화",
        "registration": "정합",
        "classify": "분류",
        "vectorize": "벡터화",
        "viewer": "뷰어/리포트 생성",
    }.get(step_key, step_key)
    if status == "active":
        return f"{label} 시작"
    if status == "skip":
        return f"{label} 건너뜀"
    if status == "done":
        parts = ", ".join(f"{k}={v}" for k, v in data.items() if v is not None)
        return f"{label} 완료" + (f" ({parts})" if parts else "")
    return f"{label}: {status}"
