#!/usr/bin/env python
"""CLI: turn a registration transform JSON (studio/align_viewer_html.py's
"변환값 내보내기" export, or hand-written {"rotation_deg": ..., "translation":
[tx, ty]}) into a ROS2 static tf -- both a ready-to-run CLI command and a
launch.py Node() snippet. See studio/tf_export.py for why a static tf
instead of a re-projected/baked map.

Usage:
    python scripts/export_tf.py registration_transform.json
    python scripts/export_tf.py registration_transform.json --frame-id scan_basemap --child-frame-id map --out tf.txt
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from studio.tf_export import build_launch_py_snippet, build_static_transform_publisher_command


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("transform_json", type=Path, help="{'rotation_deg': ..., 'translation': [tx, ty]} (extra keys ignored)")
    parser.add_argument("--frame-id", default="scan_basemap", help="parent frame = the LiDAR base map's frame (default: scan_basemap)")
    parser.add_argument("--child-frame-id", default="map", help="child frame = the robot's own live SLAM frame (default: map)")
    parser.add_argument("--out", type=Path, default=None, help="write both forms to this file instead of just printing")
    args = parser.parse_args()

    payload = json.loads(args.transform_json.read_text(encoding="utf-8"))
    rotation_deg = payload["rotation_deg"]
    translation = tuple(payload["translation"])

    command = build_static_transform_publisher_command(rotation_deg, translation, args.frame_id, args.child_frame_id)
    snippet = build_launch_py_snippet(rotation_deg, translation, args.frame_id, args.child_frame_id)

    output = f"# CLI (manual run / debugging)\n{command}\n\n# launch.py Node() (real deployment)\n{snippet}\n"

    if args.out:
        args.out.write_text(output, encoding="utf-8")
        print(f"wrote {args.out}")
    else:
        print(output)


if __name__ == "__main__":
    main()
