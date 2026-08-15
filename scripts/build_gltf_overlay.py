#!/usr/bin/env python
"""CLI: merge a .usdz scan (textured mesh) and one or more PLY point clouds
into a single .glb, viewable in gltf-inspector
(https://github.com/dcrobot-keen/gltf-inspector) -- it loads one primary
glTF/GLB at a time, so this pre-merges everything into one file.

Usage:
    python scripts/build_gltf_overlay.py --mesh scan.usdz \
        --points base_map.ply:255,0,0 --points robot_map.ply:0,120,255 \
        --output overlay.glb
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from studio.gltf_export import PointCloudLayer, save_overlay_glb
from studio.point_cloud_io import load_point_cloud
from studio.usdz_import import load_usdz_mesh

DEFAULT_COLORS = [(255, 0, 0), (0, 140, 255), (0, 200, 100), (255, 190, 0)]


def parse_points_arg(arg: str, default_color: tuple[int, int, int]) -> PointCloudLayer:
    path_str, _, color_str = arg.partition(":")
    path = Path(path_str)
    if color_str:
        r, g, b = (int(v) for v in color_str.split(","))
    else:
        r, g, b = default_color

    points, _ = load_point_cloud(path)
    return PointCloudLayer(name=path.stem, points=points, color=(r, g, b, 255))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--mesh", type=Path, default=None, help=".usdz scan to include as a textured mesh")
    parser.add_argument(
        "--points",
        action="append",
        default=[],
        metavar="PLY[:R,G,B]",
        help="a PLY point cloud layer to overlay; repeatable. Color defaults to a rotating palette.",
    )
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()

    if not args.mesh and not args.points:
        parser.error("need at least --mesh or one --points")

    mesh = None
    if args.mesh:
        print(f"loading mesh from {args.mesh} ...")
        mesh = load_usdz_mesh(str(args.mesh))
        print(f"  {len(mesh.vertices)} vertices, {len(mesh.faces)} triangles, texture={'yes' if mesh.texture else 'no'}")

    layers = []
    for i, arg in enumerate(args.points):
        layer = parse_points_arg(arg, DEFAULT_COLORS[i % len(DEFAULT_COLORS)])
        print(f"loading points from {layer.name}: {len(layer.points)} points, color={layer.color[:3]}")
        layers.append(layer)

    args.output.parent.mkdir(parents=True, exist_ok=True)
    save_overlay_glb(mesh, layers, str(args.output))
    size_mb = args.output.stat().st_size / (1024 * 1024)
    print(f"wrote {args.output} ({size_mb:.1f} MB)")


if __name__ == "__main__":
    main()
