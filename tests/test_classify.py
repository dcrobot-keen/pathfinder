"""Validation for floor/wall/furniture classification (studio/classify.py),
using the synthetic room fixture where ground truth is known. Run directly:
    python tests/test_classify.py
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import numpy as np

from studio.classify import FLOOR, FURNITURE, WALL, classify_floor_wall_furniture
from studio.preprocess import remove_ceiling
from studio.synthetic_room import generate_room

ROOM_WIDTH = 4.0
ROOM_DEPTH = 5.0


def run() -> None:
    room = generate_room(width=ROOM_WIDTH, depth=ROOM_DEPTH, height=2.7, seed=0)
    base = remove_ceiling(room, seed=0)
    print(f"base map: {len(base.points)} points")

    result = classify_floor_wall_furniture(base.points, rng=np.random.default_rng(0))
    print(f"wall planes found: {result.num_wall_planes}")
    print(f"floor={result.count(FLOOR)} wall={result.count(WALL)} furniture={result.count(FURNITURE)}")

    # The 4 walls of the synthetic room should mostly be found: expect at
    # least 3 distinct wall planes (allow some slack for RANSAC variance).
    assert result.num_wall_planes >= 3, f"expected to find most of the 4 walls, found {result.num_wall_planes}"

    # A point near a wall (x=0 plane, y mid-depth, mid-height) should be
    # labeled WALL.
    pts = base.points
    near_wall = (np.abs(pts[:, 0]) < 0.05) & (np.abs(pts[:, 1] - ROOM_DEPTH / 2) < 0.3) & (pts[:, 2] > 0.3) & (pts[:, 2] < 2.0)
    assert near_wall.sum() > 20, "test setup issue: no points found near the x=0 wall to check"
    wall_fraction = (result.labels[near_wall] == WALL).mean()
    assert wall_fraction > 0.8, f"expected >80% of near-wall points labeled WALL, got {wall_fraction:.0%}"

    # A point near the floor (z close to 0, away from the table) should be FLOOR.
    near_floor_open = (pts[:, 2] < 0.05) & (np.abs(pts[:, 0] - 0.5) < 0.3) & (np.abs(pts[:, 1] - 0.5) < 0.3)
    if near_floor_open.sum() > 0:
        assert (result.labels[near_floor_open] == FLOOR).all(), "expected open floor points to be labeled FLOOR"

    # The table top (centered at (width/2, depth/2), z in [0.6, 0.9]) should
    # be FURNITURE, not accidentally absorbed into a wall plane. Must bound
    # x/y too, not just z -- a height-only mask also catches a horizontal
    # slice of the walls, which span every height from 0 to the ceiling.
    table_mask = (
        (pts[:, 2] > 0.6)
        & (pts[:, 2] < 0.9)
        & (np.abs(pts[:, 0] - ROOM_WIDTH / 2) < 0.6)
        & (np.abs(pts[:, 1] - ROOM_DEPTH / 2) < 0.4)
    )
    assert table_mask.sum() > 500, "test setup issue: table not found"
    furniture_fraction = (result.labels[table_mask] == FURNITURE).mean()
    assert furniture_fraction > 0.8, f"expected >80% of the table to be labeled FURNITURE, got {furniture_fraction:.0%}"

    print("PASS")


if __name__ == "__main__":
    run()
