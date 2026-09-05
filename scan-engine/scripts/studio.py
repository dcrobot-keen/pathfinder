#!/usr/bin/env python
"""Scan-to-Map Studio orchestrator (PLAN.md Phase 5).

Runs the full pipeline in one command instead of chaining 5 separate
scripts by hand, and keeps every project's inputs/outputs in one folder
(projects/<name>/) the way FJD Trion Model's "project" concept works
(PLAN.md section 7) -- but web/CLI-native instead of a desktop app.

Usage:
    python scripts/studio.py new <project_name>
    python scripts/studio.py process <project_name> --usdz scan.usdz \
        [--robot-map robot_map_prefix] [--trajectory traj.json]

Output layout (projects/<name>/):
    raw.ply            -- the .usdz converted to a point cloud (with color if available)
    base_map.ply        -- after ceiling/floor/outlier removal
    map/map.pgm+.yaml    -- occupancy grid (nav2 map_server format)
    map/map.png          -- free/occupied/unknown preview
    map/map_color.png    -- top-down colored floor plan (if raw.ply had color)
    registration.png      -- robot map overlay (only if --robot-map given)
    align.html             -- interactive alignment verify/fine-tune viewer (only if --robot-map given)
    viewer.html           -- 2D playback viewer (self-contained HTML)
    overlay.glb            -- 3D mesh+points overlay for gltf-inspector
    output.geojson          -- room outline(s) + furniture footprints (vector)
    report.html / report.json -- single-page summary / same stats as JSON
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from studio.pipeline import run_pipeline
from studio.project import PROJECTS_ROOT, create_project


def cmd_new(args: argparse.Namespace) -> None:
    try:
        proj_dir = create_project(args.name)
    except FileExistsError:
        print(f"project already exists: {PROJECTS_ROOT / args.name}")
        return
    print(f"created project: {proj_dir}")


def _print_progress(step_key: str, status: str, data: dict) -> None:
    """Reconstructs the original cmd_process print() lines from
    studio.pipeline.run_pipeline's structured progress callback, so CLI
    output is unchanged by the refactor. See studio/pipeline.py's docstring."""
    if step_key == "import" and status == "active":
        print("[1/5] importing scan...")
    elif step_key == "import" and status == "done":
        print(f"  {data['num_vertices']} vertices, texture={'yes' if data['has_texture'] else 'no'}")
    elif step_key == "preprocess" and status == "active":
        print("[2/5] removing ceiling/floor/outliers...")
    elif step_key == "preprocess" and status == "done":
        print(f"  {data['num_points']} points, ceiling_z={data['ceiling_z']}")
        if data["isolated_clusters_removed"] is not None:
            print(f"  removed {data['isolated_clusters_removed']} points in isolated clusters")
    elif step_key == "classify" and status == "done":
        print(f"  wall planes found: {data['num_wall_planes']}")
    elif step_key == "rasterize" and status == "active":
        print("[3/5] rasterizing 2D map...")
    elif step_key == "rasterize" and status == "done":
        print(f"  free={data['n_free']} occupied={data['n_occupied']}")
    elif step_key == "registration" and status == "active":
        print("[4/5] registering robot map...")
    elif step_key == "registration" and status == "done":
        print(f"  rotation={data['rotation_deg']:.2f}deg rmse={data['rmse']:.4f}")
    elif step_key == "registration" and status == "skip":
        print("[4/5] no --robot-map given, skipping registration")
    elif step_key == "vectorize" and status == "done":
        print(f"  rooms={data['num_rooms']} furniture={data['num_furniture']} -> output.geojson")
    elif step_key == "viewer" and status == "active":
        print("[5/5] building viewers...")


def cmd_process(args: argparse.Namespace) -> None:
    proj_dir = PROJECTS_ROOT / args.name
    result = run_pipeline(
        proj_dir,
        usdz_path=args.usdz,
        ply_path=args.ply,
        robot_map_prefix=args.robot_map,
        trajectory_path=args.trajectory,
        remove_isolated_clusters=args.remove_isolated_clusters,
        isolated_cluster_min_area=args.isolated_cluster_min_area,
        classify=args.classify,
        on_progress=_print_progress,
    )
    print(f"\ndone. open {result.report_html_path}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    subparsers = parser.add_subparsers(dest="command", required=True)

    new_parser = subparsers.add_parser("new", help="create an empty project folder")
    new_parser.add_argument("name")
    new_parser.set_defaults(func=cmd_new)

    process_parser = subparsers.add_parser("process", help="run the full pipeline for a project")
    process_parser.add_argument("name")
    scan_source = process_parser.add_mutually_exclusive_group(required=True)
    scan_source.add_argument("--usdz", type=Path, default=None)
    scan_source.add_argument(
        "--ply",
        type=Path,
        default=None,
        help="already-built point cloud (Z-up meters), skips the usdz->ply import step -- "
        "e.g. dc-vps's pipeline/export_pointcloud.py output",
    )
    process_parser.add_argument("--robot-map", type=Path, default=None, help="robot occupancy grid prefix (.pgm/.yaml) to register against")
    process_parser.add_argument("--trajectory", type=Path, default=None, help="trajectory JSON; omit for a synthetic demo path")
    process_parser.add_argument(
        "--remove-isolated-clusters",
        action="store_true",
        help="heuristic 'moving object' removal (see studio/moving_objects.py) -- off by default, "
        "can catch scan-boundary noise as much as real moving objects on real data",
    )
    process_parser.add_argument("--isolated-cluster-min-area", type=float, default=0.3, help="m^2; smaller connected clusters get removed")
    process_parser.add_argument(
        "--classify",
        action="store_true",
        help="rule-based floor/wall/furniture classification (see studio/classify.py) -- off by "
        "default, adds classified.ply + a colored top-down PNG to the report",
    )
    process_parser.set_defaults(func=cmd_process)

    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
