"""Quality numbers and closed-form fits for scan-to-scan alignment -- the
Python reference the alignment workspace (align_workspace_html.py) mirrors in
JS and that a later ICP endpoint reports.

Three numbers, always together (strategy doc "품질 게이지"):

- overlap_m   how much of the selected scan's wall runs alongside another
              scan's wall (metres) -- below ~1.5 m there is nothing for ICP
              to grip, so the workspace locks the ICP button.
- inlier      of the selected scan's wall points that land inside another
              scan's OBSERVED area (free or occupied, not unknown), the
              fraction with another scan's wall within `corr_dist`. High
              alone proves nothing: on the 2026-09-04 rooms, WRONG fits
              still scored 0.4-0.6.
- conflict    of those same observed points, the fraction that land where
              another scan saw FREE floor. This is the number that catches a
              wrong fit (0.25-0.30 on those same rooms). Must be low.

Why "observed subset": adjacent rooms share a doorway and a strip of
corridor, not the whole room. Most of a scan's walls fall where the other
scan never looked and say nothing either way; ratios over all walls would
call a correct two-room pose wrong (inlier 0.28 on the synthetic pair).

All geometry is in the slice plane (x, y) = (x_arkit, -z_arkit); alignments
are ScanAlignment from merge_slicemaps (same numbers the iPhone app stores).
"""
from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np
from scipy.spatial import cKDTree

from studio.merge_slicemaps import CODE_FREE, CODE_OCC_FURNITURE, CODE_OCC_WALL, CODE_UNKNOWN, ScanAlignment, Slice
from studio.registration import best_fit_transform_2d


def cell_centres(s: Slice, mask: np.ndarray) -> np.ndarray:
    """(N, 2) slice-frame centres of the cells where `mask` is True."""
    rows, cols = np.nonzero(mask)
    x = s.origin[0] + (cols + 0.5) * s.resolution
    y = s.origin[1] + (rows + 0.5) * s.resolution
    return np.column_stack([x, y])


def wall_points(s: Slice) -> np.ndarray:
    """Every occupied cell (wall-tagged or furniture-tagged) at the slice
    height. The wall/furniture tag from studio.classify is NOT used to filter:
    on the 2026-09-05 rooms it called 1756 cells furniture and only 114 wall,
    starving the metrics of structure (decided 2026-09-05: drop the tag
    dependency). At LiDAR height (~0.18 m) "furniture" is table legs, sofa
    fronts, cabinet bases -- fixed enough to align against."""
    return cell_centres(s, (s.codes == CODE_OCC_WALL) | (s.codes == CODE_OCC_FURNITURE))


def codes_at(s: Slice, xy_local: np.ndarray) -> np.ndarray:
    """Per point: this slice's code at that (local-frame) spot; CODE_UNKNOWN
    outside the grid."""
    col = np.floor((xy_local[:, 0] - s.origin[0]) / s.resolution).astype(np.int64)
    row = np.floor((xy_local[:, 1] - s.origin[1]) / s.resolution).astype(np.int64)
    ok = (col >= 0) & (col < s.cols) & (row >= 0) & (row < s.rows)
    out = np.full(len(xy_local), CODE_UNKNOWN, dtype=np.uint8)
    out[ok] = s.codes[row[ok], col[ok]]
    return out


def is_free_at(s: Slice, xy_local: np.ndarray) -> np.ndarray:
    """Boolean per point: does this slice call that (local-frame) spot FREE?"""
    return codes_at(s, xy_local) == CODE_FREE


def is_observed_at(s: Slice, xy_local: np.ndarray) -> np.ndarray:
    """Boolean per point: did this slice see that spot at all (free or occupied)?"""
    return codes_at(s, xy_local) != CODE_UNKNOWN


@dataclass
class AlignmentMetrics:
    n_source: int
    n_observed: int  # source wall points that fall inside some other scan's observed area
    overlap_m: float
    inlier: float    # over the observed subset
    conflict: float  # over the observed subset
    rmse_m: float    # RMS distance of the inlier correspondences

    def to_json(self) -> dict:
        return {
            "n_source": self.n_source,
            "n_observed": self.n_observed,
            "overlap_m": round(self.overlap_m, 3),
            "inlier": round(self.inlier, 4),
            "conflict": round(self.conflict, 4),
            "rmse_m": round(self.rmse_m, 4) if math.isfinite(self.rmse_m) else None,
        }


