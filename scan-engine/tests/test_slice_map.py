"""Validation for the height-slice rasterizer (studio.slice_map) using the
synthetic room. The synthetic room has a table top at z=0.75 and walls
floor-to-ceiling; the whole point of slicing is that a slice BELOW the table
top sees the walls but NOT the table body.

Run directly:
    python tests/test_slice_map.py
"""
from __future__ import annotations

import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import numpy as np

from studio.classify import WALL, classify_floor_wall_furniture
from studio.preprocess import remove_ceiling
from studio.rasterize import FREE, OCCUPIED, UNKNOWN
from studio.slice_map import (
    CLS_WALL,
    CODE_OCC_WALL,
    load_slice_json,
    rasterize_slice,
    save_slice_json,
    slice_to_codes,
)
from studio.synthetic_room import generate_room

ROOM_W, ROOM_D = 4.0, 5.0

failures = 0


def check(name: str, cond: bool, extra: str = "") -> None:
    global failures
    print(f"{'PASS' if cond else 'FAIL'}  {name}" + (f"  ({extra})" if extra else ""))
    if not cond:
        failures += 1


def cell(occ, x, y):
    col = int((x - occ.origin[0]) / occ.resolution)
    row = int((y - occ.origin[1]) / occ.resolution)
    return row, col


def run() -> None:
    points = generate_room(width=ROOM_W, depth=ROOM_D, height=2.7, seed=0)
    base = remove_ceiling(points, seed=0)  # floor-normalized, ceiling gone

    # --- slice at 0.18 m (TB3 lidar height) -- below the 0.75 m table top ---
    sg = rasterize_slice(base.points, z=0.18, band=0.05, resolution=0.1, padding=0.5)
    occ = sg.occ
    print(f"slice grid {occ.grid.shape} @ {occ.resolution} m, origin {occ.origin}")

    # a wall runs along x=0 for all y -> occupied cells near there
    wall_hits = sum(
        occ.grid[cell(occ, 0.0, yy)] == OCCUPIED for yy in np.linspace(0.5, ROOM_D - 0.5, 12)
    )
    check("slice sees the walls (x=0 wall mostly occupied)", wall_hits >= 8, f"{wall_hits}/12")

    # the table CENTER (2.0, 2.5) at slice height 0.18 is empty -- the top is
    # at 0.75 and the synthetic room has no legs -> should NOT be occupied.
    r, c = cell(occ, ROOM_W / 2, ROOM_D / 2)
    check("slice does NOT see the table body (center not occupied)", occ.grid[r, c] != OCCUPIED,
          f"grid={occ.grid[r, c]}")

    # full-height projection WOULD mark that column occupied -- contrast check
    from studio.rasterize import rasterize_occupancy_grid

    full = rasterize_occupancy_grid(base.points, resolution=0.1, obstacle_min_height=0.08, padding=0.5)
    check("full-height projection DOES mark the table column occupied (the problem we're avoiding)",
          full.grid[cell(full, ROOM_W / 2, ROOM_D / 2)] == OCCUPIED,
          f"grid={full.grid[cell(full, ROOM_W / 2, ROOM_D / 2)]}")

    # open floor near a corner, away from walls, is free
    r, c = cell(occ, 1.0, 1.0)
    check("open floor is free in the slice", occ.grid[r, c] == FREE, f"grid={occ.grid[r, c]}")

    # --- with classification: wall cells tagged CLS_WALL ---
    cls = classify_floor_wall_furniture(base.points, rng=np.random.default_rng(0))
    sg2 = rasterize_slice(base.points, z=0.18, band=0.05, resolution=0.1, labels=cls.labels)
    wall_class_hits = sum(
        sg2.cls[cell(sg2.occ, 0.0, yy)] == CLS_WALL
        for yy in np.linspace(0.5, ROOM_D - 0.5, 12)
        if sg2.occ.grid[cell(sg2.occ, 0.0, yy)] == OCCUPIED
    )
    check("classified slice tags wall cells CLS_WALL", wall_class_hits >= 6, f"{wall_class_hits}")

    # --- slicemap-v1 JSON round-trips ---
    codes = slice_to_codes(sg2)
    check("code grid: wall cells -> CODE_OCC_WALL",
          np.any(codes == CODE_OCC_WALL) and codes.shape == sg2.occ.grid.shape)
    with tempfile.TemporaryDirectory() as d:
        p = save_slice_json(Path(d) / "slice.json", sg2)
        back = load_slice_json(p)
        check("save/load_slice_json: occ grid round-trips", np.array_equal(back.occ.grid, sg2.occ.grid))
        check("save/load_slice_json: wall class round-trips",
              np.array_equal(back.cls == CLS_WALL, sg2.cls == CLS_WALL))
        check("save/load_slice_json: frame round-trips",
              back.occ.origin == sg2.occ.origin and back.occ.resolution == sg2.occ.resolution
              and back.z == sg2.z and back.band == sg2.band)

    # --- a slice ABOVE the table top DOES see it ---
    sg_hi = rasterize_slice(base.points, z=0.75, band=0.03, resolution=0.1, padding=0.5)
    r, c = cell(sg_hi.occ, ROOM_W / 2, ROOM_D / 2)
    check("a slice at the table-top height DOES see the table", sg_hi.occ.grid[r, c] == OCCUPIED,
          f"grid={sg_hi.occ.grid[r, c]}")


if __name__ == "__main__":
    run()
    print("\nall slice_map tests passed" if failures == 0 else f"\n{failures} check(s) failed")
    sys.exit(0 if failures == 0 else 1)
