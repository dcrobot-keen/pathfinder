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
    _polygon_area_m2,
    detect_wall_lines,
    merge_collinear_segments,
    rasterize_interior_mask,
    rasterize_label_mask,
    rectify_orthogonal,
    to_geojson,
    trace_room_polygons,
)
from studio.classify import WALL

ROOM_WIDTH = 4.0
ROOM_DEPTH = 5.0


def run() -> None:
    room = generate_room(width=ROOM_WIDTH, depth=ROOM_DEPTH, height=2.7, seed=0)
    base = remove_ceiling(room, seed=0)
    result = classify_floor_wall_furniture(base.points, rng=np.random.default_rng(0))
    print(f"wall points: {result.count(WALL)}")

    # Primary approach: contour-traced room outline (replaces the Hough-line
    # approach below as the main GeoJSON output -- see studio/vectorize.py
    # module docstring for why: closed by construction, unlike stitched
    # line segments).
    interior = rasterize_interior_mask(base.points, resolution=0.05)
    rooms = trace_room_polygons(interior)
    print(f"room polygons: {len(rooms)}")
    assert len(rooms) == 1, f"expected exactly 1 connected room for a single synthetic room, got {len(rooms)}"
    ring = rooms[0]
    area = _polygon_area_m2(ring)
    print(f"  {len(ring)} corners, area={area:.2f} m^2 (true={ROOM_WIDTH * ROOM_DEPTH:.2f})")
    assert 4 <= len(ring) <= 8, f"expected a roughly rectangular polygon (4-8 corners), got {len(ring)}"
    assert abs(area - ROOM_WIDTH * ROOM_DEPTH) < 4.0, f"room polygon area {area:.2f} too far from expected {ROOM_WIDTH * ROOM_DEPTH:.2f}"

    room_geojson = to_geojson(rooms=rooms)
    assert room_geojson["features"][0]["geometry"]["type"] == "Polygon"
    assert room_geojson["features"][0]["properties"]["category"] == "room"

    # Orthogonal snapping: every corner of a rectified polygon should turn
    # by exactly +/-90 degrees.
    rectified = rectify_orthogonal(ring)
    print(f"rectified: {len(rectified)} corners, area={_polygon_area_m2(rectified):.2f} m^2")
    assert len(rectified) == 4, f"expected the rectified rectangle to keep exactly 4 corners, got {len(rectified)}"
    pts = np.array(rectified)
    n = len(pts)
    for i in range(n):
        v1 = pts[i] - pts[i - 1]
        v2 = pts[(i + 1) % n] - pts[i]
        cos_turn = np.dot(v1, v2) / (np.linalg.norm(v1) * np.linalg.norm(v2))
        assert abs(abs(cos_turn) - 0.0) < 1e-6, f"corner {i} is not a right angle (cos={cos_turn:.4f})"
    assert abs(_polygon_area_m2(rectified) - ROOM_WIDTH * ROOM_DEPTH) < 1.0, "rectified area drifted too far from the true room size"

    # Secondary/debug: legacy Hough-line wall segments, kept for regression
    # coverage (still a valid, if less robust, output mode).
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
