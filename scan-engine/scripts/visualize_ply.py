#!/usr/bin/env python
"""Render a PLY point cloud to a PNG (isometric + top + front views) for quick
visual inspection, since there's no 3D GUI viewer wired up yet (see PLAN.md 3.4).

Usage:
    python scripts/visualize_ply.py input.ply output.png
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


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input_ply", type=Path)
    parser.add_argument("output_png", type=Path)
    parser.add_argument("--point-size", type=float, default=1.5)
    parser.add_argument("--max-points", type=int, default=60000, help="subsample if the cloud is larger than this")
    args = parser.parse_args()

    points, colors = load_point_cloud(args.input_ply)
    print(f"loaded {len(points)} points from {args.input_ply}")

    if len(points) > args.max_points:
        idx = np.random.default_rng(0).choice(len(points), args.max_points, replace=False)
        points = points[idx]
        if colors is not None:
            colors = colors[idx]

    if colors is not None:
        c = colors.astype(np.float64) / 255.0
    else:
        c = points[:, 2]  # color by height

    fig = plt.figure(figsize=(15, 5))

    ax1 = fig.add_subplot(131, projection="3d")
    ax1.scatter(points[:, 0], points[:, 1], points[:, 2], c=c, cmap="viridis", s=args.point_size, linewidths=0)
    ax1.set_title("isometric")
    ax1.set_xlabel("x")
    ax1.set_ylabel("y")
    ax1.set_zlabel("z")
    ax1.view_init(elev=25, azim=-60)

    ax2 = fig.add_subplot(132)
    ax2.scatter(points[:, 0], points[:, 1], c=c, cmap="viridis", s=args.point_size, linewidths=0)
    ax2.set_title("top view (x-y)")
    ax2.set_xlabel("x")
    ax2.set_ylabel("y")
    ax2.set_aspect("equal")

    ax3 = fig.add_subplot(133)
    ax3.scatter(points[:, 0], points[:, 2], c=c, cmap="viridis", s=args.point_size, linewidths=0)
    ax3.set_title("front view (x-z)")
    ax3.set_xlabel("x")
    ax3.set_ylabel("z")
    ax3.set_aspect("equal")

    fig.suptitle(f"{args.input_ply.name} ({len(points)} pts shown)")
    fig.tight_layout()
    fig.savefig(args.output_png, dpi=150)
    print(f"wrote {args.output_png}")


if __name__ == "__main__":
    main()
