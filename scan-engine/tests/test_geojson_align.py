"""Validation for GeoJSON coordinate correction (studio/geojson_align.py):
Umeyama similarity-transform fitting from control-point correspondences, and
the generic recursive coordinate walk that applies it to a GeoJSON
FeatureCollection. Run directly: python tests/test_geojson_align.py
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import numpy as np

from studio.geojson_align import SimilarityTransform, fit_similarity_transform, residuals, transform_geojson

TRUE_SCALE = 2.5
TRUE_ROTATION_DEG = 17.0
TRUE_TRANSLATION = (3.0, -1.0)


def _true_transform_points(points: np.ndarray) -> np.ndarray:
    theta = np.radians(TRUE_ROTATION_DEG)
    c, s = np.cos(theta), np.sin(theta)
    rotation = np.array([[c, -s], [s, c]])
    return TRUE_SCALE * (points @ rotation.T) + np.array(TRUE_TRANSLATION)


def run() -> None:
    rng = np.random.default_rng(0)

    # -- fit recovery: >2 correspondences (least-squares, not just exact 2-point fit) --
    source = rng.uniform(-5, 5, size=(6, 2))
    target = _true_transform_points(source)

    fit = fit_similarity_transform(source, target)
    print(f"fit: scale={fit.scale:.6f} rotation_deg={fit.rotation_deg:.6f} translation={fit.translation}")
    assert abs(fit.scale - TRUE_SCALE) < 1e-8, f"scale off: {fit.scale}"
    assert abs(fit.rotation_deg - TRUE_ROTATION_DEG) < 1e-8, f"rotation off: {fit.rotation_deg}"
    assert abs(fit.translation[0] - TRUE_TRANSLATION[0]) < 1e-8
    assert abs(fit.translation[1] - TRUE_TRANSLATION[1]) < 1e-8

    res = residuals(fit, source, target)
    print(f"residuals: max={res.max():.2e}")
    assert res.max() < 1e-6, f"residuals too large for an exact synthetic case: {res.max()}"

    # -- exact 2-point fit (minimum required) --
    fit2 = fit_similarity_transform(source[:2], target[:2])
    assert abs(fit2.scale - TRUE_SCALE) < 1e-6

    # -- rejects underdetermined input --
    try:
        fit_similarity_transform(source[:1], target[:1])
        assert False, "expected ValueError for a single point correspondence"
    except ValueError:
        pass

    # -- generic recursive coordinate transform, across nesting depths --
    geojson = {
        "type": "FeatureCollection",
        "features": [
            {"type": "Feature", "geometry": {"type": "Point", "coordinates": [1.0, 2.0]}, "properties": {"name": "corner"}},
            {"type": "Feature", "geometry": {"type": "Point", "coordinates": [5.0, 6.0, 12.5]}, "properties": {}},
            {"type": "Feature", "geometry": {"type": "LineString", "coordinates": [[0.0, 0.0], [1.0, 1.0], [2.0, 0.0]]}, "properties": {"length_m": 4.0}},
            {"type": "Feature", "geometry": {"type": "Polygon", "coordinates": [[[0.0, 0.0], [4.0, 0.0], [4.0, 3.0], [0.0, 3.0], [0.0, 0.0]]]}, "properties": {}},
        ],
    }
    aligned = transform_geojson(geojson, fit)

    point = aligned["features"][0]["geometry"]["coordinates"]
    expected_point = _true_transform_points(np.array([[1.0, 2.0]]))[0]
    assert abs(point[0] - expected_point[0]) < 1e-6 and abs(point[1] - expected_point[1]) < 1e-6
    assert aligned["features"][0]["properties"]["name"] == "corner", "properties must survive untouched"
    assert aligned["features"][0]["geometry"]["type"] == "Point"

    point_3d = aligned["features"][1]["geometry"]["coordinates"]
    assert len(point_3d) == 3 and point_3d[2] == 12.5, "z coordinate must be preserved untouched"

    line = aligned["features"][2]["geometry"]["coordinates"]
    assert len(line) == 3
    expected_line = _true_transform_points(np.array([[0.0, 0.0], [1.0, 1.0], [2.0, 0.0]]))
    for got, want in zip(line, expected_line):
        assert abs(got[0] - want[0]) < 1e-6 and abs(got[1] - want[1]) < 1e-6

    ring = aligned["features"][3]["geometry"]["coordinates"][0]
    assert len(ring) == 5, "polygon ring nesting depth must be preserved"
    expected_ring = _true_transform_points(np.array([[0.0, 0.0], [4.0, 0.0], [4.0, 3.0], [0.0, 3.0], [0.0, 0.0]]))
    for got, want in zip(ring, expected_ring):
        assert abs(got[0] - want[0]) < 1e-6 and abs(got[1] - want[1]) < 1e-6

    # original untouched (transform_geojson must not mutate its input)
    assert geojson["features"][0]["geometry"]["coordinates"] == [1.0, 2.0]

    print("PASS")


if __name__ == "__main__":
    run()
