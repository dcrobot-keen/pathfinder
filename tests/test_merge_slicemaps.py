"""Validation for studio/merge_slicemaps.py -- compositing several
slicemap-v1 grids with per-scan ScanAlignment transforms.

Synthetic only: build two small slices with known walls, apply a KNOWN
alignment (the same numbers the iPhone app would store), and check the wall
lands where the ARKit-plane formula says it should after the (x, -z) frame
flip. Also round-trips the alignment file formats. Run directly:
    python tests/test_merge_slicemaps.py
"""
from __future__ import annotations

import json
import math
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import numpy as np

from studio.merge_slicemaps import (
    CODE_FREE,
    CODE_OCC_WALL,
    CODE_UNKNOWN,
    GroupAlignment,
    ScanAlignment,
    Slice,
    load_group_alignment,
    load_slice,
    merge_slices,
    row_layout,
    save_group_alignment,
    save_slice,
)

RES = 0.1


def make_slice(rows: int, cols: int, origin=(0.0, 0.0)) -> Slice:
    codes = np.full((rows, cols), CODE_FREE, dtype=np.uint8)
    return Slice(codes=codes, resolution=RES, origin=origin, z=0.18, band=0.05)


def cell_of(s: Slice, x: float, y: float) -> tuple[int, int]:
    return (int(math.floor((y - s.origin[1]) / s.resolution)), int(math.floor((x - s.origin[0]) / s.resolution)))


def check(cond: bool, msg: str) -> None:
    if not cond:
        raise AssertionError(msg)
    print(f"  ok  {msg}")


def test_alignment_matches_swift_formula() -> None:
    a = ScanAlignment(offsetX=1.5, offsetZ=-0.5, yawRadians=math.radians(30))
    # ARKit-plane apply/inverse round-trip
    x, z = a.apply_xz(0.7, -0.2)
    bx, bz = a.inverse_xz(x, z)
    check(abs(bx - 0.7) < 1e-9 and abs(bz + 0.2) < 1e-9, "apply_xz / inverse_xz round-trip")
    # slice-plane form agrees with ARKit-plane form under (x, y) = (x, -z)
    xy = np.array([[0.7, 0.2]])  # y = -z = 0.2
    sx, sy = a.apply_xy(xy)[0]
    check(abs(sx - x) < 1e-9 and abs(sy + z) < 1e-9, "apply_xy equals apply_xz after the (x, -z) flip")
    back = a.inverse_xy(np.array([[sx, sy]]))[0]
    check(np.allclose(back, xy[0]), "apply_xy / inverse_xy round-trip")


def test_identity_merge_is_the_input() -> None:
    s = make_slice(20, 30, origin=(-1.0, -0.5))
    s.codes[5, 10] = CODE_OCC_WALL
    ga = GroupAlignment(reference="a", alignments={})
    m = merge_slices({"a": s}, ga, padding_m=0.0)
    r, c = cell_of(m, -1.0 + 10.5 * RES, -0.5 + 5.5 * RES)
    check(m.codes[r, c] == CODE_OCC_WALL, "single-scan merge keeps the wall in place")
    check(int((m.codes == CODE_OCC_WALL).sum()) == 1, "single-scan merge adds no extra walls")


