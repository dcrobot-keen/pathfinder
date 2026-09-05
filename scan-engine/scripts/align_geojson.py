#!/usr/bin/env python
"""CLI: build an interactive control-point picker for aligning an
externally-sourced GeoJSON onto this project's base-map GeoJSON
(PLAN.md "좌표 보정" backlog item).

Usage:
    python scripts/align_geojson.py base.geojson incoming.geojson --html geojson_align.html

The actual point-picking and transform fitting happens in the browser; this
script just loads both files and builds the page. See scripts/apply_geojson_transform.py
to re-apply an already-exported transform programmatically.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from studio.geojson_align_viewer_html import build_geojson_alignment_viewer_html


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("base_geojson", type=Path, help="this project's own GeoJSON (reference frame, stays fixed)")
    parser.add_argument("incoming_geojson", type=Path, help="externally-sourced GeoJSON to align (unknown scale/origin)")
    parser.add_argument("--html", type=Path, required=True, help="where to write the control-point picker HTML")
    args = parser.parse_args()

    base_geojson = json.loads(args.base_geojson.read_text(encoding="utf-8"))
    incoming_geojson = json.loads(args.incoming_geojson.read_text(encoding="utf-8"))

    html = build_geojson_alignment_viewer_html(base_geojson, incoming_geojson)
    args.html.write_text(html, encoding="utf-8")
    print(f"wrote {args.html}")


if __name__ == "__main__":
    main()
