"""studio/floorplan.py -- app floor image loading, slice-plane extent, and
compositing several scans' floor images by their ScanAlignment onto the
merged slice grid. Synthetic 4x4 px images so every pixel is checkable.
    python tests/test_floorplan.py
"""
from __future__ import annotations

import json
import math
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import numpy as np
from PIL import Image

from studio.floorplan import FLOOR_FORMAT, FloorPlan, composite_floorplans, floor_meta, load_floorplan, save_floor
from studio.merge_slicemaps import CODE_FREE, GroupAlignment, ScanAlignment, Slice


def check(cond: bool, msg: str) -> None:
    if not cond:
        raise AssertionError(msg)
    print(f"  ok  {msg}")


def solid(w: int, h: int, rgba) -> np.ndarray:
    img = np.zeros((h, w, 4), dtype=np.uint8)
    img[...] = rgba
    return img


def test_extent_and_payload() -> None:
    # 4x4 px @ 0.5 m, origin_x 0, top z -2 -> x in [0,2], z in [-2,0] -> y in [0,2]
    fp = FloorPlan(image=solid(4, 4, (255, 0, 0, 255)), resolution=0.5, origin_x=0.0, origin_top_z=-2.0)
    check(fp.extent_xy() == (0.0, 0.0, 2.0, 2.0), "extent in the slice plane flips z to y")
    p = fp.payload()
    check(p["dataUrl"].startswith("data:image/png;base64,") and p["width"] == 4 and p["originTopZ"] == -2.0, "payload carries data URL + meta")


def test_load_roundtrip() -> None:
    with tempfile.TemporaryDirectory() as td:
        d = Path(td)
        Image.fromarray(solid(3, 2, (0, 255, 0, 255)), "RGBA").save(d / "floorplan.png")
        (d / "floorplan.json").write_text(json.dumps({
            "format_version": 2, "width_px": 3, "height_px": 2, "resolution_meters_per_pixel": 0.05,
            "origin_x": -1.0, "origin_top_z": -0.5,
        }), encoding="utf-8")
        fp = load_floorplan(d)
        check(fp is not None and fp.width == 3 and fp.height == 2 and fp.origin_x == -1.0, "load_floorplan reads png + json")
        # app background (opaque grey, sampled at the corner) -> transparent; other pixels untouched
        img = solid(3, 2, (205, 205, 205, 255)); img[1, 1] = (10, 20, 30, 255)
        Image.fromarray(img, "RGBA").save(d / "floorplan.png")
        fp = load_floorplan(d)
        check(fp.image[0, 0, 3] == 0 and fp.image[1, 1, 3] == 255 and tuple(fp.image[1, 1, :3]) == (10, 20, 30), "background colour becomes alpha 0")
        check(load_floorplan(d, background_to_alpha=False).image[0, 0, 3] == 255, "background_to_alpha=False keeps it")
        (d / "floorplan.json").write_text(json.dumps({"format_version": 1, "resolution_meters_per_pixel": 0.05, "origin_x": 0, "origin_top_z": 0}), encoding="utf-8")
        check(load_floorplan(d) is None, "format_version 1 is refused (rows ran the other way)")
        check(load_floorplan(d / "nope") is None, "missing files -> None")


def test_composite_places_scans_by_alignment() -> None:
    red = FloorPlan(image=solid(4, 4, (255, 0, 0, 255)), resolution=0.5, origin_x=0.0, origin_top_z=-2.0)   # x 0..2, y 0..2
    blue = FloorPlan(image=solid(4, 4, (0, 0, 255, 255)), resolution=0.5, origin_x=0.0, origin_top_z=-2.0)  # same local footprint
    # scan B is placed 2 m to +x in the reference frame (ARKit offsetX 2, no yaw)
    ga = GroupAlignment(reference="A", alignments={"B": ScanAlignment(offsetX=2.0, offsetZ=0.0, yawRadians=0.0)})
    target = Slice(codes=np.full((4, 8), CODE_FREE, dtype=np.uint8), resolution=0.5, origin=(0.0, 0.0), z=0.18, band=0.05)
    img = composite_floorplans({"A": red, "B": blue}, ga, target)
    check(img.shape == (4, 8, 4), "composite has the target grid shape (rows, cols, 4)")
    # image row 0 = max y. Pixel at world (0.75, 0.75) -> col 1, grid row 1 -> image row rows-1-1 = 2
    check(tuple(img[2, 1]) == (255, 0, 0, 255), "reference floor lands where its extent says")
    check(tuple(img[2, 5]) == (0, 0, 255, 255), "scan B is shifted +2 m by its alignment")
    check(img[2, 5, 3] == 255 and img[0, 0, 3] == 255, "fully covered cells are opaque")

    # yaw 90deg CCW about the origin, then translate (offsetX, -offsetZ) = (4, 0):
    # local (x, y) in [0,2]^2 -> [x', y'] = R(90)[x,y] + [4,0] = [4 - y, x] -> x' in [2,4], y' in [0,2]
    ga2 = GroupAlignment(reference="A", alignments={"B": ScanAlignment(offsetX=4.0, offsetZ=0.0, yawRadians=math.radians(90))})
    img2 = composite_floorplans({"A": red, "B": blue}, ga2, target)
    check(tuple(img2[2, 5]) == (0, 0, 255, 255), "rotated scan B still covers x 2..4")
    # a half-transparent scan composited over the reference blends
    semi = FloorPlan(image=solid(4, 4, (0, 0, 255, 128)), resolution=0.5, origin_x=0.0, origin_top_z=-2.0)
    ga3 = GroupAlignment(reference="A", alignments={"B": ScanAlignment(offsetX=0.0, offsetZ=0.0, yawRadians=0.0)})
    img3 = composite_floorplans({"A": red, "B": semi}, ga3, target)
    px = img3[2, 1]
    check(100 < px[0] < 160 and 100 < px[2] < 160 and px[3] == 255, f"alpha 'over' blend of B on A: {tuple(px)}")


def test_save_floor_and_meta() -> None:
    target = Slice(codes=np.full((4, 8), CODE_FREE, dtype=np.uint8), resolution=0.5, origin=(-1.0, 3.0), z=0.18, band=0.05)
    img = solid(8, 4, (1, 2, 3, 255))
    meta = floor_meta(target, img)
    check(meta["format"] == FLOOR_FORMAT and meta["origin"] == [-1.0, 3.0] and meta["width_px"] == 8 and meta["height_px"] == 4, "floor meta = slice grid placement")
    with tempfile.TemporaryDirectory() as td:
        png, js = save_floor(Path(td) / "m.floor.png", Path(td) / "m.floor.json", img, target)
        with Image.open(png) as im:
            check(im.size == (8, 4), "saved PNG has the grid size")
        check(json.loads(js.read_text(encoding="utf-8"))["resolution"] == 0.5, "saved json readable")


if __name__ == "__main__":
    for t in [test_extent_and_payload, test_load_roundtrip, test_composite_places_scans_by_alignment, test_save_floor_and_meta]:
        print(t.__name__)
        t()
    print("all floorplan checks passed")
