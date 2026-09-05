"""Smoke test for the interactive registration-alignment viewer
(studio/align_viewer_html.py) -- the JS interaction logic itself was
verified manually in a real browser (drag = translate, shift+drag = rotate
around the robot map's own centroid, live overlap readout, export button);
this just checks the HTML builds without error and embeds the expected
data/controls, and stays a regression check if the template changes. Run
directly: python tests/test_align_viewer.py
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import numpy as np

from studio.align_viewer_html import build_alignment_viewer_html
from studio.preprocess import remove_ceiling
from studio.rasterize import OCCUPIED, cell_centers_world, rasterize_occupancy_grid
from studio.registration import apply_transform_2d, icp_2d_multistart
from studio.synthetic_room import generate_room


def run() -> None:
    room = generate_room(width=4.0, depth=5.0, height=2.7, seed=0)
    base = remove_ceiling(room, seed=0)
    occ = rasterize_occupancy_grid(base.points, resolution=0.05, obstacle_min_height=0.08, padding=0.5)
    base_points = cell_centers_world(occ, OCCUPIED)

    theta = np.radians(20.0)
    c, s = np.cos(theta), np.sin(theta)
    robot_points = apply_transform_2d(base_points, np.array([[c, -s], [s, c]]), np.array([0.3, -0.2]))

    result = icp_2d_multistart(source=robot_points, target=base_points, max_correspondence_distance=0.5)
    print(f"auto ICP: rot={result.rotation_deg:.2f}deg rmse={result.rmse:.4f}")

    html = build_alignment_viewer_html(
        base_points=base_points,
        robot_points=robot_points,
        initial_rotation_deg=result.rotation_deg,
        initial_translation=tuple(result.translation),
        initial_rmse=result.rmse,
        resolution=occ.resolution,
    )

    assert "<canvas id=\"view\"" in html
    assert "Shift+드래그" in html
    assert "exportBtn" in html
    assert "resetBtn" in html
    assert f"const initRotationDeg = {result.rotation_deg};" in html
    print(f"generated HTML: {len(html):,} bytes")
    print("PASS")


if __name__ == "__main__":
    run()
