#!/usr/bin/env python
"""CLI: classify a base map's points as floor/wall/furniture (PLAN.md
"스튜디오 제품 방향" priority #2 -- approximates FJD Trion Model's "자동 분류").

Rule-based (no labeled training data): floor = near z=0, walls = large
near-vertical RANSAC planes, everything else = furniture. See
studio/classify.py for the full method and caveats.

Usage:
    python scripts/classify_points.py base_map.ply classified.ply [--png topdown.png]
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import numpy as np

from studio.classify import FLOOR, FURNITURE, WALL, classify_floor_wall_furniture, labels_to_colors
from studio.point_cloud_io import load_point_cloud, save_point_cloud


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input_ply", type=Path)
    parser.add_argument("output_ply", type=Path)
    parser.add_argument("--floor-z-tolerance", type=float, default=0.05)
    parser.add_argument("--wall-distance-threshold", type=float, default=0.03)
    parser.add_argument("--seed", type=int, default=None)
    parser.add_argument("--png", type=Path, default=None, help="also write a colored top-down PNG (floor=gray, wall=blue, furniture=orange)")
    args = parser.parse_args()

    points, _ = load_point_cloud(args.input_ply)
    print(f"loaded {len(points)} points from {args.input_ply}")

    result = classify_floor_wall_furniture(
        points,
        floor_z_tolerance=args.floor_z_tolerance,
        wall_distance_threshold=args.wall_distance_threshold,
        rng=None if args.seed is None else np.random.default_rng(args.seed),
    )
    print(f"wall planes found: {result.num_wall_planes}")
    print(f"floor={result.count(FLOOR)} wall={result.count(WALL)} furniture={result.count(FURNITURE)}")

    colors = labels_to_colors(result.labels)
    save_point_cloud(args.output_ply, points, colors)
    print(f"wrote {args.output_ply}")

    if args.png:
        from studio.rasterize import rasterize_color_topdown, save_color_topdown_png

        topdown = rasterize_color_topdown(points, colors, resolution=0.03, padding=0.5)
        save_color_topdown_png(args.png, topdown)
        print(f"wrote {args.png}")


if __name__ == "__main__":
    main()
