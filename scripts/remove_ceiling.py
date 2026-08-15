#!/usr/bin/env python
"""CLI: remove the ceiling from an indoor LiDAR point cloud (PLAN.md Phase 1).

Usage:
    python scripts/remove_ceiling.py input.ply output.ply
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from studio.moving_objects import remove_isolated_clusters
from studio.point_cloud_io import load_point_cloud, save_point_cloud
from studio.preprocess import remove_ceiling


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input_ply", type=Path)
    parser.add_argument("output_ply", type=Path)
    parser.add_argument("--distance-threshold", type=float, default=0.02, help="RANSAC plane inlier distance (m)")
    parser.add_argument("--ransac-iterations", type=int, default=1000)
    parser.add_argument("--ceiling-margin", type=float, default=0.05, help="Cut this far below the detected ceiling (m)")
    parser.add_argument("--floor-margin", type=float, default=0.05, help="Cut points more than this far below the detected floor (m)")
    parser.add_argument("--outlier-k", type=int, default=16)
    parser.add_argument("--outlier-std-ratio", type=float, default=2.0)
    parser.add_argument("--seed", type=int, default=None)
    parser.add_argument(
        "--remove-isolated-clusters",
        action="store_true",
        help="also remove small spatially-isolated obstacle clusters (heuristic 'moving object' "
        "removal -- see studio/moving_objects.py; on real scans this can catch scan-boundary "
        "noise as much as actual moving objects, off by default until you've checked it on your data)",
    )
    parser.add_argument("--isolated-cluster-min-area", type=float, default=0.3, help="m^2; smaller connected clusters get removed")
    args = parser.parse_args()

    points, colors = load_point_cloud(args.input_ply)
    print(f"loaded {len(points)} points from {args.input_ply}")

    result = remove_ceiling(
        points,
        colors,
        distance_threshold=args.distance_threshold,
        num_iterations=args.ransac_iterations,
        ceiling_margin=args.ceiling_margin,
        floor_margin=args.floor_margin,
        outlier_k=args.outlier_k,
        outlier_std_ratio=args.outlier_std_ratio,
        seed=args.seed,
    )

    print(f"floor source: {result.floor_z_source}")
    print(f"ceiling z: {result.ceiling_z}")
    print(f"below-floor points removed: {result.below_floor_removed}")
    print(f"outliers removed: {result.outliers_removed}")

    out_points, out_colors = result.points, result.colors
    if args.remove_isolated_clusters:
        cluster_result = remove_isolated_clusters(
            out_points, out_colors, min_component_area_m2=args.isolated_cluster_min_area
        )
        removed_n = int(cluster_result.removed_mask.sum())
        out_points, out_colors = cluster_result.points, cluster_result.colors
        print(
            f"isolated clusters removed: {removed_n} points across "
            f"{cluster_result.num_components - cluster_result.kept_component_count} components "
            f"(kept {cluster_result.kept_component_count}/{cluster_result.num_components}) -- "
            f"inspect before trusting on real data, see PLAN.md"
        )

    save_point_cloud(args.output_ply, out_points, out_colors)
    print(f"wrote {len(out_points)} points to {args.output_ply}")


if __name__ == "__main__":
    main()
