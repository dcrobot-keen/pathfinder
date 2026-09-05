"""FastAPI wrapper around the existing scan-to-map-studio pipeline.

Run with:
    pip install -r requirements-server.txt
    python -m uvicorn server.app:app --reload --port 8000

This module only orchestrates HTTP <-> studio.*; all actual pipeline logic
lives in studio/ (pipeline.py, project.py, status.py), which has zero
dependency on FastAPI so the CLI/offline install path is unaffected.
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.staticfiles import StaticFiles

from studio.project import PROJECTS_ROOT, create_project, list_projects
from studio.status import read_status, write_status
from server.align import align_geojson, align_image
from server.groups_api import router as groups_router
from server.jobs import is_running, start_process_job

app = FastAPI(title="scan-to-map-studio API")
app.include_router(groups_router)  # scan groups + alignment workspace (studio/groups.py)


@app.on_event("startup")
def _reconcile_stale_jobs() -> None:
    """A server restart mid-job kills the background thread but leaves
    status.json saying phase="running" forever -- the UI would poll that
    stale file and show a spinner indefinitely. Flip any such project to
    an explicit error on startup instead."""
    if not PROJECTS_ROOT.exists():
        return
    for proj_dir in PROJECTS_ROOT.iterdir():
        if not proj_dir.is_dir():
            continue
        status = read_status(proj_dir)
        if status["phase"] == "running":
            write_status(
                proj_dir,
                phase="error",
                steps=status["steps"],
                log_line="서버 재시작으로 중단됨",
                error="interrupted by server restart",
            )


@app.get("/api/projects")
def api_list_projects() -> list[dict]:
    return list_projects()


@app.post("/api/projects")
def api_create_project(name: str = Form(...)) -> dict:
    try:
        create_project(name)
    except FileExistsError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return {"name": name}


@app.post("/api/projects/{name}/process", status_code=202)
async def api_process_project(
    name: str,
    usdz: UploadFile = File(...),
    robot_map_pgm: UploadFile | None = File(None),
    robot_map_yaml: UploadFile | None = File(None),
    trajectory: UploadFile | None = File(None),
    remove_isolated_clusters: bool = Form(False),
    isolated_cluster_min_area: float = Form(0.3),
    classify: bool = Form(False),
) -> dict:
    project_dir = PROJECTS_ROOT / name
    if not project_dir.exists():
        raise HTTPException(status_code=404, detail=f"project not found: {name}")
    if is_running(name):
        raise HTTPException(status_code=409, detail=f"a processing job is already running for project {name!r}")

    uploads_dir = project_dir / "uploads"
    uploads_dir.mkdir(parents=True, exist_ok=True)

    usdz_path = uploads_dir / (usdz.filename or "scan.usdz")
    usdz_path.write_bytes(await usdz.read())

    robot_map_prefix = None
    if robot_map_pgm is not None and robot_map_yaml is not None:
        pgm_path = uploads_dir / "robot_map.pgm"
        yaml_path = uploads_dir / "robot_map.yaml"
        pgm_path.write_bytes(await robot_map_pgm.read())
        yaml_path.write_bytes(await robot_map_yaml.read())
        robot_map_prefix = uploads_dir / "robot_map"

    trajectory_path = None
    if trajectory is not None:
        trajectory_path = uploads_dir / "trajectory.json"
        trajectory_path.write_bytes(await trajectory.read())

    try:
        start_process_job(
            name,
            project_dir,
            usdz_path,
            robot_map_prefix,
            trajectory_path,
            remove_isolated_clusters,
            isolated_cluster_min_area,
            classify,
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc

    return {"status": "started"}


@app.get("/api/projects/{name}/status")
def api_get_status(name: str) -> dict:
    project_dir = PROJECTS_ROOT / name
    if not project_dir.exists():
        raise HTTPException(status_code=404, detail=f"project not found: {name}")
    return read_status(project_dir)


@app.post("/api/projects/{name}/align/geojson")
async def api_align_geojson(name: str, geojson: UploadFile = File(...)) -> dict:
    project_dir = PROJECTS_ROOT / name
    if not project_dir.exists():
        raise HTTPException(status_code=404, detail=f"project not found: {name}")
    return await align_geojson(name, project_dir, geojson)


@app.post("/api/projects/{name}/align/image")
async def api_align_image(name: str, image: UploadFile = File(...)) -> dict:
    project_dir = PROJECTS_ROOT / name
    if not project_dir.exists():
        raise HTTPException(status_code=404, detail=f"project not found: {name}")
    return await align_image(name, project_dir, image)


# Serve every project's files (map.png, viewer.html, output.geojson, overlay.glb,
# report.json, ...) directly -- no route needed to shuttle large binaries
# through JSON. Mounted once at the root, not per-project, since a
# per-project mount would have to exist before the project's directory does.
PROJECTS_ROOT.mkdir(parents=True, exist_ok=True)
app.mount("/files", StaticFiles(directory=str(PROJECTS_ROOT)), name="files")
