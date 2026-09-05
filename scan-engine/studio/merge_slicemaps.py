"""Merge several slicemap-v1 grids (one per iPhone scan) into ONE grid using
per-scan rigid 2D alignments -- the desktop half of "여러 스캔을 한 좌표계로".

Why this exists: ios-capture groups scans into a project and stores, per
scan, a `ScanAlignment(offsetX, offsetZ, yawRadians)` that moves that scan
into the first (reference) scan's coordinate system. Downstream consumers
(ros-chromium simulator worlds, nav.html's iPhone-map prior, pathfinder) each
read a single slicemap, so the scans have to be composited before they get
there. This module does the compositing; `scripts/merge_slicemaps.py` is the
CLI.

Frames. ScanAlignment is defined in ARKit's ground plane (x, z) -- see
ScanGroupStore.swift:

    applyXZ(x, z) = (x*c + z*s + offsetX,  -x*s + z*c + offsetZ)

Everything on the studio side is Z-up after usdz_import's (x, y, z) ->
(x, -z, y), so the slicemap plane is (x_slice, y_slice) = (x_arkit, -z_arkit).
Substituting gives, in slice coordinates,

    [x', y'] = R(yaw) @ [x, y] + [offsetX, -offsetZ],   R = [[c, -s], [s, c]]

i.e. a plain counter-clockwise rotation by yaw plus a translation whose y
component flips sign. That is the one place the two conventions meet; keep it
here and nowhere else.

Compositing rule: for every output cell, sample each source (nearest cell,
inverse-transformed) and keep the MAX code. Codes are ordered
unknown(0) < free(1) < furniture(2) < wall(3), so max is exactly "occupied
beats free beats unknown" -- conservative for navigation when two scans
disagree.
"""
from __future__ import annotations

import base64
import json
import math
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

CODE_UNKNOWN = 0
CODE_FREE = 1
CODE_OCC_FURNITURE = 2
CODE_OCC_WALL = 3

ALIGNMENT_FORMAT = "scan-group-alignment-v1"


# --------------------------------------------------------------------------
# slicemap-v1 I/O (codes as a numpy array; mirrors slice_map.save_slice_json)
# --------------------------------------------------------------------------

@dataclass
class Slice:
    codes: np.ndarray  # (rows, cols) uint8, row 0 = min y, col 0 = min x
    resolution: float
    origin: tuple[float, float]  # world (x, y) of the lower-left corner of codes[0, 0]
    z: float
    band: float
    sources: list[dict] = field(default_factory=list)  # provenance, written back to JSON

    @property
    def rows(self) -> int:
        return int(self.codes.shape[0])

    @property
    def cols(self) -> int:
        return int(self.codes.shape[1])

    def bounds(self) -> tuple[float, float, float, float]:
        """(min_x, min_y, max_x, max_y) of the grid extent in its own frame."""
        x0, y0 = self.origin
        return (x0, y0, x0 + self.cols * self.resolution, y0 + self.rows * self.resolution)


def load_slice(path: str | Path) -> Slice:
    obj = json.loads(Path(path).read_text(encoding="ascii"))
    return slice_from_obj(obj)


def slice_from_obj(obj: dict) -> Slice:
    if obj.get("format") != "slicemap-v1":
        raise ValueError("not a slicemap-v1 object")
    raw = base64.b64decode(obj["data"])
    codes = np.frombuffer(raw, dtype=np.uint8)
    if codes.size != obj["cols"] * obj["rows"]:
        raise ValueError(f"slicemap data length {codes.size} != cols*rows {obj['cols'] * obj['rows']}")
    return Slice(
        codes=codes.reshape(obj["rows"], obj["cols"]).copy(),
        resolution=float(obj["resolution"]),
        origin=(float(obj["origin"][0]), float(obj["origin"][1])),
        z=float(obj["z"]),
        band=float(obj["band"]),
        sources=list(obj.get("sources", [])),
    )


def slice_to_obj(s: Slice) -> dict:
    obj = {
        "format": "slicemap-v1",
        "z": s.z,
        "band": s.band,
        "resolution": s.resolution,
        "origin": [s.origin[0], s.origin[1]],
        "cols": s.cols,
        "rows": s.rows,
        "data": base64.b64encode(np.ascontiguousarray(s.codes, dtype=np.uint8).tobytes()).decode("ascii"),
    }
    if s.sources:
        obj["sources"] = s.sources  # extra key; every existing loader ignores it
    return obj


def save_slice(path: str | Path, s: Slice) -> Path:
    path = Path(path)
    path.write_text(json.dumps(slice_to_obj(s)), encoding="ascii")
    return path


def save_preview_png(path: str | Path, s: Slice) -> Path:
    """Grayscale quick-look: unknown 205 (the studio convention), free white,
    furniture dark gray, wall black. Row 0 (min y) is drawn at the BOTTOM so
    the image is north-up like every other map preview here."""
    from PIL import Image

    img = np.full(s.codes.shape, 205, dtype=np.uint8)
    img[s.codes == CODE_FREE] = 255
    img[s.codes == CODE_OCC_FURNITURE] = 90
    img[s.codes == CODE_OCC_WALL] = 0
    path = Path(path)
    Image.fromarray(np.flipud(img), mode="L").save(path)
    return path


