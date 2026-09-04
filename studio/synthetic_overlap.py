"""A pair of OVERLAPPING slicemaps with a known relative pose -- test fixture
for the alignment workspace, the quality metrics and (later) ICP, usable
before any real overlapping scans exist.

One synthetic room is sliced once; scan A keeps the left part, scan B the
right part (they share the middle band), and B is re-gridded into its own
local frame so that the TRUE alignment B -> A is exactly the given
ScanAlignment. scripts/synthetic_overlap_pair.py writes such a pair to disk.
"""
from __future__ import annotations

import math

import numpy as np

from studio.merge_slicemaps import CODE_UNKNOWN, GroupAlignment, ScanAlignment, Slice, merge_slices
from studio.preprocess import remove_ceiling
from studio.slice_map import rasterize_slice, slice_to_codes
from studio.synthetic_room import generate_room


def inverse_alignment(a: ScanAlignment) -> ScanAlignment:
    """The ScanAlignment that undoes `a` (same convention, slice-plane math)."""
    c, s = math.cos(-a.yawRadians), math.sin(-a.yawRadians)
    tx, ty = a.offsetX, -a.offsetZ                    # slice-frame translation of `a`
    ix, iy = -(c * tx - s * ty), -(s * tx + c * ty)   # slice-frame translation of the inverse
    return ScanAlignment(offsetX=ix, offsetZ=-iy, yawRadians=-a.yawRadians, method="inverse")


def make_pair(
    truth: ScanAlignment,
    width: float = 8.0,
    depth: float = 5.0,
    split_lo: float = 2.5,
    split_hi: float = 5.0,
    resolution: float = 0.05,
    seed: int = 0,
) -> tuple[Slice, Slice]:
    """Returns (scan_A in the reference frame, scan_B in its own local frame),
    such that applying `truth` to B lands it on A. Overlap = x in [split_lo, split_hi]."""
    pts = generate_room(width=width, depth=depth, points_per_surface=6000, seed=seed)
    floor = remove_ceiling(pts, seed=seed).points
    sg = rasterize_slice(floor, z=0.18, band=0.05, resolution=resolution)
    codes = slice_to_codes(sg)
    origin = (float(sg.occ.origin[0]), float(sg.occ.origin[1]))

    xs = origin[0] + (np.arange(codes.shape[1]) + 0.5) * resolution
    a_codes = codes.copy(); a_codes[:, xs > split_hi] = CODE_UNKNOWN
    b_codes = codes.copy(); b_codes[:, xs < split_lo] = CODE_UNKNOWN
    scan_a = Slice(codes=a_codes, resolution=resolution, origin=origin, z=0.18, band=0.05)
    b_ref = Slice(codes=b_codes, resolution=resolution, origin=origin, z=0.18, band=0.05)

    # re-grid B into a local frame: local = truth^-1(ref). merge_slices needs a
    # reference slice; a 1x1 unknown stub at the origin plays that role.
    stub = Slice(codes=np.zeros((1, 1), dtype=np.uint8), resolution=resolution, origin=(0.0, 0.0), z=0.18, band=0.05)
    ga = GroupAlignment(reference="stub", alignments={"b": inverse_alignment(truth)})
    b_local = merge_slices({"stub": stub, "b": b_ref}, ga, padding_m=0.0)
    b_local.sources = []
    return scan_a, b_local
