"""Rebuild a processed scan project's overlay.glb without re-running the pipeline.

    python scripts/rebuild_overlay_glb.py <projects/scan_x> <scan source dir with textured.glb / scan.usdz>

Uses the project's base_map.ply as the point layer and the source folder's textured.glb
(the app's baked textured mesh) -- or the bare scan.usdz mesh when there is no textured.glb --
as `scan_mesh`. Existing maps/slices are untouched.
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from studio.gltf_export import PointCloudLayer, save_overlay_glb  # noqa: E402
from studio.point_cloud_io import load_point_cloud  # noqa: E402


def main() -> None:
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    project_dir, source_dir = Path(sys.argv[1]), Path(sys.argv[2])
    base = project_dir / "base_map.ply"
    if not base.exists():
        sys.exit(f"{base} not found (process the scan first)")
    points, colors = load_point_cloud(base)
    textured = source_dir / "textured.glb"
    mesh = None
    if not textured.exists():
        textured = None
        usdz = source_dir / "scan.usdz"
        if usdz.exists():
            from studio.usdz_import import load_usdz_mesh

            mesh = load_usdz_mesh(str(usdz))
    out = project_dir / "overlay.glb"
    save_overlay_glb(
        mesh,
        [PointCloudLayer(name="base_map", points=points, color=colors if colors is not None else (255, 0, 0, 255))],
        str(out),
        textured_glb=textured,
    )
    print(f"{out}: {out.stat().st_size / 1e6:.1f} MB (scan_mesh from {'textured.glb' if textured else 'scan.usdz' if mesh is not None else 'nothing'})")


if __name__ == "__main__":
    main()
