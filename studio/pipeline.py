"""Shared pipeline orchestration: usdz -> base map -> 2D map (+optional
registration/classification/vectorization) -> viewers -> report.

Moved out of scripts/studio.py's cmd_process (PLAN.md Phase 5) so both the
CLI and the web API (server/) drive the exact same code path. The only new
behavior versus the original cmd_process is:

  1. Vectorization (studio.vectorize) is now wired in -- nothing called it
     before. Room outlines are always traced from the interior scan mask;
     furniture footprints are added when `classify=True` (they need
     classification labels). Written as output.geojson.
  2. report.json is written alongside the existing report.html, so callers
     (the API) get structured stats without parsing HTML.

`on_progress(step_key, status, data)` receives STRUCTURED data only (counts,
distances, not formatted strings) -- callers are responsible for turning
that into whatever display they want:
  - scripts/studio.py's callback reconstructs the original print() lines,
    so CLI output is unchanged.
  - server/jobs.py's callback writes to status.json (studio.status) for the
    web UI to poll.

`status` values passed to on_progress: "active" (step starting) then "done"
or "error" (step finished). Steps that don't apply to this run (e.g.
"registration" with no --robot-map) are simply never called -- the caller's
initial step dict (studio.status.initial_steps) already marks those "skip".
"""
from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable

import numpy as np

from studio.align_viewer_html import build_alignment_viewer_html
from studio.gltf_export import PointCloudLayer, save_overlay_glb
from studio.moving_objects import remove_isolated_clusters as remove_isolated_clusters_fn
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
    save_occupancy_preview_png,
)
from studio.registration import icp_2d_multistart
from studio.trajectory import generate_lawnmower_trajectory, load_trajectory
from studio.usdz_import import load_usdz_mesh, sample_vertex_colors
from studio.vectorize import detect_furniture_polygons, rasterize_interior_mask, to_geojson
from studio.viewer_html import build_overlay_viewer_html

OnProgress = Callable[[str, str, dict], None]


def _noop_progress(step_key: str, status: str, data: dict) -> None:
    pass


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

{classify_html}

<h2>3. 인터랙티브 뷰어</h2>
<ul>
  <li><a href="viewer.html">viewer.html</a> — 궤적 재생 (2D, 브라우저에서 바로 열기)</li>
  <li><code>overlay.glb</code> — <a href="https://github.com/dcrobot-keen/gltf-inspector" target="_blank">gltf-inspector</a>에 드래그&드롭해서 3D로 확인 (원본 스캔 메시 + 처리된 포인트클라우드)</li>
</ul>

