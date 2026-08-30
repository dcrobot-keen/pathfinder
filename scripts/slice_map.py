#!/usr/bin/env python
"""CLI: rasterize a floor/ceiling-cleaned base map PLY into a 2D occupancy grid
AT A SPECIFIC SENSOR HEIGHT (studio.slice_map) instead of the full-height
column projection. Use one --z per robot (its 2D LiDAR mount height) so the
same iPhone scan yields a map that matches what that robot actually sees.

Writes:
  <prefix>.json        slicemap-v1 (compact, self-describing; robot-os-chromium reads this)
  <prefix>.pgm/.yaml   ROS map_server pair (for nav2 / studio viewers)
  <prefix>.png         free/occupied/unknown preview (with --png)

`base_map.ply` (a project's ceiling-removed, floor-normalized cloud) is
already z=0-at-floor -> pass --already-normalized. Only `raw.ply` needs the
remove_ceiling pass.

Usage:
  python scripts/slice_map.py projects/bedroom/base_map.ply out/bedroom_tb3 --z 0.18 --already-normalized --classify --png
  python scripts/slice_map.py projects/bedroom/raw.ply      out/bedroom_tb3 --z 0.18 --classify
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import numpy as np

from studio.point_cloud_io import load_point_cloud
from studio.preprocess import remove_ceiling
from studio.rasterize import FREE, OCCUPIED, save_occupancy_grid_pgm, save_occupancy_preview_png
from studio.slice_map import CLS_WALL, rasterize_slice, save_slice_json


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("input_ply", type=Path)
    parser.add_argument("output_prefix", type=Path, help="output path without extension, e.g. out/bedroom_tb3")
    parser.add_argument("--z", type=float, required=True, help="slice centre height (m above floor) = robot LiDAR mount height")
    parser.add_argument("--band", type=float, default=0.05, help="slice half-thickness (m); widen if the slice is too sparse")
    parser.add_argument("--resolution", type=float, default=0.05, help="meters per cell")
    parser.add_argument("--padding", type=float, default=0.5, help="extra margin (m) around the point cloud bounds")
    parser.add_argument("--floor-tolerance", type=float, default=0.05, help="points <= this height (m) count as floor")
    parser.add_argument("--already-normalized", action="store_true",
                        help="skip remove_ceiling / floor-normalization (input PLY is already z=0-at-floor)")
    parser.add_argument("--classify", action="store_true",
                        help="also run floor/wall/furniture classification so wall cells are tagged (localizer can weight them)")
    parser.add_argument("--png", action="store_true", help="also write a PNG preview")
    parser.add_argument("--seed", type=int, default=0)
    args = parser.parse_args()

    points, _colors = load_point_cloud(args.input_ply)
    print(f"loaded {len(points)} points from {args.input_ply}")

    if args.already_normalized:
        norm = points
    else:
        result = remove_ceiling(points, seed=args.seed)
        norm = result.points
        print(f"ceiling removed / floor-normalized: {len(norm)} points")

    labels = None
    if args.classify:
        from studio.classify import classify_floor_wall_furniture

        cls = classify_floor_wall_furniture(norm, rng=np.random.default_rng(args.seed))
        labels = cls.labels
        print(f"classified: {int((labels == 1).sum())} wall pts, {int((labels == 2).sum())} furniture pts, "
              f"{cls.num_wall_planes} wall planes")

    sg = rasterize_slice(
        norm, z=args.z, band=args.band, resolution=args.resolution,
        padding=args.padding, floor_z_tolerance=args.floor_tolerance, labels=labels,
    )
    occ = sg.occ
    n_free = int((occ.grid == FREE).sum())
    n_occ = int((occ.grid == OCCUPIED).sum())
    n_unk = occ.grid.size - n_free - n_occ
    n_wall = int((sg.cls == CLS_WALL).sum())
    print(f"slice @ z={args.z}±{args.band} m: {occ.grid.shape[1]}x{occ.grid.shape[0]} cells @ {occ.resolution} m/cell, origin={occ.origin}")
    print(f"free={n_free} occupied={n_occ} (wall-tagged={n_wall}) unknown={n_unk}")

    args.output_prefix.parent.mkdir(parents=True, exist_ok=True)
    json_path = save_slice_json(args.output_prefix.with_suffix(".json"), sg)
    pgm_path, yaml_path = save_occupancy_grid_pgm(args.output_prefix, occ)
    print(f"wrote {json_path}")
    print(f"wrote {pgm_path}, {yaml_path}")
    if args.png:
        png_path = args.output_prefix.with_suffix(".png")
        save_occupancy_preview_png(png_path, occ)
        print(f"wrote {png_path}")


if __name__ == "__main__":
    main()
