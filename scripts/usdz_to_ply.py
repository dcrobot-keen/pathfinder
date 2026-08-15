#!/usr/bin/env python
"""CLI: convert a .usdz/.usd LiDAR scan (e.g. from an iPhone scanning app)
into a plain PLY point cloud, Z-up meters, ready for scripts/remove_ceiling.py.

Usage:
    python scripts/usdz_to_ply.py scan.usdz scan.ply
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from studio.point_cloud_io import save_point_cloud
from studio.usdz_import import load_usdz_points


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input_usdz", type=Path)
    parser.add_argument("output_ply", type=Path)
    args = parser.parse_args()

    points = load_usdz_points(str(args.input_usdz))
    print(f"extracted {len(points)} points from {args.input_usdz}")

    save_point_cloud(args.output_ply, points)
    print(f"wrote {args.output_ply}")


if __name__ == "__main__":
    main()