</body>
</html>
"""


@dataclass
class PipelineResult:
    project_dir: Path
    num_raw_points: int
    num_base_points: int
    ceiling_z: float
    outliers_removed: int
    isolated_clusters_removed: int | None
    num_wall_planes: int | None
    class_counts: dict[str, int] | None
    n_free: int
    n_occupied: int
    registration: dict | None  # {"rotation_deg", "translation", "rmse", "iterations"}
    report_html_path: Path
    report_json_path: Path
    geojson_path: Path
    extra: dict = field(default_factory=dict)


def run_pipeline(
    project_dir: str | Path,
    usdz_path: str | Path,
    robot_map_prefix: str | Path | None = None,
    trajectory_path: str | Path | None = None,
    remove_isolated_clusters: bool = False,
    isolated_cluster_min_area: float = 0.3,
    classify: bool = False,
    on_progress: OnProgress | None = None,
) -> PipelineResult:
    """Run the full scan -> base map -> 2D map (+ optional registration /
    classification / vectorization) -> viewers -> report pipeline for one
    project. Behavior-equivalent to the original scripts/studio.py
    cmd_process, plus GeoJSON export and report.json (see module docstring).
    """
    progress = on_progress or _noop_progress
    project_dir = Path(project_dir)
    (project_dir / "map").mkdir(parents=True, exist_ok=True)
    scan_summary: list[str] = []
    project_name = project_dir.name

    # --- 1. import -----------------------------------------------------
    progress("import", "active", {})
    mesh = load_usdz_mesh(str(usdz_path))
    colors = None
    if mesh.uv is not None and mesh.texture is not None:
        colors = sample_vertex_colors(mesh.uv, mesh.texture)
    save_point_cloud(project_dir / "raw.ply", mesh.vertices, colors)
    scan_summary.append(
        f"<li>원본 스캔: <span class=\"stat\">{len(mesh.vertices):,}</span>개 정점 "
        f"(텍스처: {'있음' if mesh.texture else '없음'}) → <code>raw.ply</code></li>"
    )
    progress("import", "done", {"num_vertices": len(mesh.vertices), "has_texture": bool(mesh.texture)})

    # --- 2. preprocess ---------------------------------------------------
    progress("preprocess", "active", {})
    result = remove_ceiling(mesh.vertices, colors, seed=0)
    base_points, base_colors = result.points, result.colors
    scan_summary.append(
        f"<li>베이스맵: <span class=\"stat\">{len(base_points):,}</span>개 점 "
        f"(천장 높이 {result.ceiling_z:.2f}m, 이상치 {result.outliers_removed:,}개 제거) → <code>base_map.ply</code></li>"
    )

    isolated_clusters_removed = None
    if remove_isolated_clusters:
        cluster_result = remove_isolated_clusters_fn(
            base_points, base_colors, min_component_area_m2=isolated_cluster_min_area
        )
        base_points, base_colors = cluster_result.points, cluster_result.colors
        isolated_clusters_removed = int(cluster_result.removed_mask.sum())
        scan_summary.append(
            f"<li>고립 클러스터(이동 물체 추정) 제거: <span class=\"stat\">{isolated_clusters_removed:,}</span>개 점, "
            f"{cluster_result.num_components - cluster_result.kept_component_count}개 컴포넌트 "
            f"(실제 데이터에서는 스캔 경계 노이즈일 수 있음 — PLAN.md 참고)</li>"
        )

    save_point_cloud(project_dir / "base_map.ply", base_points, base_colors)
    progress(
        "preprocess",
        "done",
        {
            "num_points": len(base_points),
            "ceiling_z": result.ceiling_z,
            "outliers_removed": result.outliers_removed,
            "isolated_clusters_removed": isolated_clusters_removed,
        },
    )

    # --- 3. classify (optional) ------------------------------------------
    class_result = None
    class_counts: dict[str, int] | None = None
    classify_html = ""
    if classify:
        progress("classify", "active", {})
        from studio.classify import FLOOR, FURNITURE, WALL, classify_floor_wall_furniture, labels_to_colors

        class_result = classify_floor_wall_furniture(base_points, rng=np.random.default_rng(0))
        class_colors = labels_to_colors(class_result.labels)
        save_point_cloud(project_dir / "classified.ply", base_points, class_colors)
        class_topdown = rasterize_color_topdown(base_points, class_colors, resolution=0.03, padding=0.5)
        save_color_topdown_png(project_dir / "map" / "classified_topdown.png", class_topdown)
        class_counts = {
            "floor": class_result.count(FLOOR),
            "wall": class_result.count(WALL),
            "furniture": class_result.count(FURNITURE),
        }
        classify_html = (
            "<h2>2c. 바닥/벽/가구 분류</h2>"
            f"<p>벽 평면 {class_result.num_wall_planes}개 검출 — "
            f"바닥 {class_counts['floor']:,} / 벽 {class_counts['wall']:,} / "
            f"가구 {class_counts['furniture']:,} 점 (규칙 기반 휴리스틱, PLAN.md 참고)</p>"
            '<img src="map/classified_topdown.png">'
        )
        progress("classify", "done", {"num_wall_planes": class_result.num_wall_planes, "counts": class_counts})

    # --- 4. rasterize ------------------------------------------------------
    progress("rasterize", "active", {})
    occ = rasterize_occupancy_grid(base_points)
    save_occupancy_grid_pgm(project_dir / "map" / "map", occ)
    n_free = int((occ.grid == FREE).sum())
    n_occupied = int((occ.grid == OCCUPIED).sum())
    save_occupancy_preview_png(project_dir / "map" / "map.png", occ)

    color_map_html = ""
    if base_colors is not None:
        color_topdown = rasterize_color_topdown(base_points, base_colors, resolution=0.02, padding=0.5)
        save_color_topdown_png(project_dir / "map" / "map_color.png", color_topdown)
        color_map_html = '<div><a href="map/map_color.png">map_color.png (원본 색 top-down)</a><br><img src="map/map_color.png"></div>'
    progress("rasterize", "done", {"n_free": n_free, "n_occupied": n_occupied})

    # --- 5. registration (optional) ---------------------------------------
    registration = None
    registration_html = ""
    if robot_map_prefix:
        progress("registration", "active", {})
        robot_occ = load_occupancy_grid_pgm(robot_map_prefix)
        base_pts = cell_centers_world(occ, OCCUPIED)
        robot_pts = cell_centers_world(robot_occ, OCCUPIED)
        reg = icp_2d_multistart(source=robot_pts, target=base_pts, max_correspondence_distance=0.5)

        import matplotlib

        matplotlib.use("Agg")
        import matplotlib.pyplot as plt

        fig, ax = plt.subplots(figsize=(8, 8))
        ax.scatter(base_pts[:, 0], base_pts[:, 1], s=2, c="gray", label="base map")
        ax.scatter(reg.aligned_source[:, 0], reg.aligned_source[:, 1], s=2, c="red", alpha=0.6, label="robot map (aligned)")
        ax.set_aspect("equal")
        ax.legend()
        ax.set_title(f"registration: rot={reg.rotation_deg:.1f}deg, rmse={reg.rmse:.3f}m")
        fig.savefig(project_dir / "registration.png", dpi=150)
        plt.close(fig)

        align_html = build_alignment_viewer_html(
            base_points=base_pts,
            robot_points=robot_pts,
            initial_rotation_deg=reg.rotation_deg,
            initial_translation=tuple(reg.translation),
            initial_rmse=reg.rmse,
            resolution=occ.resolution,
            title=f"{project_name} — 정합 정렬 확인/조정",
        )
        (project_dir / "align.html").write_text(align_html, encoding="utf-8")

        registration = {
            "rotation_deg": reg.rotation_deg,
            "translation": [float(t) for t in reg.translation],
            "rmse": reg.rmse,
            "iterations": reg.iterations,
        }
        registration_html = (
            "<h2>2b. 로봇 지도 정합</h2>"
            f'<p>자동 ICP 초기값: 회전 {reg.rotation_deg:.1f}&deg;, 이동 {reg.translation}, RMSE {reg.rmse:.3f}m '
            f"({reg.iterations}회 반복) — 실내 지도는 부분 중첩/대칭 구조 때문에 자동 정합이 틀릴 수 있으니 "
            f'<a href="align.html">align.html</a>에서 눈으로 확인하고 필요하면 직접 미세조정하세요.</p>'
            '<img src="registration.png">'
        )
        progress("registration", "done", registration)
    else:
        progress("registration", "skip", {})

    # --- 6. vectorize (new: nothing called studio.vectorize before this) --
    progress("vectorize", "active", {})
    interior_mask = rasterize_interior_mask(base_points)
    from studio.vectorize import trace_room_polygons

    rooms = trace_room_polygons(interior_mask)
    furniture = None
    if class_result is not None:
        furniture = detect_furniture_polygons(base_points, class_result.labels)
    geojson = to_geojson(rooms=rooms, furniture=furniture)
    geojson_path = project_dir / "output.geojson"
    import json as _json

    geojson_path.write_text(_json.dumps(geojson, ensure_ascii=False), encoding="utf-8")
    progress("vectorize", "done", {"num_rooms": len(rooms), "num_furniture": len(furniture) if furniture else 0})

    # --- 7. viewer + glb ---------------------------------------------------
    progress("viewer", "active", {})
    if trajectory_path:
        poses = load_trajectory(trajectory_path)
    else:
        height, width = occ.grid.shape
        x_min = occ.origin[0] + width * occ.resolution * 0.15
        x_max = occ.origin[0] + width * occ.resolution * 0.85
        y_min = occ.origin[1] + height * occ.resolution * 0.15
        y_max = occ.origin[1] + height * occ.resolution * 0.85
        poses = generate_lawnmower_trajectory((x_min, x_max), (y_min, y_max))
    viewer_html = build_overlay_viewer_html(occ, poses, title=f"{project_name} — Overlay Viewer")
    (project_dir / "viewer.html").write_text(viewer_html, encoding="utf-8")

    layer_color = base_colors if base_colors is not None else (255, 0, 0, 255)
    save_overlay_glb(
        mesh,
        [PointCloudLayer(name="base_map", points=base_points, color=layer_color)],
        str(project_dir / "overlay.glb"),
    )

    from datetime import datetime, timezone

    timestamp = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    report_html = REPORT_TEMPLATE.format(
        name=project_name,
        timestamp=timestamp,
        scan_summary="".join(scan_summary),
        color_map_html=color_map_html,
        registration_html=registration_html,
        classify_html=classify_html,
    )
    report_html_path = project_dir / "report.html"
    report_html_path.write_text(report_html, encoding="utf-8")

    report_json = {
        "name": project_name,
        "timestamp": timestamp,
        "num_raw_points": len(mesh.vertices),
        "num_base_points": len(base_points),
        "ceiling_z": result.ceiling_z,
        "outliers_removed": result.outliers_removed,
        "isolated_clusters_removed": isolated_clusters_removed,
        "n_free": n_free,
        "n_occupied": n_occupied,
        "num_wall_planes": class_result.num_wall_planes if class_result else None,
        "class_counts": class_counts,
        "num_rooms": len(rooms),
        "num_furniture": len(furniture) if furniture else 0,
        "registration": registration,
    }
    report_json_path = project_dir / "report.json"
    report_json_path.write_text(_json.dumps(report_json, ensure_ascii=False), encoding="utf-8")
    progress("viewer", "done", {})

    return PipelineResult(
        project_dir=project_dir,
        num_raw_points=len(mesh.vertices),
        num_base_points=len(base_points),
        ceiling_z=result.ceiling_z,
        outliers_removed=result.outliers_removed,
        isolated_clusters_removed=isolated_clusters_removed,
        num_wall_planes=class_result.num_wall_planes if class_result else None,
        class_counts=class_counts,
        n_free=n_free,
        n_occupied=n_occupied,
        registration=registration,
        report_html_path=report_html_path,
        report_json_path=report_json_path,
        geojson_path=geojson_path,
    )
