#!/usr/bin/env python
"""CLI: build a self-contained HTML overlay-playback viewer (PLAN.md section
3.4 / Phase 4) from a base map occupancy grid + a robot trajectory.

The output is a single .html file with the map image and trajectory data
embedded inline (base64 PNG + inline JSON) -- no server, no network, no
external files needed. Open it directly in any browser (file:// works fine).

Usage:
    python scripts/build_overlay_viewer.py <base_map_prefix> <output.html> [--trajectory traj.json]

If --trajectory is omitted, a synthetic lawnmower-pattern trajectory is
generated over the map bounds so the viewer can be built/demoed before a real
robot trajectory exists (PLAN.md section 6).
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from studio.rasterize import load_occupancy_grid_pgm
from studio.trajectory import generate_lawnmower_trajectory, load_trajectory
from studio.viewer_html import build_overlay_viewer_html


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("base_map_prefix", type=Path)
    parser.add_argument("output_html", type=Path)
    parser.add_argument("--trajectory", type=Path, default=None, help="trajectory JSON (see studio/trajectory.py); omit for a synthetic demo path")
    parser.add_argument("--title", type=str, default="Scan-to-Map Studio — Overlay Viewer")
    args = parser.parse_args()

    occ = load_occupancy_grid_pgm(args.base_map_prefix)
    height, width = occ.grid.shape

    if args.trajectory:
        poses = load_trajectory(args.trajectory)
        print(f"loaded {len(poses)} poses from {args.trajectory}")
    else:
        x_min = occ.origin[0] + width * occ.resolution * 0.15
        x_max = occ.origin[0] + width * occ.resolution * 0.85
        y_min = occ.origin[1] + height * occ.resolution * 0.15
        y_max = occ.origin[1] + height * occ.resolution * 0.85
        poses = generate_lawnmower_trajectory((x_min, x_max), (y_min, y_max))
        print(f"no --trajectory given: generated a synthetic {len(poses)}-pose demo path")

    html = build_overlay_viewer_html(occ, poses, args.title)
    args.output_html.write_text(html, encoding="utf-8")
    print(f"wrote {args.output_html} ({args.output_html.stat().st_size / 1024:.0f} KB)")


if __name__ == "__main__":
    main()
