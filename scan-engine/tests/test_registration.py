"""Validation for 2D ICP registration (studio/registration.py).

No real robot map exists yet (PLAN.md section 6, question 4 still open), so
this validates the algorithm itself: take the synthetic room's occupancy
grid, apply a KNOWN rotation+translation to fake a "robot map" observing the
same room from a different pose, then check that ICP recovers the inverse
transform and re-aligns it back onto the base map. Run directly:
    python tests/test_registration.py
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import numpy as np

from studio.preprocess import remove_ceiling
from studio.rasterize import OCCUPIED, cell_centers_world, rasterize_occupancy_grid
from studio.registration import apply_transform_2d, icp_2d, icp_2d_multistart
from studio.synthetic_room import generate_room


def rotation_matrix_2d(degrees: float) -> np.ndarray:
    theta = np.radians(degrees)
    c, s = np.cos(theta), np.sin(theta)
    return np.array([[c, -s], [s, c]])


def run() -> None:
    points = generate_room(width=4.0, depth=5.0, height=2.7, seed=0)
    base = remove_ceiling(points, seed=0)
    occ = rasterize_occupancy_grid(base.points, resolution=0.05, obstacle_min_height=0.08, padding=0.5)

    base_points = cell_centers_world(occ, OCCUPIED)
    print(f"base map occupied points: {len(base_points)}")

    # Ground truth: this is the transform applied to the base map to fake a
    # robot map observed from a different pose.
    true_rotation = rotation_matrix_2d(8.0)
    true_translation = np.array([0.4, -0.3])
    robot_points = apply_transform_2d(base_points, true_rotation, true_translation)
    rng = np.random.default_rng(0)
    robot_points += rng.normal(0, 0.01, size=robot_points.shape)  # sensor noise

    result = icp_2d(source=robot_points, target=base_points, max_correspondence_distance=0.5)
    print(f"converged in {result.iterations} iterations, rmse={result.rmse:.4f}")
    print(f"recovered rotation: {result.rotation_deg:.2f} deg (expected ~-8.00 deg)")
    print(f"recovered translation: {result.translation}")

    assert abs(result.rotation_deg - (-8.0)) < 1.0, f"rotation off by more than 1 deg: {result.rotation_deg}"
    assert result.rmse < 0.05, f"rmse too high: {result.rmse}"

    # Plain icp_2d (centroid-only initial guess) only converges reliably
    # within roughly +-30deg -- a real robot's initial heading estimate could
    # easily be off by more than that, so icp_2d_multistart tries several
    # rotation seeds and keeps the best. Verify it handles a 50deg offset that
    # plain icp_2d cannot.
    true_rotation_big = rotation_matrix_2d(50.0)
    robot_points_big = apply_transform_2d(base_points, true_rotation_big, true_translation)
    robot_points_big += rng.normal(0, 0.01, size=robot_points_big.shape)

    plain_result = icp_2d(source=robot_points_big, target=base_points, max_correspondence_distance=0.5)
    plain_err = abs((plain_result.rotation_deg - (-50.0) + 180) % 360 - 180)
    assert plain_err > 5.0, "expected plain icp_2d to fail to converge on a 50deg offset (test assumption broke)"

    multi_result = icp_2d_multistart(source=robot_points_big, target=base_points, max_correspondence_distance=0.5)
    multi_err = abs((multi_result.rotation_deg - (-50.0) + 180) % 360 - 180)
    print(f"50deg offset: plain icp err={plain_err:.2f}deg, multistart err={multi_err:.2f}deg")
    assert multi_err < 1.0, f"multistart ICP should recover a 50deg offset, err={multi_err}"
    assert multi_result.rmse < 0.05, f"multistart rmse too high: {multi_result.rmse}"

    print("PASS")


if __name__ == "__main__":
    run()
