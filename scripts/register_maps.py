#!/usr/bin/env python
"""CLI: register a robot-generated occupancy grid onto the LiDAR base map's
occupancy grid via 2D ICP (PLAN.md section 3.3 / "점군 정렬" backlog item).

Usage:
    python scripts/register_maps.py base_map_prefix robot_map_prefix --png overlay.png

Both *_prefix arguments point to a .pgm+.yaml pair written by
scripts/rasterize_base_map.py (extension omitted).
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from studio.rasterize import FREE, OCCUPIED, UNKNOWN, cell_centers_world, load_occupancy_grid_pgm
from studio.registration import icp_2d_multistart


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("base_map_prefix", type=Path, help="base map .pgm/.yaml prefix (reference, stays fixed)")
    parser.add_argument("robot_map_prefix", type=Path, help="robot map .pgm/.yaml prefix (source, gets aligned)")
    parser.add_argument("--max-correspondence-distance", type=float, default=0.5, help="meters; ignore ICP matches farther than this")
    parser.add_argument("--png", type=Path, default=None, help="write an overlay PNG (base=gray, robot map aligned=red) here")
    args = parser.parse_args()

    base_occ = load_occupancy_grid_pgm(args.base_map_prefix)
    robot_occ = load_occupancy_grid_pgm(args.robot_map_prefix)

    base_points = cell_centers_world(base_occ, OCCUPIED)
    robot_points = cell_centers_world(robot_occ, OCCUPIED)
    print(f"base map occupied cells: {len(base_points)}, robot map occupied cells: {len(robot_points)}")

    result = icp_2d_multistart(
        source=robot_points, target=base_points, max_correspondence_distance=args.max_correspondence_distance
    )
    print(f"recovered rotation: {result.rotation_deg:.2f} deg")
    print(f"recovered translation: {result.translation}")
    print(f"final rmse: {result.rmse:.4f} m over {result.iterations} iterations")

    if args.png:
        import matplotlib

        matplotlib.use("Agg")
        import matplotlib.pyplot as plt

        fig, ax = plt.subplots(figsize=(8, 8))
        ax.scatter(base_points[:, 0], base_points[:, 1], s=2, c="gray", label="base map")
        ax.scatter(result.aligned_source[:, 0], result.aligned_source[:, 1], s=2, c="red", alpha=0.6, label="robot map (aligned)")
        ax.set_aspect("equal")
        ax.legend()
        ax.set_title(f"registration: rot={result.rotation_deg:.1f}deg, rmse={result.rmse:.3f}m")
        fig.savefig(args.png, dpi=150)
        print(f"wrote {args.png}")


if __name__ == "__main__":
    main()
