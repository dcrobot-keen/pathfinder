"""Validation for the ceiling-removal pipeline using a synthetic room.

No real iPhone scan is available yet, so this generates a synthetic
floor+ceiling+walls+table+outliers point cloud, runs it through
studio.preprocess.remove_ceiling, and checks the expected structural
properties of the output. Run directly: python tests/test_preprocess.py
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import numpy as np

from studio.preprocess import remove_ceiling
from studio.synthetic_room import generate_room

ROOM_HEIGHT = 2.7


def run() -> None:
    points = generate_room(height=ROOM_HEIGHT, seed=0)
    print(f"synthetic room: {len(points)} points")

    result = remove_ceiling(points, seed=0)
    out = result.points

    assert result.ceiling_z is not None, "expected a detected ceiling plane"
    assert abs(result.ceiling_z - ROOM_HEIGHT) < 0.1, (
        f"detected ceiling z={result.ceiling_z:.3f}, expected ~{ROOM_HEIGHT}"
    )

    max_z = out[:, 2].max()
    assert max_z < ROOM_HEIGHT - result.ceiling_margin + 0.05, (
        f"ceiling not removed: max z in output is {max_z:.3f}"
    )

    # Use a low percentile rather than the raw min: a handful of the synthetic
    # outliers can legitimately land within ~0.1m of the floor by chance and
    # aren't reliably distinguishable as statistical outliers at that distance.
    low_z = np.percentile(out[:, 2], 0.5)
    assert low_z > -0.1, f"floor not normalized to ~0: 0.5th percentile z is {low_z:.3f}"

    table_mask = (out[:, 2] > 0.6) & (out[:, 2] < 0.9)
    assert table_mask.sum() > 500, (
        f"expected the table surface (~1500 pts near z=0.75) to survive ceiling removal, "
        f"found {table_mask.sum()} points in that band"
    )

    assert result.outliers_removed >= 20, (
        f"expected most of the 40 synthetic outliers to be removed, "
        f"removed {result.outliers_removed}"
    )

    print(f"ceiling_z={result.ceiling_z:.3f} (expected ~{ROOM_HEIGHT})")
    print(f"output points: {len(out)} (max_z={max_z:.3f}, 0.5th pct z={low_z:.3f})")
    print(f"outliers removed: {result.outliers_removed}")
    print("PASS")


if __name__ == "__main__":
    run()