def test_rotated_scan_lands_where_the_formula_says() -> None:
    ref = make_slice(40, 40)  # 4 m x 4 m of free space
    other = make_slice(20, 20)  # 2 m x 2 m, one wall cell at local (1.05, 0.55)
    other.codes[5, 10] = CODE_OCC_WALL
    yaw = math.radians(90)
    a = ScanAlignment(offsetX=2.0, offsetZ=-1.0, yawRadians=yaw, method="manual")
    ga = GroupAlignment(reference="ref", alignments={"other": a})
    m = merge_slices({"ref": ref, "other": other}, ga, padding_m=0.0)

    # expected: slice-frame rotation by +90deg (CCW) then translate (offsetX, -offsetZ) = (2, 1)
    lx, ly = 1.05, 0.55
    ex = lx * math.cos(yaw) - ly * math.sin(yaw) + 2.0
    ey = lx * math.sin(yaw) + ly * math.cos(yaw) + 1.0
    r, c = cell_of(m, ex, ey)
    check(m.codes[r, c] == CODE_OCC_WALL, f"rotated wall found at ({ex:.2f}, {ey:.2f})")
    check(int((m.codes == CODE_OCC_WALL).sum()) == 1, "exactly one wall cell after rotation")

    # ARKit-plane check of the same point: (x, z) = (lx, -ly) -> apply_xz -> (x', z') -> y' = -z'
    ax, az = a.apply_xz(lx, -ly)
    check(abs(ax - ex) < 1e-9 and abs(-az - ey) < 1e-9, "slice-plane result equals Swift applyXZ result")

    # occupied beats free where the scans overlap; unknown never wins
    check(m.codes[cell_of(m, 0.5, 0.5)] == CODE_FREE, "reference free space survives")
    # with padding the merged grid extends past both scans; that margin must stay unknown
    padded = merge_slices({"ref": ref, "other": other}, ga, padding_m=0.25)
    check(padded.codes[0, 0] == CODE_UNKNOWN and int((padded.codes == CODE_UNKNOWN).sum()) > 0,
          "outside both scans stays unknown")


def test_row_layout_does_not_overlap() -> None:
    a = make_slice(10, 30)
    b = make_slice(15, 20, origin=(5.0, 5.0))
    ga = row_layout({"a": a, "b": b}, reference="a", gap_m=1.0)
    m = merge_slices({"a": a, "b": b}, ga, padding_m=0.0)
    ba = ga.get("b")
    # b's min corner must land at (a.max_x + gap, a.min_y)
    bx, by = ba.apply_xy(np.array([[5.0, 5.0]]))[0]
    check(abs(bx - (3.0 + 1.0)) < 1e-9 and abs(by - 0.0) < 1e-9, "row layout places b right of a with the gap")
    check(ba.method == "layout", "layout alignments are labelled as placeholders")
    check(m.cols == 60 and m.rows == 15, f"merged extent is 6.0 m x 1.5 m (got {m.cols}x{m.rows})")


def test_alignment_file_formats() -> None:
    with tempfile.TemporaryDirectory() as td:
        td = Path(td)
        ga = GroupAlignment(reference="scan_a", alignments={"scan_b": ScanAlignment(1.0, 2.0, 0.3, method="pins")}, group="g")
        p = save_group_alignment(td / "align.json", ga)
        back = load_group_alignment(p)
        check(back.reference == "scan_a" and abs(back.get("scan_b").yawRadians - 0.3) < 1e-12, "scan-group-alignment-v1 round-trip")
        check(back.get("scan_b").method == "pins", "method survives the round-trip")

        app = [{"id": "G1", "name": "집", "scanIDs": ["scan_a", "scan_b"], "createdAt": 0,
                "alignments": {"scan_b": {"offsetX": 0.5, "offsetZ": -0.25, "yawRadians": 0.1}}}]
        (td / "scan_groups.json").write_text(json.dumps(app), encoding="utf-8")
        g = load_group_alignment(td / "scan_groups.json")
        check(g.reference == "scan_a" and g.get("scan_b").offsetZ == -0.25 and g.get("scan_b").method == "app",
              "app scan_groups.json (list) is read, first scanID is the reference")

        s = make_slice(3, 4, origin=(0.2, -0.3))
        s.codes[1, 2] = CODE_OCC_WALL
        s.sources = [{"scan": "x"}]
        sp = save_slice(td / "m.json", s)
        s2 = load_slice(sp)
        check(np.array_equal(s.codes, s2.codes) and s2.origin == (0.2, -0.3) and s2.sources == [{"scan": "x"}],
              "slicemap-v1 round-trip incl. sources provenance")


if __name__ == "__main__":
    for t in [test_alignment_matches_swift_formula, test_identity_merge_is_the_input,
              test_rotated_scan_lands_where_the_formula_says, test_row_layout_does_not_overlap,
              test_alignment_file_formats]:
        print(t.__name__)
        t()
    print("all merge_slicemaps checks passed")
