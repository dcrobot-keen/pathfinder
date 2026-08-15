#!/usr/bin/env python
"""CLI: vectorize a classified base map (scripts/classify_points.py output)
into wall line segments + furniture footprints, exported as GeoJSON.

Usage:
    python scripts/vectorize_map.py classified.ply output.geojson [--png preview.png]
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from studio.classify import FURNITURE, WALL, colors_to_labels
from studio.point_cloud_io import load_point_cloud
from studio.vectorize import (
    detect_furniture_footprints,
    detect_wall_lines,
    merge_collinear_segments,
    rasterize_label_mask,
    to_geojson,
)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("classified_ply", type=Path, help="output of scripts/classify_points.py")
    parser.add_argument("output_geojson", type=Path)
    parser.add_argument("--resolution", type=float, default=0.05, help="meters per cell for the intermediate wall/furniture grids")
    parser.add_argument("--min-line-length", type=float, default=0.4, help="meters; shorter Hough detections are discarded")
    parser.add_argument("--no-furniture", action="store_true", help="walls only, skip furniture footprint polygons")
    parser.add_argument("--png", type=Path, default=None, help="write a preview PNG of the vectorized result")
    args = parser.parse_args()

    points, colors = load_point_cloud(args.classified_ply)
    if colors is None:
        parser.error(f"{args.classified_ply} has no per-point color -- expected output from scripts/classify_points.py")
    labels = colors_to_labels(colors)
    print(f"loaded {len(points)} points ({int((labels == WALL).sum())} wall, {int((labels == FURNITURE).sum())} furniture)")

    wall_grid = rasterize_label_mask(points, labels, WALL, resolution=args.resolution)
    raw_segments = detect_wall_lines(wall_grid, min_line_length_m=args.min_line_length)
    walls = merge_collinear_segments(raw_segments)
    print(f"walls: {len(raw_segments)} raw Hough detections -> {len(walls)} merged segments")

    furniture = []
    if not args.no_furniture:
        furniture = detect_furniture_footprints(points, labels, resolution=args.resolution)
        print(f"furniture: {len(furniture)} footprints")

    geojson = to_geojson(walls, furniture)
    args.output_geojson.write_text(json.dumps(geojson, indent=2), encoding="utf-8")
    print(f"wrote {args.output_geojson} ({len(geojson['features'])} features)")

    if args.png:
        import matplotlib

        matplotlib.use("Agg")
        import matplotlib.pyplot as plt

        fig, ax = plt.subplots(figsize=(9, 9))
        for item in furniture:
            xs = [c[0] for c in item.corners] + [item.corners[0][0]]
            ys = [c[1] for c in item.corners] + [item.corners[0][1]]
            ax.fill(xs, ys, color="moccasin", alpha=0.6, edgecolor="darkorange", linewidth=0.5)
        for wall in walls:
            ax.plot([wall.p1[0], wall.p2[0]], [wall.p1[1], wall.p2[1]], color="blue", linewidth=2)
        ax.set_aspect("equal")
        ax.set_title(f"vectorized: {len(walls)} walls, {len(furniture)} furniture footprints")
        fig.savefig(args.png, dpi=150)
        print(f"wrote {args.png}")


if __name__ == "__main__":
    main()
