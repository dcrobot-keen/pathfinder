#!/usr/bin/env python
"""Write a pair of OVERLAPPING slicemaps with a known relative pose
(studio.synthetic_overlap.make_pair), for exercising the alignment workspace /
metrics / (later) ICP before real overlapping scans exist.

The alignment file holds a deliberately perturbed guess (what a rough manual
placement or a noisy anchor would give); the truth is written alongside.

  python scripts/synthetic_overlap_pair.py out/demo_overlap
  -> out/demo_overlap/scan_A.json, scan_B.json, guess.alignment.json, truth.alignment.json
"""
from __future__ import annotations

import argparse
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from studio.merge_slicemaps import GroupAlignment, ScanAlignment, save_group_alignment, save_slice
from studio.synthetic_overlap import make_pair


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("out_dir", type=Path)
    p.add_argument("--yaw-deg", type=float, default=25.0, help="true yaw of B relative to A")
    p.add_argument("--offset", type=float, nargs=2, default=(2.0, -1.0), metavar=("X", "Z"), help="true offsetX offsetZ")
    p.add_argument("--perturb", type=float, nargs=3, default=(0.35, -0.25, 8.0), metavar=("DX", "DZ", "DYAW_DEG"),
                   help="error added to the truth to make the initial guess")
    args = p.parse_args()

    truth = ScanAlignment(offsetX=args.offset[0], offsetZ=args.offset[1], yawRadians=math.radians(args.yaw_deg), method="truth")
    scan_a, scan_b = make_pair(truth)
    args.out_dir.mkdir(parents=True, exist_ok=True)
    save_slice(args.out_dir / "scan_A.json", scan_a)
    save_slice(args.out_dir / "scan_B.json", scan_b)

    guess = ScanAlignment(
        offsetX=truth.offsetX + args.perturb[0], offsetZ=truth.offsetZ + args.perturb[1],
        yawRadians=truth.yawRadians + math.radians(args.perturb[2]), method="anchor",
    )
    save_group_alignment(args.out_dir / "guess.alignment.json", GroupAlignment(reference="scan_A", alignments={"scan_B": guess}, group="demo_overlap"))
    save_group_alignment(args.out_dir / "truth.alignment.json", GroupAlignment(reference="scan_A", alignments={"scan_B": truth}, group="demo_overlap"))
    print(f"wrote {args.out_dir}/scan_A.json ({scan_a.cols}x{scan_a.rows}), scan_B.json ({scan_b.cols}x{scan_b.rows})")
    print(f"truth: offsetX={truth.offsetX} offsetZ={truth.offsetZ} yaw={args.yaw_deg} deg; guess perturbed by {args.perturb}")


if __name__ == "__main__":
    main()
