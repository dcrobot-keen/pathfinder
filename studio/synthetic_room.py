"""Synthetic indoor point cloud generator, used to validate the ceiling-removal
pipeline before real iPhone LiDAR scans are available.
"""
from __future__ import annotations

import numpy as np


def generate_room(
    width: float = 4.0,
    depth: float = 5.0,
    height: float = 2.7,
    points_per_surface: int = 4000,
    noise_std: float = 0.01,
    num_outliers: int = 40,
    seed: int = 0,
) -> np.ndarray:
    """Generate a point cloud for a rectangular room: floor, ceiling, 4 walls,
    a table-like piece of furniture (to verify it survives ceiling removal),
    plus a handful of far-away outlier points (to exercise outlier removal).
    """
    rng = np.random.default_rng(seed)

    def jitter(pts: np.ndarray) -> np.ndarray:
        return pts + rng.normal(0.0, noise_std, size=pts.shape)

    def rand2(n):
        return rng.uniform(0, 1, size=(n, 2))

    floor = jitter(
        np.column_stack(
            [rand2(points_per_surface)[:, 0] * width, rand2(points_per_surface)[:, 1] * depth, np.zeros(points_per_surface)]
        )
    )
    ceiling = jitter(
        np.column_stack(
            [rand2(points_per_surface)[:, 0] * width, rand2(points_per_surface)[:, 1] * depth, np.full(points_per_surface, height)]
        )
    )

    n_wall = points_per_surface // 2
    wall_x0 = jitter(np.column_stack([np.zeros(n_wall), rand2(n_wall)[:, 0] * depth, rand2(n_wall)[:, 1] * height]))
    wall_x1 = jitter(np.column_stack([np.full(n_wall, width), rand2(n_wall)[:, 0] * depth, rand2(n_wall)[:, 1] * height]))
    wall_y0 = jitter(np.column_stack([rand2(n_wall)[:, 0] * width, np.zeros(n_wall), rand2(n_wall)[:, 1] * height]))
    wall_y1 = jitter(np.column_stack([rand2(n_wall)[:, 0] * width, np.full(n_wall, depth), rand2(n_wall)[:, 1] * height]))

    # Table: 1.2m x 0.8m top at 0.75m height, centered in the room.
    n_table = 1500
    table_top = jitter(
        np.column_stack(
            [
                width / 2 - 0.6 + rand2(n_table)[:, 0] * 1.2,
                depth / 2 - 0.4 + rand2(n_table)[:, 1] * 0.8,
                np.full(n_table, 0.75),
            ]
        )
    )

    outliers = rng.uniform(
        low=[-2.0, -2.0, -2.0], high=[width + 2.0, depth + 2.0, height + 2.0], size=(num_outliers, 3)
    )

    points = np.concatenate(
        [floor, ceiling, wall_x0, wall_x1, wall_y0, wall_y1, table_top, outliers], axis=0
    )
    rng.shuffle(points)
    return points
