"""Rule-based floor/wall/furniture classification (approximates FJD Trion
Model's "자동 분류" -- PLAN.md "스튜디오 제품 방향" priority #2).

No labeled training data exists for a learned classifier, so this is
purely geometric, reusing the same RANSAC machinery as ceiling/floor
detection (studio.preprocess):
- floor: points near z=0 (already-normalized floor height, see
  studio.preprocess.normalize_to_floor)
- walls: large near-VERTICAL RANSAC planes (mirrors
  studio.preprocess.find_horizontal_planes, filtered for the opposite
  orientation)
- everything else (furniture, clutter, anything that doesn't fit a large
  flat floor/wall plane): furniture
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from studio.preprocess import Plane, _refine_plane

FLOOR = 0
WALL = 1
FURNITURE = 2

LABEL_NAMES = {FLOOR: "floor", WALL: "wall", FURNITURE: "furniture"}
LABEL_COLORS = {
    FLOOR: (140, 140, 140),
    WALL: (70, 150, 220),
    FURNITURE: (230, 120, 40),
}


@dataclass
class VerticalPlaneCandidate:
    plane: Plane
    inlier_mask: np.ndarray

    @property
    def inlier_count(self) -> int:
        return int(self.inlier_mask.sum())


def fit_vertical_plane_ransac(
    points: np.ndarray,
    distance_threshold: float = 0.03,
    num_iterations: int = 2000,
    horizontality_cos_threshold: float = 0.2,
    rng: np.random.Generator | None = None,
    refinement_passes: int = 1,
) -> tuple[Plane, np.ndarray] | None:
    """Like studio.preprocess.fit_plane_ransac, but ONLY considers candidate
    planes whose normal is already near-horizontal (|normal.z| <=
    horizontality_cos_threshold) -- i.e. searches for the best WALL
    specifically, instead of the best plane of any orientation.

    This matters because furniture manufactured to a shared height (e.g. a
    room full of desks all ~0.73m tall) forms one huge coplanar horizontal
    surface across many separate objects -- an orientation-agnostic RANSAC
    search finds that "virtual desk plane" as the single best-fit plane over
    and over, burning through the iteration budget before ever reaching a
    smaller, less-populated (but real) wall segment. Rejecting non-vertical
    samples during the search itself avoids this rather than filtering
    after the fact.

    Returns None if no vertical-enough 3-point sample was found in
    `num_iterations` tries (i.e. no wall left to find).
    """
    if rng is None:
        rng = np.random.default_rng()

    n = len(points)
    if n < 3:
        return None

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
            continue
        normal = normal / norm_len
        if abs(normal[2]) > horizontality_cos_threshold:
            continue  # not vertical-enough -- reject before even scoring it
        d = -np.dot(normal, p0)

        distances = np.abs(points @ normal + d)
        inliers = distances < distance_threshold
        count = int(inliers.sum())
        if count > best_count:
            best_count = count
            best_inliers = inliers
            best_plane = (normal, d)

    if best_plane is None:
        return None

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


def find_vertical_planes(
    points: np.ndarray,
    distance_threshold: float = 0.03,
    num_iterations: int = 2000,
    max_planes: int = 15,
    min_inlier_fraction: float = 0.02,
    horizontality_cos_threshold: float = 0.15,
    min_z_span: float = 0.3,
    rng: np.random.Generator | None = None,
) -> list[VerticalPlaneCandidate]:
    """Iteratively extract dominant walls via fit_vertical_plane_ransac,
    removing each found wall's inliers before searching for the next.

    `min_z_span`: a candidate's inliers must cover at least this much height
    range (default 0.3m) to count as a wall. A real wall spans floor-to-
    ceiling; a thin, mostly-flat cluster (e.g. a table, whose z-noise is a
    couple cm) can still occasionally pass the verticality check with a
    shallow diagonal fit that happens to sweep through much of its area
    within `distance_threshold` -- rejecting low-z-span candidates filters
    that out without needing a tighter (and less robust) angle threshold.
    """
    if rng is None:
        rng = np.random.default_rng()

    remaining_mask = np.ones(len(points), dtype=bool)
    min_inliers = max(int(min_inlier_fraction * len(points)), 50)
    candidates: list[VerticalPlaneCandidate] = []

    # Cap total RANSAC calls separately from max_planes (the count of
    # ACCEPTED walls): a below-threshold candidate must not stop the whole
    # search (real wall segments come in a wide range of sizes -- rejecting
    # one small segment says nothing about whether a later, larger one is
    # still out there), but we still need a hard stop so a point cloud full
    # of small clutter doesn't spin forever.
    max_attempts = max_planes * 4

    for _ in range(max_attempts):
        if len(candidates) >= max_planes:
            break
        remaining_idx = np.nonzero(remaining_mask)[0]
        if len(remaining_idx) < min_inliers:
            break

        found = fit_vertical_plane_ransac(
            points[remaining_idx],
            distance_threshold,
            num_iterations,
            horizontality_cos_threshold,
            rng,
        )
        if found is None:
            break  # no more vertical-enough structure left to find at all
        plane, local_inliers = found

        global_inlier_idx = remaining_idx[local_inliers]
        # Remove these points regardless of accept/reject below, so a
        # rejected small plane doesn't get refound on the next attempt.
        remaining_mask[global_inlier_idx] = False

        if local_inliers.sum() < min_inliers:
            continue  # too small to be a wall on its own -- keep looking

        z_span = points[global_inlier_idx, 2].max() - points[global_inlier_idx, 2].min()
        if z_span >= min_z_span:
            full_mask = np.zeros(len(points), dtype=bool)
            full_mask[global_inlier_idx] = True
            candidates.append(VerticalPlaneCandidate(plane, full_mask))

    return candidates


@dataclass
class ClassificationResult:
    labels: np.ndarray  # (N,) int8, one of FLOOR/WALL/FURNITURE
    num_wall_planes: int

    def count(self, label: int) -> int:
        return int((self.labels == label).sum())


def classify_floor_wall_furniture(
    points: np.ndarray,
    floor_z_tolerance: float = 0.05,
    wall_distance_threshold: float = 0.03,
    wall_num_iterations: int = 2000,
    wall_max_planes: int = 15,
    rng: np.random.Generator | None = None,
) -> ClassificationResult:
    """Label each point floor / wall / furniture. Expects `points` to
    already be floor-normalized (z=0 at floor), e.g. the output of
    studio.preprocess.remove_ceiling.
    """
    if rng is None:
        rng = np.random.default_rng()

    labels = np.full(len(points), FURNITURE, dtype=np.int8)

    floor_mask = points[:, 2] <= floor_z_tolerance
    labels[floor_mask] = FLOOR

    remaining_idx = np.nonzero(~floor_mask)[0]
    wall_candidates = find_vertical_planes(
        points[remaining_idx],
        distance_threshold=wall_distance_threshold,
        num_iterations=wall_num_iterations,
        max_planes=wall_max_planes,
        rng=rng,
    )
    for candidate in wall_candidates:
        labels[remaining_idx[candidate.inlier_mask]] = WALL

    return ClassificationResult(labels=labels, num_wall_planes=len(wall_candidates))


def labels_to_colors(labels: np.ndarray) -> np.ndarray:
    """(N,) label array -> (N, 3) uint8 RGB, for visualization/PLY export."""
    colors = np.zeros((len(labels), 3), dtype=np.uint8)
    for label, color in LABEL_COLORS.items():
        colors[labels == label] = color
    return colors
