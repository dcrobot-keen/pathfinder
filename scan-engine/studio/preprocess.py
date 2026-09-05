"""Ceiling/floor removal preprocessing for indoor LiDAR point clouds.

Pipeline (see PLAN.md section 3.1):
1. RANSAC plane segmentation to find candidate horizontal planes (floor/ceiling).
2. Normalize coordinates so the floor plane sits at z=0 with normal +Z.
3. Height-filter out points at/above the ceiling (or a fallback percentile).
4. Statistical outlier removal to clean up noise.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from scipy.spatial import cKDTree

Plane = tuple[np.ndarray, float]  # (unit normal (3,), signed distance d) s.t. normal . p + d = 0


@dataclass
class HorizontalPlaneCandidate:
    plane: Plane
    inlier_mask: np.ndarray
    mean_z: float

    @property
    def inlier_count(self) -> int:
        return int(self.inlier_mask.sum())


def fit_plane_ransac(
    points: np.ndarray,
    distance_threshold: float = 0.02,
    num_iterations: int = 1000,
    rng: np.random.Generator | None = None,
    refinement_passes: int = 1,
) -> tuple[Plane, np.ndarray]:
    """Find the plane with the most inliers via RANSAC.

    Returns ((normal, d), inlier_mask) where normal is a unit vector and
    normal . point + d == 0 for points on the plane.

    A minimal 3-point RANSAC sample is noisy on a large, real-world-noisy
    surface (e.g. a 6m-wide floor) -- a bad 3-point draw can pick up a
    slightly tilted plane that still clears `distance_threshold` for most
    inliers, without being the true best fit. `refinement_passes` runs
    least-squares refit + inlier recomputation in a loop (trimmed least
    squares) to converge onto the actual dominant plane instead of settling
    for the raw minimal-sample estimate.
    """
    if rng is None:
        rng = np.random.default_rng()

    n = len(points)
    if n < 3:
        raise ValueError("need at least 3 points to fit a plane")

    best_inliers = np.zeros(n, dtype=bool)
    best_count = -1
    best_plane: Plane | None = None

    for _ in range(num_iterations):
        idx = rng.choice(n, size=3, replace=False)
        p0, p1, p2 = points[idx]
        v1, v2 = p1 - p0, p2 - p0
        normal = np.cross(v1, v2)
        norm_len = np.linalg.norm(normal)
        if norm_len < 1e-12:
            continue  # degenerate (collinear) sample
        normal = normal / norm_len
        d = -np.dot(normal, p0)

        distances = np.abs(points @ normal + d)
        inliers = distances < distance_threshold
        count = int(inliers.sum())
        if count > best_count:
            best_count = count
            best_inliers = inliers
            best_plane = (normal, d)

    assert best_plane is not None

    plane = _refine_plane(points, best_inliers, best_plane)
    inliers = best_inliers
    for _ in range(refinement_passes):
        normal, d = plane
        distances = np.abs(points @ normal + d)
        new_inliers = distances < distance_threshold
        if new_inliers.sum() < 3 or np.array_equal(new_inliers, inliers):
            inliers = new_inliers
            break
        inliers = new_inliers
        plane = _refine_plane(points, inliers, plane)

    return plane, inliers


def _refine_plane(points: np.ndarray, inlier_mask: np.ndarray, fallback: Plane) -> Plane:
    """Least-squares refit of the plane using all inliers (via SVD), since a
    RANSAC minimal (3-point) sample is noisy on its own.
    """
    inliers = points[inlier_mask]
    if len(inliers) < 3:
        return fallback
    centroid = inliers.mean(axis=0)
    # full_matrices=False: U is (N, 3) instead of the default (N, N) -- with a
    # large inlier set (real scans easily have 10^5+ points on the floor
    # alone) the full U blows up memory for no reason, since only Vt is used.
    _, _, vt = np.linalg.svd(inliers - centroid, full_matrices=False)
    normal = vt[-1]
    normal = normal / np.linalg.norm(normal)
    d = -np.dot(normal, centroid)
    return normal, d


def find_horizontal_planes(
    points: np.ndarray,
    distance_threshold: float = 0.02,
    num_iterations: int = 1000,
    max_planes: int = 4,
    min_inlier_fraction: float = 0.01,
    verticality_cos_threshold: float = 0.9,
    rng: np.random.Generator | None = None,
) -> list[HorizontalPlaneCandidate]:
    """Iteratively extract the dominant near-horizontal planes (floor/ceiling
    candidates) by repeated RANSAC + removal of inliers.
    """
    if rng is None:
        rng = np.random.default_rng()

    remaining_mask = np.ones(len(points), dtype=bool)
    min_inliers = max(int(min_inlier_fraction * len(points)), 50)
    candidates: list[HorizontalPlaneCandidate] = []

    for _ in range(max_planes):
        remaining_idx = np.nonzero(remaining_mask)[0]
        if len(remaining_idx) < min_inliers:
            break

        plane, local_inliers = fit_plane_ransac(
            points[remaining_idx], distance_threshold, num_iterations, rng
        )
        normal, _ = plane
        if local_inliers.sum() < min_inliers:
            break

        global_inlier_idx = remaining_idx[local_inliers]
        remaining_mask[global_inlier_idx] = False

        if abs(normal[2]) >= verticality_cos_threshold:
            full_mask = np.zeros(len(points), dtype=bool)
            full_mask[global_inlier_idx] = True
            mean_z = float(points[global_inlier_idx, 2].mean())
            candidates.append(HorizontalPlaneCandidate(plane, full_mask, mean_z))

    return candidates


def normalize_to_floor(points: np.ndarray, floor_plane: Plane) -> np.ndarray:
    """Rotate/translate points so the floor plane becomes z=0 with normal +Z."""
    normal, d = floor_plane
    normal = normal / np.linalg.norm(normal)
    if normal[2] < 0:  # ensure the normal points "up"
        normal, d = -normal, -d

    target = np.array([0.0, 0.0, 1.0])
    v = np.cross(normal, target)
    s = np.linalg.norm(v)
    c = np.dot(normal, target)

    if s < 1e-12:
        rotation = np.eye(3) if c > 0 else np.diag([1.0, -1.0, -1.0])
    else:
        vx = np.array(
            [[0, -v[2], v[1]], [v[2], 0, -v[0]], [-v[1], v[0], 0]]
        )
        rotation = np.eye(3) + vx + vx @ vx * ((1 - c) / (s**2))

    rotated = points @ rotation.T
    floor_point = -normal * d  # point on the original plane closest to origin
    floor_z = (rotation @ floor_point)[2]
    rotated[:, 2] -= floor_z
    return rotated


def remove_statistical_outliers(
    points: np.ndarray, k: int = 16, std_ratio: float = 2.0
) -> np.ndarray:
    """Keep points whose mean distance to their k nearest neighbors is within
    `std_ratio` standard deviations of the dataset-wide mean (mirrors Open3D's
    statistical_outlier_removal).
    """
    if len(points) <= k:
        return np.ones(len(points), dtype=bool)

    tree = cKDTree(points)
    distances, _ = tree.query(points, k=k + 1)  # includes the point itself (dist 0)
    mean_knn_dist = distances[:, 1:].mean(axis=1)

    global_mean = mean_knn_dist.mean()
    global_std = mean_knn_dist.std()
    threshold = global_mean + std_ratio * global_std
    return mean_knn_dist <= threshold


@dataclass
class CeilingRemovalResult:
    points: np.ndarray
    colors: np.ndarray | None
    floor_z_source: str
    ceiling_z: float | None
    ceiling_margin: float
    floor_margin: float
    below_floor_removed: int
    outliers_removed: int


def remove_ceiling(
    points: np.ndarray,
    colors: np.ndarray | None = None,
    distance_threshold: float = 0.02,
    num_iterations: int = 1000,
    max_planes: int = 8,
    ceiling_margin: float = 0.05,
    floor_margin: float = 0.05,
    fallback_height_percentile: float = 98.0,
    outlier_k: int = 16,
    outlier_std_ratio: float = 2.0,
    seed: int | None = None,
) -> CeilingRemovalResult:
    """Full pipeline: detect floor, normalize coordinates, cut off the ceiling,
    and remove statistical outliers. See PLAN.md section 3.1.
    """
    rng = np.random.default_rng(seed)

    candidates = find_horizontal_planes(
        points,
        distance_threshold=distance_threshold,
        num_iterations=num_iterations,
        max_planes=max_planes,
        rng=rng,
    )

    if not candidates:
        raise RuntimeError(
            "no horizontal plane candidates found; cannot identify a floor. "
            "Try relaxing distance_threshold or verticality_cos_threshold."
        )

    floor_candidate = min(candidates, key=lambda c: c.mean_z)
    normalized = normalize_to_floor(points, floor_candidate.plane)

    ceiling_candidates = [c for c in candidates if c is not floor_candidate]
    ceiling_z: float | None = None
    floor_z_source = "ransac_floor"

    if ceiling_candidates:
        # mean_z values were computed pre-normalization; re-derive post-normalization
        # ceiling height from the same inlier points instead of reusing mean_z.
        best_ceiling = max(
            ceiling_candidates,
            key=lambda c: normalized[c.inlier_mask, 2].mean(),
        )
        ceiling_z = float(normalized[best_ceiling.inlier_mask, 2].mean())
        cutoff = ceiling_z - ceiling_margin
    else:
        cutoff = float(np.percentile(normalized[:, 2], fallback_height_percentile))
        floor_z_source = "ransac_floor+percentile_ceiling"

    # Real scans have localized mesh-reconstruction noise dipping just below the
    # true floor (e.g. under furniture footprints) -- these form small dense
    # clusters, so statistical outlier removal (below) can't catch them; a hard
    # floor cutoff mirrors the ceiling cutoff and removes them directly, since
    # nothing should physically be below the floor.
    height_mask = (normalized[:, 2] < cutoff) & (normalized[:, 2] > -floor_margin)
    below_floor_removed = int(((normalized[:, 2] <= -floor_margin) & (normalized[:, 2] < cutoff)).sum())
    kept_points = normalized[height_mask]
    kept_colors = colors[height_mask] if colors is not None else None

    inlier_mask = remove_statistical_outliers(
        kept_points, k=outlier_k, std_ratio=outlier_std_ratio
    )
    outliers_removed = int((~inlier_mask).sum())

    final_points = kept_points[inlier_mask]
    final_colors = kept_colors[inlier_mask] if kept_colors is not None else None

    return CeilingRemovalResult(
        points=final_points,
        colors=final_colors,
        floor_z_source=floor_z_source,
        ceiling_z=ceiling_z,
        ceiling_margin=ceiling_margin,
        floor_margin=floor_margin,
        below_floor_removed=below_floor_removed,
        outliers_removed=outliers_removed,
    )
