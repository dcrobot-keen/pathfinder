#!/usr/bin/env python
"""CLI: rasterize a floor/ceiling-cleaned base map PLY into a ROS map_server
occupancy grid (.pgm + .yaml), plus a PNG preview (PLAN.md section 3.3).

Usage:
    python scripts/rasterize_base_map.py base_map.ply output/map
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np

from studio.point_cloud_io import load_point_cloud
from studio.rasterize import (
    FREE,
    OCCUPIED,
    rasterize_color_topdown,
    rasterize_occupancy_grid,
    save_color_topdown_png,
    save_occupancy_grid_pgm,
)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input_ply", type=Path)
    parser.add_argument("output_prefix", type=Path, help="output path without extension, e.g. output/map")
    parser.add_argument("--resolution", type=float, default=0.05, help="meters per cell")
    parser.add_argument("--obstacle-min-height", type=float, default=0.08, help="points above this height (m) count as obstacles")
    parser.add_argument("--padding", type=float, default=0.5, help="extra margin (m) around the point cloud bounds")
    parser.add_argument("--png", action="store_true", help="also write a PNG preview next to the pgm/yaml")
    args = parser.parse_args()

    points, colors = load_point_cloud(args.input_ply)
    print(f"loaded {len(points)} points from {args.input_ply}")

    occ = rasterize_occupancy_grid(
        points,
        resolution=args.resolution,
        obstacle_min_height=args.obstacle_min_height,
        padding=args.padding,
    )
    args.output_prefix.parent.mkdir(parents=True, exist_ok=True)
    pgm_path, yaml_path = save_occupancy_grid_pgm(args.output_prefix, occ)

    n_free = int((occ.grid == FREE).sum())
    n_occupied = int((occ.grid == OCCUPIED).sum())
    n_unknown = occ.grid.size - n_free - n_occupied
    print(f"grid: {occ.grid.shape[1]}x{occ.grid.shape[0]} cells @ {occ.resolution} m/cell, origin={occ.origin}")
    print(f"free={n_free} occupied={n_occupied} unknown={n_unknown}")
    print(f"wrote {pgm_path}, {yaml_path}")

    if args.png:
        rgb = np.zeros((*occ.grid.shape, 3), dtype=np.uint8)
        rgb[occ.grid == FREE] = (255, 255, 255)
        rgb[occ.grid == OCCUPIED] = (0, 0, 0)
        rgb[occ.grid == -1] = (128, 128, 128)
        png_path = args.output_prefix.with_suffix(".png")
        plt.imsave(png_path, np.flipud(rgb))
        print(f"wrote {png_path}")

        if colors is not None:
            color_topdown = rasterize_color_topdown(
                points, colors, origin=occ.origin, grid_shape=occ.grid.shape
            )
            color_png_path = args.output_prefix.parent / f"{args.output_prefix.name}_color.png"
            save_color_topdown_png(color_png_path, color_topdown)
            print(f"wrote {color_png_path} (top-down, original scan colors)")


if __name__ == "__main__":
    main()
