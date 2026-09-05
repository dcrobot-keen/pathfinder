#!/usr/bin/env python
"""CLI: build an interactive control-point picker for georeferencing an
externally-sourced raster image (a scanned/photographed floor plan) onto
this project's base-map GeoJSON (PLAN.md "좌표 보정" backlog item).

Usage:
    python scripts/align_image.py base.geojson floorplan.png --html align_image.html [--max-display-dim 1600]

The actual point-picking and transform fitting happens in the browser; this
script just loads the base GeoJSON + image and builds the page. Real floor
plan scans can be large, so if the image's larger dimension exceeds
--max-display-dim, a downscaled copy is embedded instead (the exported
world file is still in the *original* image's pixel grid -- the viewer
corrects for this via the embedded display_scale, see
studio/image_align_viewer_html.py).
"""
from __future__ import annotations

import argparse
import io
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from PIL import Image

from studio.image_align import world_file_extension
from studio.image_align_viewer_html import build_image_alignment_viewer_html


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("base_geojson", type=Path, help="this project's own GeoJSON (reference frame, stays fixed)")
    parser.add_argument("image", type=Path, help="externally-sourced floor plan image to georeference")
    parser.add_argument("--html", type=Path, required=True, help="where to write the control-point picker HTML")
    parser.add_argument("--max-display-dim", type=int, default=1600, help="pixels; larger images are downscaled for embedding only (world file stays in original resolution)")
    args = parser.parse_args()

    base_geojson = json.loads(args.base_geojson.read_text(encoding="utf-8"))

    with Image.open(args.image) as im:
        im = im.convert("RGB")
        original_max_dim = max(im.size)
        display_scale = 1.0
        if original_max_dim > args.max_display_dim:
            display_scale = args.max_display_dim / original_max_dim
            display_size = (max(int(im.width * display_scale), 1), max(int(im.height * display_scale), 1))
            im = im.resize(display_size, Image.LANCZOS)
        buf = io.BytesIO()
        im.save(buf, format="PNG")
        image_bytes = buf.getvalue()

    html = build_image_alignment_viewer_html(
        base_geojson,
        image_bytes,
        image_mime="image/png",
        display_scale=display_scale,
        world_file_ext=world_file_extension(args.image),
    )
    args.html.write_text(html, encoding="utf-8")
    print(f"wrote {args.html} (display_scale={display_scale:.4f})")


if __name__ == "__main__":
    main()