# --------------------------------------------------------------------------
# alignments
# --------------------------------------------------------------------------

@dataclass
class ScanAlignment:
    """Same three numbers as ios-capture's ScanAlignment, same meaning: moves a
    scan's local ARKit (x, z) into the reference scan's ARKit (x, z)."""
    offsetX: float = 0.0
    offsetZ: float = 0.0
    yawRadians: float = 0.0
    method: str = "identity"
    metrics: dict = field(default_factory=dict)

    # -- ARKit-plane form, byte-for-byte the Swift applyXZ / inverseXZ ----------
    def apply_xz(self, x: float, z: float) -> tuple[float, float]:
        c, s = math.cos(self.yawRadians), math.sin(self.yawRadians)
        return (x * c + z * s + self.offsetX, -x * s + z * c + self.offsetZ)

    def inverse_xz(self, x: float, z: float) -> tuple[float, float]:
        dx, dz = x - self.offsetX, z - self.offsetZ
        c, s = math.cos(self.yawRadians), math.sin(self.yawRadians)
        return (dx * c - dz * s, dx * s + dz * c)

    # -- slice-plane form (x_slice, y_slice) = (x_arkit, -z_arkit) --------------
    def apply_xy(self, xy: np.ndarray) -> np.ndarray:
        c, s = math.cos(self.yawRadians), math.sin(self.yawRadians)
        rot = np.array([[c, -s], [s, c]])
        return xy @ rot.T + np.array([self.offsetX, -self.offsetZ])

    def inverse_xy(self, xy: np.ndarray) -> np.ndarray:
        c, s = math.cos(self.yawRadians), math.sin(self.yawRadians)
        rot_inv = np.array([[c, s], [-s, c]])
        return (xy - np.array([self.offsetX, -self.offsetZ])) @ rot_inv.T

    def to_json(self) -> dict:
        d = {"offsetX": self.offsetX, "offsetZ": self.offsetZ, "yawRadians": self.yawRadians, "method": self.method}
        if self.metrics:
            d["metrics"] = self.metrics
        return d

    @staticmethod
    def from_json(d: dict, default_method: str = "app") -> "ScanAlignment":
        return ScanAlignment(
            offsetX=float(d.get("offsetX", 0.0)),
            offsetZ=float(d.get("offsetZ", 0.0)),
            yawRadians=float(d.get("yawRadians", 0.0)),
            method=str(d.get("method", default_method)),
            metrics=dict(d.get("metrics", {})),
        )


@dataclass
class GroupAlignment:
    reference: str
    alignments: dict[str, ScanAlignment]
    group: str | None = None

    def get(self, scan_id: str) -> ScanAlignment:
        if scan_id == self.reference:
            return ScanAlignment(method="reference")
        return self.alignments.get(scan_id, ScanAlignment())

    def to_json(self) -> dict:
        return {
            "format": ALIGNMENT_FORMAT,
            "group": self.group,
            "reference": self.reference,
            "up_axis_convention": "top = -z",
            "alignments": {k: v.to_json() for k, v in self.alignments.items() if k != self.reference},
        }


def load_group_alignment(path: str | Path, group: str | None = None) -> GroupAlignment:
    """Accepts either this module's `scan-group-alignment-v1` file or the app's
    own `scan_groups.json` (a ScanGroup, a list of them, or {"groups": [...]});
    for the latter, `group` picks by id or name when more than one is present.
    The reference scan is `scanIDs[0]`, exactly like ScanGroupMerger."""
    obj = json.loads(Path(path).read_text(encoding="utf-8"))

    if isinstance(obj, dict) and obj.get("format") == ALIGNMENT_FORMAT:
        return GroupAlignment(
            reference=obj["reference"],
            alignments={k: ScanAlignment.from_json(v, "manual") for k, v in obj.get("alignments", {}).items()},
            group=obj.get("group"),
        )

    groups: list[dict]
    if isinstance(obj, list):
        groups = obj
    elif isinstance(obj, dict) and "groups" in obj:
        groups = list(obj["groups"])
    elif isinstance(obj, dict) and "scanIDs" in obj:
        groups = [obj]
    else:
        raise ValueError(f"{path}: neither {ALIGNMENT_FORMAT} nor a scan_groups.json shape I recognise")

    if group is not None:
        groups = [g for g in groups if g.get("id") == group or g.get("name") == group]
        if not groups:
            raise ValueError(f"group {group!r} not found in {path}")
    if len(groups) != 1:
        names = ", ".join(f"{g.get('name')!r} ({g.get('id')})" for g in groups)
        raise ValueError(f"{path} holds {len(groups)} groups -- pick one with --group: {names}")
    g = groups[0]
    scan_ids = list(g.get("scanIDs", []))
    if not scan_ids:
        raise ValueError(f"group {g.get('name')!r} has no scans")
    return GroupAlignment(
        reference=scan_ids[0],
        alignments={k: ScanAlignment.from_json(v, "app") for k, v in g.get("alignments", {}).items()},
        group=g.get("name") or g.get("id"),
    )


