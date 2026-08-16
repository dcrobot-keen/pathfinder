#!/usr/bin/env python
"""CLI: vectorize a classified base map (scripts/classify_points.py output)
into a room-outline polygon + furniture footprints, exported as GeoJSON.

Usage:
    python scripts/vectorize_map.py classified.ply output.geojson [--png preview.png]
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from studio.classify import WALL, colors_to_labels
from studio.point_cloud_io import load_point_cloud
from studio.vectorize import (
    _polygon_area_m2,
    detect_furniture_polygons,
    detect_wall_lines,
    dominant_angle_deg,
    merge_collinear_segments,
    rasterize_interior_mask,
    rasterize_label_mask,
    rectify_orthogonal,
    to_geojson,
    trace_room_polygons,
)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("classified_ply", type=Path, help="output of scripts/classify_points.py")
    parser.add_argument("output_geojson", type=Path)
    parser.add_argument("--resolution", type=float, default=0.05, help="meters per cell for the intermediate grids")
    parser.add_argument("--room-min-area", type=float, default=2.0, help="m^2; smaller scanned regions are discarded as noise")
    parser.add_argument("--simplify", type=float, default=0.35, help="meters; room outline polygon simplification tolerance (larger = fewer, straighter walls; smaller preserves small alcoves/nooks)")
    parser.add_argument("--close-radius", type=float, default=0.3, help="meters; morphological closing radius to bridge small scan gaps before contour tracing")
    parser.add_argument("--no-rooms", action="store_true", help="skip room-outline polygons")
    parser.add_argument("--no-furniture", action="store_true", help="skip furniture footprint polygons")
    parser.add_argument("--no-rectify", action="store_true", help="skip orthogonal (right-angle) snapping of room/furniture polygon edges")
    parser.add_argument("--walls", action="store_true", help="also include legacy Hough-line wall segments (debug/comparison; superseded by room outlines)")
    parser.add_argument("--min-line-length", type=float, default=0.4, help="meters; used only with --walls")
    parser.add_argument("--png", type=Path, default=None, help="write a preview PNG of the vectorized result")
    args = parser.parse_args()

    points, colors = load_point_cloud(args.classified_ply)
    if colors is None:
        parser.error(f"{args.classified_ply} has no per-point color -- expected output from scripts/classify_points.py")
    labels = colors_to_labels(colors)

    rooms = []
    if not args.no_rooms:
        interior = rasterize_interior_mask(points, resolution=args.resolution)
        rooms = trace_room_polygons(
            interior,
            min_area_m2=args.room_min_area,
            simplify_epsilon_m=args.simplify,
            close_radius_m=args.close_radius,
        )
        print(f"rooms: {len(rooms)} polygon(s)")
        for i, ring in enumerate(rooms):
            print(f"  room {i}: {len(ring)} corners, {_polygon_area_m2(ring):.1f} m^2")

    furniture = []
    if not args.no_furniture:
        furniture = detect_furniture_polygons(points, labels, resolution=args.resolution)
        print(f"furniture: {len(furniture)} footprints")

    if not args.no_rectify and (rooms or furniture):
        # Use the largest room's dominant angle as the building's shared
        # orientation -- furniture pieces are individually too small/noisy
        # to reliably recover it on their own (see rectify_orthogonal docstring).
        if rooms:
            largest = max(rooms, key=_polygon_area_m2)
            angle = dominant_angle_deg(largest)
        else:
            angle = dominant_angle_deg(max(furniture, key=lambda f: f.area_m2).corners)
        print(f"rectify: snapping to dominant angle {angle:.1f} deg")

        rooms = [rectify_orthogonal(ring, angle_deg=angle) for ring in rooms]
        for i, ring in enumerate(rooms):
            print(f"  room {i} (rectified): {len(ring)} corners, {_polygon_area_m2(ring):.1f} m^2")

        furniture = [
            type(item)(corners=rectify_orthogonal(item.corners, angle_deg=angle), area_m2=item.area_m2)
            for item in furniture
        ]

    walls = []
    if args.walls:
        wall_grid = rasterize_label_mask(points, labels, WALL, resolution=args.resolution)
        raw_segments = detect_wall_lines(wall_grid, min_line_length_m=args.min_line_length)
        walls = merge_collinear_segments(raw_segments)
        print(f"walls (legacy Hough, debug only): {len(raw_segments)} raw -> {len(walls)} merged")

    geojson = to_geojson(walls=walls, furniture=furniture, rooms=rooms)
    args.output_geojson.write_text(json.dumps(geojson, indent=2), encoding="utf-8")
    print(f"wrote {args.output_geojson} ({len(geojson['features'])} features)")

    if args.png:
        import matplotlib

        matplotlib.use("Agg")
        import matplotlib.pyplot as plt

        fig, ax = plt.subplots(figsize=(9, 9))
        for ring in rooms:
            xs = [c[0] for c in ring] + [ring[0][0]]
            ys = [c[1] for c in ring] + [ring[0][1]]
            ax.fill(xs, ys, color="lightgreen", alpha=0.25, edgecolor="darkgreen", linewidth=2)
        for item in furniture:
            xs = [c[0] for c in item.corners] + [item.corners[0][0]]
            ys = [c[1] for c in item.corners] + [item.corners[0][1]]
            ax.fill(xs, ys, color="moccasin", alpha=0.6, edgecolor="darkorange", linewidth=0.5)
        for wall in walls:
            ax.plot([wall.p1[0], wall.p2[0]], [wall.p1[1], wall.p2[1]], color="blue", linewidth=1, linestyle="--")
        ax.set_aspect("equal")
        ax.set_title(f"vectorized: {len(rooms)} room(s), {len(furniture)} furniture footprints")
        fig.savefig(args.png, dpi=150)
        print(f"wrote {args.png}")


if __name__ == "__main__":
    main()
