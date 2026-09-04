"""Validation for the alignment quality metrics (studio/scan_alignment_metrics.py)
and the workspace page builder (studio/align_workspace_html.py), on a
synthetic overlapping pair with a KNOWN relative pose
(scripts/synthetic_overlap_pair.make_pair). Run directly:
    python tests/test_align_workspace.py
"""
from __future__ import annotations

import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import numpy as np

from studio.align_workspace_html import build_alignment_workspace_html
from studio.merge_slicemaps import GroupAlignment, ScanAlignment
from studio.scan_alignment_metrics import evaluate, pin_fit, pin_residuals, wall_points
from studio.synthetic_overlap import inverse_alignment, make_pair


def check(cond: bool, msg: str) -> None:
    if not cond:
        raise AssertionError(msg)
    print(f"  ok  {msg}")


TRUTH = ScanAlignment(offsetX=2.0, offsetZ=-1.0, yawRadians=math.radians(25.0), method="truth")
SCAN_A, SCAN_B = make_pair(TRUTH)


def test_inverse_alignment_undoes_apply() -> None:
    inv = inverse_alignment(TRUTH)
    pts = np.array([[0.3, 1.2], [-2.0, 0.5], [4.4, -3.1]])
    back = inv.apply_xy(TRUTH.apply_xy(pts))
    check(np.allclose(back, pts), "inverse_alignment(a).apply(a.apply(p)) == p")


def test_truth_scores_well_and_wrong_pose_is_caught() -> None:
    good = evaluate(SCAN_B, TRUTH, [(SCAN_A, ScanAlignment())])
    print(f"      truth: {good.to_json()}")
    check(good.overlap_m > 1.5, f"true pose has real overlap ({good.overlap_m:.2f} m > 1.5)")
    check(0 < good.n_observed < good.n_source, f"only part of B falls where A looked ({good.n_observed}/{good.n_source})")
    check(good.inlier > 0.8, f"true pose inlier {good.inlier:.2f} > 0.8 over the observed subset")
    check(good.conflict < 0.05, f"true pose conflict {good.conflict:.3f} < 0.05")
    check(good.rmse_m < 0.06, f"true pose rmse {good.rmse_m:.3f} m < 0.06")

    # the demo's rough guess (35 cm, 25 cm, 8 deg off): within ICP's coarse reach, not aligned
    guess = ScanAlignment(offsetX=TRUTH.offsetX + 0.35, offsetZ=TRUTH.offsetZ - 0.25, yawRadians=TRUTH.yawRadians + math.radians(8))
    rough = evaluate(SCAN_B, guess, [(SCAN_A, ScanAlignment())])
    print(f"      guess: {rough.to_json()}")
    check(rough.overlap_m >= 1.5, f"rough guess still has coarse overlap ({rough.overlap_m:.2f} m) so ICP stays unlocked")
    check(rough.inlier < 0.6 or rough.conflict > 0.12, f"rough guess fails the pass gate (inlier {rough.inlier:.2f}, conflict {rough.conflict:.2f})")

    wrong = ScanAlignment(offsetX=TRUTH.offsetX + 0.9, offsetZ=TRUTH.offsetZ - 0.7, yawRadians=TRUTH.yawRadians + math.radians(20))
    bad = evaluate(SCAN_B, wrong, [(SCAN_A, ScanAlignment())])
    print(f"      wrong: {bad.to_json()}")
    check(bad.conflict > 0.10 or bad.inlier < 0.6, f"wrong pose fails a gate (inlier {bad.inlier:.2f}, conflict {bad.conflict:.2f})")
    check(bad.conflict > good.conflict, "conflict rises when walls land on the other scan's floor")


def test_no_overlap_locks_icp() -> None:
    far = ScanAlignment(offsetX=TRUTH.offsetX + 30.0, offsetZ=TRUTH.offsetZ, yawRadians=TRUTH.yawRadians)
    m = evaluate(SCAN_B, far, [(SCAN_A, ScanAlignment())])
    check(m.overlap_m < 1.5 and m.inlier == 0.0, "a scan placed far away has no overlap -> ICP would be locked")
    check(m.conflict == 0.0, "no conflict either when nothing overlaps")


def test_pin_fit_recovers_truth_from_three_pairs() -> None:
    walls_b = wall_points(SCAN_B)
    idx = np.linspace(0, len(walls_b) - 1, 3).astype(int)
    src = walls_b[idx]
    ref = TRUTH.apply_xy(src)
    fit = pin_fit(src, ref)
    check(abs(fit.yawRadians - TRUTH.yawRadians) < 1e-9, "pin fit recovers yaw exactly from 3 exact pairs")
    check(abs(fit.offsetX - TRUTH.offsetX) < 1e-9 and abs(fit.offsetZ - TRUTH.offsetZ) < 1e-9, "pin fit recovers offsetX/offsetZ exactly")
    check(float(pin_residuals(fit, src, ref).max()) < 1e-9, "residuals are zero for exact pairs")

    # two pairs are the minimum; noisy clicks give a small, reported residual
    rng = np.random.default_rng(0)
    src2, ref2 = walls_b[[0, len(walls_b) // 2]], TRUTH.apply_xy(walls_b[[0, len(walls_b) // 2]]) + rng.normal(0, 0.02, (2, 2))
    fit2 = pin_fit(src2, ref2)
    check(abs(fit2.yawRadians - TRUTH.yawRadians) < math.radians(2), "two noisy pairs still land within 2 degrees")
    check(pin_residuals(fit2, src2, ref2).max() < 0.05, "two-pair fit residual stays within click noise")


def test_workspace_html_embeds_the_scans() -> None:
    ga = GroupAlignment(reference="scan_A", alignments={"scan_B": TRUTH}, group="demo")
    html = build_alignment_workspace_html({"scan_A": SCAN_A, "scan_B": SCAN_B}, ga, title="t")
    check("scan-group-alignment-v1" in html and '"reference": "scan_A"' in html, "page carries the alignment format and reference")
    check('"id": "scan_B"' in html and '"metrics": {' in html, "page embeds each scan with its loaded-pose metrics")
    check("</script>" in html and "<\\/" not in html.split("const DATA")[0], "embedded JSON is escaped so it cannot close the script tag")
    check(len(html) < 2_000_000, f"page stays a reasonable size ({len(html) // 1024} KB)")


if __name__ == "__main__":
    for t in [test_inverse_alignment_undoes_apply, test_truth_scores_well_and_wrong_pose_is_caught, test_no_overlap_locks_icp,
              test_pin_fit_recovers_truth_from_three_pairs, test_workspace_html_embeds_the_scans]:
        print(t.__name__)
        t()
    print("all align_workspace checks passed")
