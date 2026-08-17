"""Coordinate-correction handlers: align an externally-sourced GeoJSON or
raster image onto a project's own output.geojson (PLAN.md "좌표 보정").

Split out of server/app.py the way server/jobs.py splits off pipeline-job
orchestration -- these handlers are self-contained (no background threading,
just "read an upload, build a viewer HTML, write it to the project dir") and
don't need to live inline in app.py's route table. Unlike jobs.py there's no
job/status.json involved: building the picker HTML is synchronous and fast
enough to run inline in the request.
"""
from __future__ import annotations

import io
import json
from pathlib import Path

from fastapi import HTTPException, UploadFile
from PIL import Image

from studio.geojson_align_viewer_html import build_geojson_alignment_viewer_html
from studio.image_align import world_file_extension
from studio.image_align_viewer_html import build_image_alignment_viewer_html

MAX_DISPLAY_DIM = 1600  # matches scripts/align_image.py's --max-display-dim default


def _load_base_geojson(name: str, project_dir: Path) -> dict:
    base_path = project_dir / "output.geojson"
    if not base_path.exists():
        raise HTTPException(status_code=400, detail=f"project {name!r} has no output.geojson yet -- process it first")
    return json.loads(base_path.read_text(encoding="utf-8"))


async def align_geojson(name: str, project_dir: Path, geojson: UploadFile) -> dict:
    base_geojson = _load_base_geojson(name, project_dir)
    incoming_geojson = json.loads((await geojson.read()).decode("utf-8"))

    html = build_geojson_alignment_viewer_html(
        base_geojson,
        incoming_geojson,
        title=f"{name} — GeoJSON 좌표 보정",
    )
    (project_dir / "align_geojson.html").write_text(html, encoding="utf-8")
    return {"url": "align_geojson.html"}


async def align_image(name: str, project_dir: Path, image: UploadFile) -> dict:
    base_geojson = _load_base_geojson(name, project_dir)
    image_bytes = await image.read()

    # Downscale large images for embedding only -- ported from
    # scripts/align_image.py. The exported world file still describes the
    # *original* pixel grid; build_image_alignment_viewer_html's
    # display_scale is what lets the viewer correct for the downscale.
    with Image.open(io.BytesIO(image_bytes)) as im:
        im = im.convert("RGB")
        original_max_dim = max(im.size)
        display_scale = 1.0
        if original_max_dim > MAX_DISPLAY_DIM:
            display_scale = MAX_DISPLAY_DIM / original_max_dim
            display_size = (max(int(im.width * display_scale), 1), max(int(im.height * display_scale), 1))
            im = im.resize(display_size, Image.LANCZOS)
        buf = io.BytesIO()
        im.save(buf, format="PNG")
        display_bytes = buf.getvalue()

    html = build_image_alignment_viewer_html(
        base_geojson,
        display_bytes,
        image_mime="image/png",
        display_scale=display_scale,
        world_file_ext=world_file_extension(image.filename or "image.png"),
        title=f"{name} — 이미지 좌표 보정 (지오레퍼런싱)",
    )
    (project_dir / "align_image.html").write_text(html, encoding="utf-8")
    return {"url": "align_image.html"}
