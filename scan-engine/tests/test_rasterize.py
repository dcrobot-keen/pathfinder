"""Validation for 2D occupancy-grid rasterization using the synthetic room
(same fixture as tests/test_preprocess.py). Run directly:
    python tests/test_rasterize.py
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import numpy as np

from studio.preprocess import remove_ceiling
from studio.rasterize import FREE, OCCUPIED, UNKNOWN, rasterize_occupancy_grid
from studio.synthetic_room import generate_room

ROOM_WIDTH = 4.0
ROOM_DEPTH = 5.0


def world_to_cell(occ, x, y):
    col = int((x - occ.origin[0]) / occ.resolution)
    row = int((y - occ.origin[1]) / occ.resolution)
    return row, col


def run() -> None:
    points = generate_room(width=ROOM_WIDTH, depth=ROOM_DEPTH, height=2.7, seed=0)
    base = remove_ceiling(points, seed=0)

    # 0.2m cells: coarse enough that a 4000-point floor (~0.5 pts per 5cm cell
    # on average -- too sparse for a single-cell spot check) reliably has
    # several points per cell instead of a good chance of landing on an
    # empty one by chance.
    occ = rasterize_occupancy_grid(base.points, resolution=0.2, obstacle_min_height=0.08, padding=0.5)
    print(f"grid shape: {occ.grid.shape}, origin: {occ.origin}")

    # Open floor area (e.g. near a corner, away from the table at the center)
    # should be free.
    r, c = world_to_cell(occ, 0.5, 0.5)
    assert occ.grid[r, c] == FREE, f"expected free near (0.5, 0.5), got {occ.grid[r, c]}"

    # A wall line (x=0 for a good range of y) should be occupied.
    wall_hits = 0
    for yy in np.arange(0.5, ROOM_DEPTH - 0.5, 0.2):
        r, c = world_to_cell(occ, 0.0, yy)
        if occ.grid[r, c] == OCCUPIED:
            wall_hits += 1
    assert wall_hits > 15, f"expected the x=0 wall to show up as occupied along its length, got {wall_hits} hits"

    # The table (centered in the room, z=0.75 > obstacle_min_height) should be occupied.
    r, c = world_to_cell(occ, ROOM_WIDTH / 2, ROOM_DEPTH / 2)
    assert occ.grid[r, c] == OCCUPIED, f"expected the table center to be occupied, got {occ.grid[r, c]}"

    # Well outside the scanned room (beyond padding) should be unknown.
    r, c = world_to_cell(occ, ROOM_WIDTH + 5, ROOM_DEPTH + 5)
    in_bounds = 0 <= r < occ.grid.shape[0] and 0 <= c < occ.grid.shape[1]
    assert not in_bounds, "expected far-outside point to fall outside the grid entirely"

    unknown_frac = (occ.grid == UNKNOWN).mean()
    print(f"unknown fraction: {unknown_frac:.3f}")

    print("PASS")


if __name__ == "__main__":
    run()
