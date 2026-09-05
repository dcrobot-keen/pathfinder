"""Validation for zip package uploads:
1. Multi-scan Project Group zip with group_alignment.json -> unpacked into groups/ and prepared
2. Single-scan zip with scan.usdz and floorplan.png/json -> unpacked into projects/uploads/
Run directly:
    python tests/test_zip_pipeline.py
"""
from __future__ import annotations

import io
import json
import os
import sys
import tempfile
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from fastapi.testclient import TestClient

def check(cond: bool, msg: str) -> None:
    if not cond:
        raise AssertionError(msg)
    print(f"  ok  {msg}")

def test_zip_handling() -> None:
    from server.app import app
    from studio.project import PROJECTS_ROOT
    from studio.groups import groups_root

    c = TestClient(app)

    # 1. Test Project Group Zip (contains group_alignment.json)
    group_zip_buf = io.BytesIO()
    with zipfile.ZipFile(group_zip_buf, "w") as z:
        z.writestr(
            "group_alignment.json",
            json.dumps({
                "format": "scan-group-alignment-v1",
                "group": "test_group_zip",
                "reference": "scan_1",
                "alignments": {}
            })
        )
        z.writestr("scan_1/dummy.txt", "scan 1 content")
    group_zip_buf.seek(0)

    res = c.post(
        "/api/projects/test_group_zip/process",
        files={"scan_file": ("test_group_zip.zip", group_zip_buf.getvalue(), "application/zip")}
    )
    check(res.status_code == 202, f"group zip upload status 202: got {res.status_code}")
    body = res.json()
    check(body.get("type") == "group", f"recognized as group: {body}")
    check(body.get("group") == "test_group_zip", f"group name preserved: {body}")
    check((groups_root() / "test_group_zip" / "group_alignment.json").exists(), "group_alignment.json unpacked to groups_root")

    # 2. Test Single Scan Zip (contains scan.usdz + floorplan)
    single_zip_buf = io.BytesIO()
    with zipfile.ZipFile(single_zip_buf, "w") as z:
        z.writestr("scan.usdz", "PXR-USDC\x00dummy")
        z.writestr("floorplan.png", "PNGdummy")
        z.writestr("floorplan.json", json.dumps({"format_version": 2, "width_px": 10, "height_px": 10, "resolution_meters_per_pixel": 0.05, "origin_x": 0, "origin_top_z": 0}))
        z.writestr("poses/poses.jsonl", '{"timestamp": 0, "transform": [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]}\n')
    single_zip_buf.seek(0)

    res2 = c.post(
        "/api/projects/test_single_zip/process",
        files={"scan_file": ("test_single_zip.zip", single_zip_buf.getvalue(), "application/zip")}
    )
    check(res2.status_code in (202, 409), f"single zip upload accepted: got {res2.status_code}")
    body2 = res2.json()
    check(body2.get("type") == "single", f"recognized as single: {body2}")
    proj_dir = PROJECTS_ROOT / "test_single_zip"
    check((proj_dir / "uploads" / "scan.usdz").exists(), "scan.usdz unpacked to uploads/")
    check((proj_dir / "floorplan.png").exists(), "floorplan.png copied to project_dir")
    check((proj_dir / "floorplan.json").exists(), "floorplan.json copied to project_dir")

    # Clean up test artifacts
    import shutil
    if (groups_root() / "test_group_zip").exists():
        shutil.rmtree(groups_root() / "test_group_zip", ignore_errors=True)
    if proj_dir.exists():
        shutil.rmtree(proj_dir, ignore_errors=True)

if __name__ == "__main__":
    test_zip_handling()
    print("all zip_pipeline checks passed")
