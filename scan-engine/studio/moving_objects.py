"""Heuristic removal of small, spatially-isolated obstacle clusters from a
base map -- our approximation of "이동 물체 제거" (moving object removal,
PLAN.md "스튜디오 제품 방향" priority #1).

Caveat: FJD Trion Model's moving-object removal works on the raw per-frame
scan sequence (compare what each frame saw over time). Our only scan source
is a .usdz that the scanning app has already fused into one static mesh --
there are no raw timestamped frames to diff against. So this is a geometric
heuristic, not true motion detection: static structure (floor, walls,
furniture) forms large connected clusters; something that only got scanned
briefly/inconsistently (e.g. a person walking through) tends to end up as a
small cluster disconnected from everything else. A real small isolated
object (a trash can alone in the middle of a room) would also get flagged --
inspect what gets removed before trusting this on real data.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from scipy import ndimage

from studio.rasterize import OCCUPIED, rasterize_occupancy_grid


@dataclass
class ClusterRemovalResult:
    points: np.ndarray
    colors: np.ndarray | None
    removed_mask: np.ndarray  # True = removed, indexes into the ORIGINAL input points
    num_components: int
    kept_component_count: int
    removed_component_sizes: list[int]  # cell counts of each removed component, largest first


def remove_isolated_clusters(
    points: np.ndarray,
    colors: np.ndarray | None = None,
    resolution: float = 0.05,
    obstacle_min_height: float = 0.08,
    min_component_area_m2: float = 0.3,
    padding: float = 0.5,
) -> ClusterRemovalResult:
    """Remove obstacle points belonging to small connected components in the
    2D occupied-cell grid (8-connectivity). Floor-height points are never
    removed by this pass -- only points above `obstacle_min_height` (the
    same convention as rasterize_occupancy_grid) are candidates, since
    that's what actually forms distinguishable clusters.

    `min_component_area_m2` (not a raw cell count, so the threshold means
    the same thing regardless of `resolution`) defaults to 0.3 m^2 -- a bit
    above a standing person's footprint (~0.15-0.25 m^2 at shoulder width)
    and comfortably below most furniture (a desk is often 0.7+ m^2).
    """
    occ = rasterize_occupancy_grid(
        points, resolution=resolution, obstacle_min_height=obstacle_min_height, padding=padding
    )
    occupied_mask = occ.grid == OCCUPIED

    structure = np.ones((3, 3), dtype=bool)  # 8-connectivity
    labels, num_components = ndimage.label(occupied_mask, structure=structure)

    if num_components == 0:
        return ClusterRemovalResult(points, colors, np.zeros(len(points), dtype=bool), 0, 0, [])

    min_component_cells = min_component_area_m2 / (resolution**2)
    sizes = ndimage.sum(occupied_mask, labels, index=np.arange(1, num_components + 1))
    small_labels = np.nonzero(sizes < min_component_cells)[0] + 1
    removed_component_sizes = sorted(sizes[small_labels - 1].astype(int).tolist(), reverse=True)

    x, y, z = points[:, 0], points[:, 1], points[:, 2]
    col = np.clip(((x - occ.origin[0]) / occ.resolution).astype(np.int64), 0, occ.grid.shape[1] - 1)
    row = np.clip(((y - occ.origin[1]) / occ.resolution).astype(np.int64), 0, occ.grid.shape[0] - 1)

    point_labels = labels[row, col]
    obstacle_mask = z > obstacle_min_height
    removed_mask = obstacle_mask & np.isin(point_labels, small_labels)

    kept_points = points[~removed_mask]
    kept_colors = colors[~removed_mask] if colors is not None else None

    return ClusterRemovalResult(
        points=kept_points,
        colors=kept_colors,
        removed_mask=removed_mask,
        num_components=num_components,
        kept_component_count=num_components - len(small_labels),
        removed_component_sizes=removed_component_sizes,
    )
