"""2D point-set registration (ICP) for aligning a robot-generated occupancy
grid onto the LiDAR-scanned base map (PLAN.md section 3.3 / backlog "점군
정렬/병합").

Both maps are expected as 2D point sets in their own world coordinates (e.g.
the occupied-cell centers of an OccupancyGrid, see studio.rasterize) --
registration finds the rigid transform (rotation + translation) that best
maps `source` (robot map) onto `target` (base map).
"""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
from scipy.spatial import cKDTree


def apply_transform_2d(points: np.ndarray, rotation: np.ndarray, translation: np.ndarray) -> np.ndarray:
    return points @ rotation.T + translation


def best_fit_transform_2d(source: np.ndarray, target: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Closed-form optimal rigid transform (Kabsch/Procrustes) mapping
    corresponding `source[i] -> target[i]` pairs, minimizing squared error.
    """
    src_centroid = source.mean(axis=0)
    tgt_centroid = target.mean(axis=0)
    src_centered = source - src_centroid
    tgt_centered = target - tgt_centroid

    h = src_centered.T @ tgt_centered
    u, _, vt = np.linalg.svd(h)
    d = np.sign(np.linalg.det(vt.T @ u.T))
    correction = np.diag([1.0, d])
    rotation = vt.T @ correction @ u.T

    translation = tgt_centroid - rotation @ src_centroid
    return rotation, translation


@dataclass
class ICPResult:
    rotation: np.ndarray  # (2, 2)
    translation: np.ndarray  # (2,)
    aligned_source: np.ndarray
    rmse: float
    iterations: int
    rmse_history: list[float] = field(default_factory=list)

    @property
    def rotation_deg(self) -> float:
        return float(np.degrees(np.arctan2(self.rotation[1, 0], self.rotation[0, 0])))


def icp_2d(
    source: np.ndarray,
    target: np.ndarray,
    max_iterations: int = 100,
    tolerance: float = 1e-7,
    max_correspondence_distance: float | None = None,
) -> ICPResult:
    """Iterative Closest Point: find the rigid transform aligning `source`
    onto `target`. Starts from a centroid-alignment initial guess (robust to
    the two point sets not overlapping much at the start), then alternates
    nearest-neighbor correspondence and closed-form rigid refit.
    """
    if len(source) == 0 or len(target) == 0:
        raise ValueError("source and target must be non-empty")

    target_tree = cKDTree(target)

    rotation = np.eye(2)
    translation = target.mean(axis=0) - source.mean(axis=0)
    current = apply_transform_2d(source, rotation, translation)

    rmse_history: list[float] = []
    prev_rmse = float("inf")
    iterations_run = 0

    for i in range(max_iterations):
        distances, indices = target_tree.query(current)

        if max_correspondence_distance is not None:
            keep = distances < max_correspondence_distance
            if keep.sum() < 3:
                keep = np.ones_like(keep)  # too few correspondences left; use all
        else:
            keep = np.ones(len(current), dtype=bool)

        matched_target = target[indices[keep]]
        step_rotation, step_translation = best_fit_transform_2d(current[keep], matched_target)

        rotation = step_rotation @ rotation
        translation = step_rotation @ translation + step_translation
        current = apply_transform_2d(source, rotation, translation)

        rmse = float(np.sqrt(np.mean(np.sum((current[keep] - matched_target) ** 2, axis=1))))
        rmse_history.append(rmse)
        iterations_run = i + 1

        if abs(prev_rmse - rmse) < tolerance:
            break
        prev_rmse = rmse

    return ICPResult(
        rotation=rotation,
        translation=translation,
        aligned_source=current,
        rmse=rmse_history[-1] if rmse_history else float("nan"),
        iterations=iterations_run,
        rmse_history=rmse_history,
    )


def icp_2d_multistart(
    source: np.ndarray,
    target: np.ndarray,
    initial_rotations_deg: tuple[float, ...] = (0, 45, 90, 135, 180, 225, 270, 315),
    max_iterations: int = 100,
    tolerance: float = 1e-7,
    max_correspondence_distance: float | None = None,
) -> ICPResult:
    """Plain icp_2d only converges reliably within roughly +-30deg of the true
    alignment (see tests/test_registration.py) since it starts from a
    centroid-only guess -- for a real robot map with unknown initial heading,
    try ICP from several rotation guesses around the source's own centroid and
    keep whichever converges to the lowest RMSE.
    """
    src_centroid = source.mean(axis=0)
    best: ICPResult | None = None

    for deg in initial_rotations_deg:
        theta = np.radians(deg)
        c, s = np.cos(theta), np.sin(theta)
        r0 = np.array([[c, -s], [s, c]])
        rotated = (source - src_centroid) @ r0.T + src_centroid

        result = icp_2d(
            rotated,
            target,
            max_iterations=max_iterations,
            tolerance=tolerance,
            max_correspondence_distance=max_correspondence_distance,
        )
        # compose the seed rotation into the reported transform
        combined_rotation = result.rotation @ r0
        combined_translation = result.rotation @ (-r0 @ src_centroid + src_centroid) + result.translation
        result = ICPResult(
            rotation=combined_rotation,
            translation=combined_translation,
            aligned_source=result.aligned_source,
            rmse=result.rmse,
            iterations=result.iterations,
            rmse_history=result.rmse_history,
        )

        if best is None or result.rmse < best.rmse:
            best = result

    assert best is not None
    return best
