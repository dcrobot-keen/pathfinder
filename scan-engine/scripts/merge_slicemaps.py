#!/usr/bin/env python
"""CLI: composite several scans' slicemap-v1 files into one, using the
project's per-scan alignments (studio.merge_slicemaps). The merged file is a
normal slicemap-v1, so the ros-chromium simulator (slicemap-to-world.mjs),
nav.html's iPhone-map load and MapNode's prior read it unchanged.

Alignment input is either this repo's `scan-group-alignment-v1` JSON or the
iPhone app's own `scan_groups.json` (ScanGroup list; first scanID = reference).

Usage:
  # real alignments from the app / the desktop workspace
  python scripts/merge_slicemaps.py alignment.json out/project \
      --slices "out/{scan}_tb3.json" --png

  # no alignment yet: lay the scans out in a row (placeholder, method="layout"),
  # write that as an editable alignment file, and merge with it
  python scripts/merge_slicemaps.py --layout row --scans scan_A scan_B scan_C \
      --slices "out/{scan}_tb3.json" --write-alignment out/project.alignment.json \
      out/project --png

`--slices` is a pattern with `{scan}` standing for the scan id; `--scans`
restricts/orders which scans take part (default: every scan named in the
alignment file, reference first).
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from studio.merge_slicemaps import (
    GroupAlignment,
    load_group_alignment,
    load_slice,
    merge_slices,
    row_layout,
    save_group_alignment,
    save_preview_png,
    save_slice,
    summarize,
)


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("alignment", nargs="?", type=Path, help="scan-group-alignment-v1 or scan_groups.json (omit with --layout)")
    p.add_argument("output_prefix", type=Path, help="output path without extension, e.g. out/project")
    p.add_argument("--slices", required=True, help="path pattern for each scan's slicemap, with {scan}, e.g. out/{scan}_tb3.json")
    p.add_argument("--scans", nargs="*", help="scan ids to include (default: all in the alignment file). With --layout: required, first = reference")
    p.add_argument("--group", help="which group to use when scan_groups.json holds several (id or name)")
    p.add_argument("--layout", choices=["row"], help="generate a placeholder alignment instead of reading one")
    p.add_argument("--gap", type=float, default=1.0, help="metres between scans for --layout row (default 1.0)")
    p.add_argument("--write-alignment", type=Path, help="also write the alignment actually used (editable, scan-group-alignment-v1)")
    p.add_argument("--resolution", type=float, default=None, help="output cell size (default: the reference slice's)")
    p.add_argument("--png", action="store_true", help="also write a PNG preview")
    args = p.parse_args()

    def slice_path(scan: str) -> Path:
        return Path(args.slices.replace("{scan}", scan))

    if args.layout:
        if not args.scans or len(args.scans) < 1:
            p.error("--layout needs --scans <reference> <scan> ... ")
        slices = {s: load_slice(slice_path(s)) for s in args.scans}
        ga: GroupAlignment = row_layout(slices, reference=args.scans[0], gap_m=args.gap)
        ga.group = args.output_prefix.name
        print(f"layout: row, gap {args.gap} m, reference {ga.reference}")
    else:
        if args.alignment is None:
            p.error("alignment file required unless --layout is given")
        ga = load_group_alignment(args.alignment, group=args.group)
        scan_ids = args.scans or [ga.reference] + [s for s in ga.alignments if s != ga.reference]
        if ga.reference not in scan_ids:
            scan_ids = [ga.reference] + scan_ids
        slices = {}
        for s in scan_ids:
            path = slice_path(s)
            if not path.exists():
                print(f"warning: {s}: no slicemap at {path} -- skipped")
                continue
            slices[s] = load_slice(path)
        print(f"alignment: {args.alignment} (group {ga.group!r}), reference {ga.reference}")

    for sid, s in slices.items():
        a = ga.get(sid)
        print(f"  {sid}: {s.cols}x{s.rows} @ {s.resolution} m, z={s.z}  ->  "
              f"offsetX={a.offsetX:+.3f} offsetZ={a.offsetZ:+.3f} yaw={a.yawRadians:+.4f} rad ({a.method})")

    merged = merge_slices(slices, ga, resolution=args.resolution)
    args.output_prefix.parent.mkdir(parents=True, exist_ok=True)
    out_json = save_slice(args.output_prefix.with_suffix(".json"), merged)
    print(f"merged: {summarize(merged)}")
    print(f"wrote {out_json}")
    if args.png:
        print(f"wrote {save_preview_png(args.output_prefix.with_suffix('.png'), merged)}")
    if args.write_alignment:
        print(f"wrote {save_group_alignment(args.write_alignment, ga)}")


if __name__ == "__main__":
    main()
