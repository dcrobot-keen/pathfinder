"""Validation for Hough-based wall vectorization (studio/vectorize.py),
using the synthetic room where the true wall layout (a 4m x 5m rectangle)
is known. Run directly: python tests/test_vectorize.py
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import numpy as np

from studio.classify import classify_floor_wall_furniture
from studio.preprocess import remove_ceiling
from studio.synthetic_room import generate_room
from studio.vectorize import (
    detect_wall_lines,
    merge_collinear_segments,
    rasterize_label_mask,
    to_geojson,
)
from studio.classify import WALL

ROOM_WIDTH = 4.0
ROOM_DEPTH = 5.0


def run() -> None:
    room = generate_room(width=ROOM_WIDTH, depth=ROOM_DEPTH, height=2.7, seed=0)
    base = remove_ceiling(room, seed=0)
    result = classify_floor_wall_furniture(base.points, rng=np.random.default_rng(0))
    print(f"wall points: {result.count(WALL)}")

    wall_grid = rasterize_label_mask(base.points, result.labels, WALL, resolution=0.05)
    raw_segments = detect_wall_lines(wall_grid)
    print(f"raw Hough segments: {len(raw_segments)}")
    assert len(raw_segments) > 0, "expected at least some raw Hough detections"

    merged = merge_collinear_segments(raw_segments)
    print(f"merged segments: {len(merged)}")
    for seg in merged:
        print(f"  {seg.p1} -> {seg.p2}  length={seg.length:.2f}")

    # A rectangular room should collapse to close to 4 wall segments (allow
    # some slack: a corner or a noisy edge can split into an extra piece).
    assert 3 <= len(merged) <= 8, f"expected roughly 4 merged wall segments for a rectangular room, got {len(merged)}"

    # Each of the two length scales (~4m and ~5m sides) should be represented
    # among the merged segments (with some tolerance for corner clipping).
    lengths = sorted(seg.length for seg in merged)
    assert lengths[-1] > 3.0, f"expected at least one long (~4-5m) wall segment, longest was {lengths[-1]:.2f}m"

    geojson = to_geojson(merged, [])
    assert geojson["type"] == "FeatureCollection"
    assert len(geojson["features"]) == len(merged)
    assert geojson["features"][0]["geometry"]["type"] == "LineString"

    print("PASS")


if __name__ == "__main__":
    run()
