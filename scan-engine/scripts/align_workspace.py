#!/usr/bin/env python
"""CLI: build the self-contained scan alignment workspace (one .html) for a
project's slicemaps. Open it in Chrome, place scans by drag / pin pairs, press
"저장" to download group_alignment.json, then feed that to merge_slicemaps.py.

Usage:
  python scripts/align_workspace.py <alignment.json> out/project.workspace.html --slices "out/{scan}_tb3.json"
  python scripts/align_workspace.py --layout row --scans scan_A scan_B --slices "out/{scan}_tb3.json" out/project.workspace.html

`alignment.json` is a scan-group-alignment-v1 file (from the iPhone app's
project zip, or a previous save of this page) or the app's scan_groups.json.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from studio.align_workspace_html import build_alignment_workspace_html
from studio.merge_slicemaps import load_group_alignment, load_slice, row_layout


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("alignment", nargs="?", type=Path, help="scan-group-alignment-v1 or scan_groups.json (omit with --layout)")
    p.add_argument("output_html", type=Path)
    p.add_argument("--slices", required=True, help="path pattern with {scan}, e.g. out/{scan}_tb3.json")
    p.add_argument("--scans", nargs="*", help="scan ids to include (with --layout: required, first = reference)")
    p.add_argument("--group", help="group id/name when scan_groups.json holds several")
    p.add_argument("--layout", choices=["row"], help="start from a placeholder row layout instead of an alignment file")
    p.add_argument("--gap", type=float, default=1.0)
    p.add_argument("--title", default="스캔 정합 워크스페이스")
    args = p.parse_args()

    def slice_path(scan: str) -> Path:
        return Path(args.slices.replace("{scan}", scan))

    if args.layout:
        if not args.scans:
            p.error("--layout needs --scans <reference> <scan> ...")
        slices = {s: load_slice(slice_path(s)) for s in args.scans}
        ga = row_layout(slices, reference=args.scans[0], gap_m=args.gap)
        ga.group = args.output_html.stem
        order = list(args.scans)
    else:
        if args.alignment is None:
            p.error("alignment file required unless --layout is given")
        ga = load_group_alignment(args.alignment, group=args.group)
        order = args.scans or [ga.reference] + [s for s in ga.alignments if s != ga.reference]
        if ga.reference not in order:
            order = [ga.reference] + order
        slices = {}
        for s in order:
            path = slice_path(s)
            if not path.exists():
                print(f"warning: {s}: no slicemap at {path} -- skipped")
                continue
            slices[s] = load_slice(path)
        order = [s for s in order if s in slices]

    html = build_alignment_workspace_html(slices, ga, title=args.title, order=order)
    args.output_html.parent.mkdir(parents=True, exist_ok=True)
    args.output_html.write_text(html, encoding="utf-8")
    print(f"wrote {args.output_html} ({len(html) // 1024} KB, {len(slices)} scans, reference {ga.reference})")
    print("open it in Chrome; 저장 downloads group_alignment.json for scripts/merge_slicemaps.py")


if __name__ == "__main__":
    main()