def save_group_alignment(path: str | Path, ga: GroupAlignment) -> Path:
    path = Path(path)
    path.write_text(json.dumps(ga.to_json(), indent=2, ensure_ascii=False), encoding="utf-8")
    return path


def row_layout(slices: dict[str, Slice], reference: str, gap_m: float = 1.0) -> GroupAlignment:
    """Placeholder alignment: put every non-reference scan to the right of the
    previous one in a row, bottoms aligned, no rotation. Used to prove the
    plumbing before real alignments (anchoring / pins / ICP) exist, and as an
    editable starting file. Marked method="layout" so nothing downstream
    mistakes it for a measured alignment."""
    order = [reference] + [k for k in slices if k != reference]
    ref_b = slices[reference].bounds()
    cursor_x = ref_b[2]
    out: dict[str, ScanAlignment] = {}
    for scan_id in order[1:]:
        b = slices[scan_id].bounds()
        dx = (cursor_x + gap_m) - b[0]
        dy = ref_b[1] - b[1]
        # slice-frame translation (dx, dy) == ARKit (offsetX, offsetZ) = (dx, -dy)
        out[scan_id] = ScanAlignment(offsetX=dx, offsetZ=-dy, yawRadians=0.0, method="layout")
        cursor_x = b[2] + dx
    return GroupAlignment(reference=reference, alignments=out)


# --------------------------------------------------------------------------
# merge
# --------------------------------------------------------------------------

def _corners(s: Slice) -> np.ndarray:
    x0, y0, x1, y1 = s.bounds()
    return np.array([[x0, y0], [x1, y0], [x1, y1], [x0, y1]])


def merge_slices(
    slices: dict[str, Slice],
    ga: GroupAlignment,
    resolution: float | None = None,
    padding_m: float = 0.25,
) -> Slice:
    if ga.reference not in slices:
        raise ValueError(f"reference scan {ga.reference!r} has no slicemap among {sorted(slices)}")
    ref = slices[ga.reference]
    res = float(resolution or ref.resolution)

    for sid, s in slices.items():
        if abs(s.z - ref.z) > 1e-3 or abs(s.band - ref.band) > 1e-3:
            print(f"warning: {sid} sliced at z={s.z}±{s.band} but reference is z={ref.z}±{ref.band}")

    # output frame = reference frame; extent = union of transformed corners
    all_corners = np.concatenate([ga.get(sid).apply_xy(_corners(s)) for sid, s in slices.items()])
    min_xy = all_corners.min(axis=0) - padding_m
    max_xy = all_corners.max(axis=0) + padding_m
    cols = int(math.ceil((max_xy[0] - min_xy[0]) / res))
    rows = int(math.ceil((max_xy[1] - min_xy[1]) / res))
    origin = (float(min_xy[0]), float(min_xy[1]))

    # cell centres of the output grid, in the reference frame
    cx = origin[0] + (np.arange(cols) + 0.5) * res
    cy = origin[1] + (np.arange(rows) + 0.5) * res
    gx, gy = np.meshgrid(cx, cy)  # (rows, cols)
    centres = np.column_stack([gx.ravel(), gy.ravel()])

    merged = np.zeros(rows * cols, dtype=np.uint8)
    sources: list[dict] = []
    for sid, s in slices.items():
        a = ga.get(sid)
        local = a.inverse_xy(centres)
        col = np.floor((local[:, 0] - s.origin[0]) / s.resolution).astype(np.int64)
        row = np.floor((local[:, 1] - s.origin[1]) / s.resolution).astype(np.int64)
        ok = (col >= 0) & (col < s.cols) & (row >= 0) & (row < s.rows)
        sampled = np.zeros(rows * cols, dtype=np.uint8)
        sampled[ok] = s.codes[row[ok], col[ok]]
        np.maximum(merged, sampled, out=merged)
        sources.append({"scan": sid, **a.to_json(), "cells": int(np.count_nonzero(sampled))})

    return Slice(
        codes=merged.reshape(rows, cols),
        resolution=res,
        origin=origin,
        z=ref.z,
        band=ref.band,
        sources=sources,
    )


def summarize(s: Slice) -> str:
    c = s.codes
    return (
        f"{s.cols}x{s.rows} @ {s.resolution} m/cell, origin=({s.origin[0]:.3f}, {s.origin[1]:.3f}), "
        f"free={int((c == CODE_FREE).sum())} furniture={int((c == CODE_OCC_FURNITURE).sum())} "
        f"wall={int((c == CODE_OCC_WALL).sum())} unknown={int((c == CODE_UNKNOWN).sum())}"
    )
