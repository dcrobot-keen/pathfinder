"""On-disk job-status contract for `projects/<name>/status.json`.

Written by `studio.pipeline.run_pipeline`'s API-side progress callback
(server/jobs.py), read by the API's `GET /api/projects/{name}/status` and by
`studio.project.list_projects`. Kept in `studio/` (not `server/`) so it has
no dependency on FastAPI -- the CLI path never needs a web framework
installed (PLAN.md section 7-1's offline/air-gapped constraint).

Canonical step keys, in pipeline order:
    import, preprocess, rasterize, registration, classify, vectorize, viewer

Each step's value is one of: "pending" | "active" | "done" | "skip" | "error".
`registration`/`classify` are "skip" when `--robot-map`/`--classify` wasn't
requested for that run -- this matches the web UI's StepRail "skip" dot.
"""
from __future__ import annotations

import json
import os
import tempfile
from pathlib import Path

STEP_KEYS = ("import", "preprocess", "rasterize", "registration", "classify", "vectorize", "viewer")

STATUS_FILENAME = "status.json"


def _status_path(project_dir: str | Path) -> Path:
    return Path(project_dir) / STATUS_FILENAME


def write_status(
    project_dir: str | Path,
    phase: str,
    steps: dict[str, str],
    log_line: str | None = None,
    error: str | None = None,
) -> None:
    """Atomically write status.json (write-to-temp then os.replace), so a
    concurrent GET never observes a truncated/partial JSON file.

    `phase` is one of "running" | "done" | "error". `log_line`, if given, is
    appended to the persisted rolling log (capped to the most recent 200
    lines -- plenty for the UI's LogConsole, small enough to stay cheap to
    read/write every progress tick).
    """
    project_dir = Path(project_dir)
    path = _status_path(project_dir)

    existing = read_status(project_dir)
    log = existing.get("log", [])
    if log_line is not None:
        log = [*log, log_line][-200:]

    payload = {
        "phase": phase,
        "steps": steps,
        "log": log,
        "error": error,
    }

    fd, tmp_name = tempfile.mkstemp(dir=str(project_dir), prefix=".status.", suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False)
        os.replace(tmp_name, path)
    except BaseException:
        try:
            os.unlink(tmp_name)
        except OSError:
            pass
        raise


def read_status(project_dir: str | Path) -> dict:
    """Read status.json, or an empty "no job has ever run" shape if absent."""
    path = _status_path(project_dir)
    if not path.exists():
        return {"phase": None, "steps": {}, "log": [], "error": None}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        # Extremely narrow race (read landing between temp-write crash and a
        # retry) -- report as unknown rather than raising into a poll loop.
        return {"phase": None, "steps": {}, "log": [], "error": None}


def initial_steps(*, has_robot_map: bool, classify: bool) -> dict[str, str]:
    """The starting `steps` dict for a fresh run, honoring which optional
    stages this run will actually perform."""
    steps = {key: "pending" for key in STEP_KEYS}
    if not has_robot_map:
        steps["registration"] = "skip"
    if not classify:
        steps["classify"] = "skip"
    return steps
