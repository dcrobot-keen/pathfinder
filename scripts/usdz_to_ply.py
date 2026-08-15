#!/usr/bin/env python
"""CLI: convert a .usdz/.usd LiDAR scan (e.g. from an iPhone scanning app)
into a plain PLY point cloud, Z-up meters, ready for scripts/remove_ceiling.py.

If the scan has a UV-mapped texture, per-vertex colors are sampled from it
(there's usually no per-vertex color primvar, just UV + a photo) so the
color survives into scripts/remove_ceiling.py's output and downstream
viewers, instead of every point being a flat placeholder color.

Usage:
    python scripts/usdz_to_ply.py scan.usdz scan.ply
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from studio.point_cloud_io import save_point_cloud
from studio.usdz_import import load_usdz_mesh, sample_vertex_colors


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input_usdz", type=Path)
    parser.add_argument("output_ply", type=Path)
    args = parser.parse_args()

    mesh = load_usdz_mesh(str(args.input_usdz))
    print(f"extracted {len(mesh.vertices)} points from {args.input_usdz}")

    colors = None
    if mesh.uv is not None and mesh.texture is not None:
        colors = sample_vertex_colors(mesh.uv, mesh.texture)
        print("sampled per-vertex colors from the embedded texture")
    else:
        print("no UV/texture found -- writing without color")

    save_point_cloud(args.output_ply, mesh.vertices, colors)
    print(f"wrote {args.output_ply}")


if __name__ == "__main__":
    main()
