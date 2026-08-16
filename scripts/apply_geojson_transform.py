#!/usr/bin/env python
"""CLI: apply an already-picked similarity transform (exported by
scripts/align_geojson.py's control-point picker) to a GeoJSON file --
for re-running the same alignment programmatically once it's been picked
once (e.g. a second export from the same external source, or wiring it
into a pipeline).

Usage:
    python scripts/apply_geojson_transform.py incoming.geojson geojson_transform.json output.geojson
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from studio.geojson_align import SimilarityTransform, transform_geojson


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("incoming_geojson", type=Path)
    parser.add_argument("transform_json", type=Path, help="{scale, rotation_deg, translation: [tx, ty]} -- from the picker's '변환값 내보내기' button")
    parser.add_argument("output_geojson", type=Path)
    args = parser.parse_args()

    incoming = json.loads(args.incoming_geojson.read_text(encoding="utf-8"))
    transform_data = json.loads(args.transform_json.read_text(encoding="utf-8"))
    transform = SimilarityTransform(
        scale=float(transform_data["scale"]),
        rotation_deg=float(transform_data["rotation_deg"]),
        translation=tuple(transform_data["translation"]),
    )

    aligned = transform_geojson(incoming, transform)
    args.output_geojson.write_text(json.dumps(aligned, indent=2), encoding="utf-8")
    print(f"wrote {args.output_geojson} ({len(aligned.get('features', []))} features)")


if __name__ == "__main__":
    main()
