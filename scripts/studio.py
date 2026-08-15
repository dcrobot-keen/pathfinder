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
    viewer.html           -- 2D playback viewer (self-contained HTML)
    overlay.glb            -- 3D mesh+points overlay for gltf-inspector
    report.html             -- single-page summary linking everything above
"""
from __future__ import annotations

import argparse
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from studio.gltf_export import PointCloudLayer, save_overlay_glb
from studio.moving_objects import remove_isolated_clusters
from studio.point_cloud_io import save_point_cloud
from studio.preprocess import remove_ceiling
from studio.rasterize import (
    FREE,
    OCCUPIED,
    cell_centers_world,
    load_occupancy_grid_pgm,
    rasterize_color_topdown,
    rasterize_occupancy_grid,
    save_color_topdown_png,
    save_occupancy_grid_pgm,
)
from studio.registration import icp_2d_multistart
from studio.trajectory import generate_lawnmower_trajectory, load_trajectory
from studio.usdz_import import load_usdz_mesh, sample_vertex_colors
from studio.viewer_html import build_overlay_viewer_html

PROJECTS_ROOT = Path(__file__).resolve().parent.parent / "projects"

REPORT_TEMPLATE = """<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<title>{name} — Scan-to-Map Studio Report</title>
<style>
  body {{ font-family: system-ui, sans-serif; background: #1e1e1e; color: #eee; max-width: 900px; margin: 0 auto; padding: 24px; }}
  h1 {{ font-size: 20px; }}
  h2 {{ font-size: 15px; margin-top: 28px; border-bottom: 1px solid #444; padding-bottom: 6px; }}
  .meta {{ color: #999; font-size: 13px; }}
  .grid {{ display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 10px; }}
  img {{ max-width: 100%; border: 1px solid #444; border-radius: 4px; }}
  a {{ color: #6db8ff; }}
  .stat {{ font-variant-numeric: tabular-nums; }}
  ul {{ line-height: 1.7; }}
  code {{ background: #2a2a2a; padding: 1px 5px; border-radius: 3px; }}
</style>
</head>
<body>
<h1>{name}</h1>
<div class="meta">generated {timestamp}</div>

<h2>1. 스캔 → 베이스맵</h2>
<ul>{scan_summary}</ul>

<h2>2. 2D 지도</h2>
<div class="grid">
  <div><a href="map/map.png">map.png (occupancy grid)</a><br><img src="map/map.png"></div>
  {color_map_html}
</div>

{registration_html}

<h2>3. 인터랙티브 뷰어</h2>
<ul>
  <li><a href="viewer.html">viewer.html</a> — 궤적 재생 (2D, 브라우저에서 바로 열기)</li>
  <li><code>overlay.glb</code> — <a href="https://github.com/dcrobot-keen/gltf-inspector" target="_blank">gltf-inspector</a>에 드래그&드롭해서 3D로 확인 (원본 스캔 메시 + 처리된 포인트클라우드)</li>
</ul>

</body>
</html>
"""


def cmd_new(args: argparse.Namespace) -> None:
    proj_dir = PROJECTS_ROOT / args.name
    if proj_dir.exists():
        print(f"project already exists: {proj_dir}")
        return
    (proj_dir / "map").mkdir(parents=True)
    print(f"created project: {proj_dir}")


def cmd_process(args: argparse.Namespace) -> None:
    proj_dir = PROJECTS_ROOT / args.name
    (proj_dir / "map").mkdir(parents=True, exist_ok=True)
    scan_summary: list[str] = []

    print("[1/5] importing scan...")
    mesh = load_usdz_mesh(str(args.usdz))
    colors = None
    if mesh.uv is not None and mesh.texture is not None:
        colors = sample_vertex_colors(mesh.uv, mesh.texture)
    save_point_cloud(proj_dir / "raw.ply", mesh.vertices, colors)
    scan_summary.append(f"<li>원본 스캔: <span class=\"stat\">{len(mesh.vertices):,}</span>개 정점 (텍스처: {'있음' if mesh.texture else '없음'}) → <code>raw.ply</code></li>")
    print(f"  {len(mesh.vertices)} vertices, texture={'yes' if mesh.texture else 'no'}")

    print("[2/5] removing ceiling/floor/outliers...")
    result = remove_ceiling(mesh.vertices, colors, seed=0)
    base_points, base_colors = result.points, result.colors
    scan_summary.append(
        f"<li>베이스맵: <span class=\"stat\">{len(base_points):,}</span>개 점 "
        f"(천장 높이 {result.ceiling_z:.2f}m, 이상치 {result.outliers_removed:,}개 제거) → <code>base_map.ply</code></li>"
    )
    print(f"  {len(base_points)} points, ceiling_z={result.ceiling_z}")

    if args.remove_isolated_clusters:
        cluster_result = remove_isolated_clusters(
            base_points, base_colors, min_component_area_m2=args.isolated_cluster_min_area
        )
        base_points, base_colors = cluster_result.points, cluster_result.colors
        removed_n = int(cluster_result.removed_mask.sum())
        scan_summary.append(
            f"<li>고립 클러스터(이동 물체 추정) 제거: <span class=\"stat\">{removed_n:,}</span>개 점, "
            f"{cluster_result.num_components - cluster_result.kept_component_count}개 컴포넌트 "
            f"(실제 데이터에서는 스캔 경계 노이즈일 수 있음 — PLAN.md 참고)</li>"
        )
        print(f"  removed {removed_n} points in isolated clusters")

    save_point_cloud(proj_dir / "base_map.ply", base_points, base_colors)

    print("[3/5] rasterizing 2D map...")
    occ = rasterize_occupancy_grid(base_points)
    save_occupancy_grid_pgm(proj_dir / "map" / "map", occ)
    n_free = int((occ.grid == FREE).sum())
    n_occupied = int((occ.grid == OCCUPIED).sum())

    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    import numpy as np

    rgb = np.zeros((*occ.grid.shape, 3), dtype=np.uint8)
    rgb[occ.grid == FREE] = (255, 255, 255)
    rgb[occ.grid == OCCUPIED] = (0, 0, 0)
    rgb[occ.grid == -1] = (128, 128, 128)
    plt.imsave(proj_dir / "map" / "map.png", np.flipud(rgb))

    color_map_html = ""
    if base_colors is not None:
        color_topdown = rasterize_color_topdown(base_points, base_colors, resolution=0.02, padding=0.5)
        save_color_topdown_png(proj_dir / "map" / "map_color.png", color_topdown)
        color_map_html = '<div><a href="map/map_color.png">map_color.png (원본 색 top-down)</a><br><img src="map/map_color.png"></div>'
    print(f"  free={n_free} occupied={n_occupied}")

    registration_html = ""
    if args.robot_map:
        print("[4/5] registering robot map...")
        robot_occ = load_occupancy_grid_pgm(args.robot_map)
        base_pts = cell_centers_world(occ, OCCUPIED)
        robot_pts = cell_centers_world(robot_occ, OCCUPIED)
        reg = icp_2d_multistart(source=robot_pts, target=base_pts, max_correspondence_distance=0.5)

        fig, ax = plt.subplots(figsize=(8, 8))
        ax.scatter(base_pts[:, 0], base_pts[:, 1], s=2, c="gray", label="base map")
        ax.scatter(reg.aligned_source[:, 0], reg.aligned_source[:, 1], s=2, c="red", alpha=0.6, label="robot map (aligned)")
        ax.set_aspect("equal")
        ax.legend()
        ax.set_title(f"registration: rot={reg.rotation_deg:.1f}deg, rmse={reg.rmse:.3f}m")
        fig.savefig(proj_dir / "registration.png", dpi=150)

        registration_html = (
            "<h2>2b. 로봇 지도 정합</h2>"
            f'<p>회전 {reg.rotation_deg:.1f}&deg;, 이동 {reg.translation}, RMSE {reg.rmse:.3f}m '
            f"({reg.iterations}회 반복)</p>"
            '<img src="registration.png">'
        )
        print(f"  rotation={reg.rotation_deg:.2f}deg rmse={reg.rmse:.4f}")
    else:
        print("[4/5] no --robot-map given, skipping registration")

    print("[5/5] building viewers...")
    if args.trajectory:
        poses = load_trajectory(args.trajectory)
    else:
        height, width = occ.grid.shape
        x_min = occ.origin[0] + width * occ.resolution * 0.15
        x_max = occ.origin[0] + width * occ.resolution * 0.85
        y_min = occ.origin[1] + height * occ.resolution * 0.15
        y_max = occ.origin[1] + height * occ.resolution * 0.85
        poses = generate_lawnmower_trajectory((x_min, x_max), (y_min, y_max))
    viewer_html = build_overlay_viewer_html(occ, poses, title=f"{args.name} — Overlay Viewer")
    (proj_dir / "viewer.html").write_text(viewer_html, encoding="utf-8")

    layer_color = base_colors if base_colors is not None else (255, 0, 0, 255)
    save_overlay_glb(
        mesh,
        [PointCloudLayer(name="base_map", points=base_points, color=layer_color)],
        str(proj_dir / "overlay.glb"),
    )

    report_html = REPORT_TEMPLATE.format(
        name=args.name,
        timestamp=datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC"),
        scan_summary="".join(scan_summary),
        color_map_html=color_map_html,
        registration_html=registration_html,
    )
    (proj_dir / "report.html").write_text(report_html, encoding="utf-8")

    print(f"\ndone. open {proj_dir / 'report.html'}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    subparsers = parser.add_subparsers(dest="command", required=True)

    new_parser = subparsers.add_parser("new", help="create an empty project folder")
    new_parser.add_argument("name")
    new_parser.set_defaults(func=cmd_new)

    process_parser = subparsers.add_parser("process", help="run the full pipeline for a project")
    process_parser.add_argument("name")
    process_parser.add_argument("--usdz", type=Path, required=True)
    process_parser.add_argument("--robot-map", type=Path, default=None, help="robot occupancy grid prefix (.pgm/.yaml) to register against")
    process_parser.add_argument("--trajectory", type=Path, default=None, help="trajectory JSON; omit for a synthetic demo path")
    process_parser.add_argument(
        "--remove-isolated-clusters",
        action="store_true",
        help="heuristic 'moving object' removal (see studio/moving_objects.py) -- off by default, "
        "can catch scan-boundary noise as much as real moving objects on real data",
    )
    process_parser.add_argument("--isolated-cluster-min-area", type=float, default=0.3, help="m^2; smaller connected clusters get removed")
    process_parser.set_defaults(func=cmd_process)

    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