def evaluate(
    source: Slice,
    source_alignment: ScanAlignment,
    targets: list[tuple[Slice, ScanAlignment]],
    corr_dist: float = 0.15,
    coarse_dist: float = 0.5,
) -> AlignmentMetrics:
    """Score `source` placed by `source_alignment` against every other scan
    (each placed by its own alignment). Frames: everything is moved into the
    reference frame for the wall-to-wall test; for the conflict test the
    source walls are moved into each target's LOCAL frame and looked up in
    that target's grid.

    Two correspondence radii: `overlap_m` is measured at `coarse_dist` (the
    radius ICP's first pass would use -- it answers "is there anything within
    ICP's reach?"), while inlier / rmse use the tight `corr_dist` (they
    answer "is it aligned?"). A rough hand placement 30 cm off has overlap
    but no tight inliers; that is exactly the state ICP is for."""
    src_local = wall_points(source)
    n = len(src_local)
    if n == 0:
        return AlignmentMetrics(0, 0, 0.0, 0.0, 0.0, float("inf"))
    src_ref = source_alignment.apply_xy(src_local)

    tgt_ref_parts = [a.apply_xy(wall_points(t)) for t, a in targets]
    tgt_ref = np.concatenate([p for p in tgt_ref_parts if len(p)]) if any(len(p) for p in tgt_ref_parts) else np.zeros((0, 2))

    if len(tgt_ref) == 0:
        inl = np.zeros(n, dtype=bool)
        coarse = np.zeros(n, dtype=bool)
        d = np.full(n, np.inf)
    else:
        d, _ = cKDTree(tgt_ref).query(src_ref, distance_upper_bound=coarse_dist)
        coarse = np.isfinite(d)
        inl = d <= corr_dist

    # Only source walls that land where some other scan actually LOOKED can be
    # judged. Adjacent rooms share a doorway and a strip of corridor, not the
    # whole room, so most of the source's walls fall in the others' unknown
    # area and say nothing either way. Ratios are therefore over the observed
    # subset, not over all source walls -- otherwise a correct pose of two
    # rooms sharing 2 m of corridor scores inlier 0.28 and looks wrong.
    observed = np.zeros(n, dtype=bool)
    conflict = np.zeros(n, dtype=bool)
    for t, a in targets:
        local = a.inverse_xy(src_ref)
        observed |= is_observed_at(t, local)
        conflict |= is_free_at(t, local)
    n_obs = int(observed.sum())

    inlier = float(inl[observed].mean()) if n_obs else 0.0
    rmse = float(np.sqrt(np.mean(d[inl] ** 2))) if inl.any() else float("inf")
    return AlignmentMetrics(
        n_source=n,
        n_observed=n_obs,
        overlap_m=float(coarse.sum()) * source.resolution,
        inlier=inlier,
        conflict=float(conflict[observed].mean()) if n_obs else 0.0,
        rmse_m=rmse,
    )


def alignment_from_rigid_2d(rotation: np.ndarray, translation: np.ndarray) -> ScanAlignment:
    """Slice-plane rigid transform p' = R p + t  ->  ScanAlignment. Inverse of
    the mapping in merge_slicemaps (R = [[c, -s], [s, c]], t = (offsetX, -offsetZ))."""
    yaw = math.atan2(rotation[1, 0], rotation[0, 0])
    return ScanAlignment(offsetX=float(translation[0]), offsetZ=float(-translation[1]), yawRadians=yaw)


def pin_fit(source_pts: np.ndarray, reference_pts: np.ndarray) -> ScanAlignment:
    """Closed-form rigid fit from >= 2 corresponding point pairs: source scan
    local (x, y) -> reference frame (x, y). Two door-frame corners shared by
    two scans are enough to pin all three degrees of freedom; more pairs give
    a least-squares fit. Wraps registration.best_fit_transform_2d (Kabsch)."""
    source_pts = np.asarray(source_pts, dtype=float)
    reference_pts = np.asarray(reference_pts, dtype=float)
    if source_pts.shape != reference_pts.shape or len(source_pts) < 2:
        raise ValueError("pin_fit needs at least two (source, reference) pairs of equal count")
    rot, t = best_fit_transform_2d(source_pts, reference_pts)
    return alignment_from_rigid_2d(rot, t)


def pin_residuals(a: ScanAlignment, source_pts: np.ndarray, reference_pts: np.ndarray) -> np.ndarray:
    """Per-pair distance (m) between the moved source pin and its reference pin."""
    moved = a.apply_xy(np.asarray(source_pts, dtype=float))
    return np.linalg.norm(moved - np.asarray(reference_pts, dtype=float), axis=1)
