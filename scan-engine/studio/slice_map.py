"""Height-slice rasterization: re-synthesize a 2D occupancy grid at a *specific
sensor height* instead of the full-height column projection
(studio.rasterize.rasterize_occupancy_grid).

Why this exists
---------------
A mobile robot's 2D LiDAR sees one horizontal plane (~0.18 m for a
TurtleBot3). The full-height projection collapses every height into 2D, so a
table becomes a solid rectangle -- but the robot only sees its four legs.
The two 2D pictures don't match, which is what makes "hand the robot an
iPhone-scanned map" hard.

Slicing the ceiling-removed 3D cloud at the robot's own beam height fixes
that: a table sliced at 0.18 m *is* four dots, exactly what the LiDAR
returns. The same iPhone scan yields a different map per robot, keyed by
manifest `lidar.heightM`.

Cell values (studio.rasterize convention: -1 unknown / 0 free / 100 occupied):
- occupied: a non-floor point falls inside the slice band [z-band, z+band].
- free:     the column has floor visibility (a near-z=0 point) and nothing
            in the band -- the beam at height z passes through there.
- unknown:  no evidence either way (e.g. under a table the iPhone couldn't
            see the floor). The robot's own live scans fill these in later
            (robot-os-chromium MapNode uses this as a Bayes prior, not truth).

`classify` (optional per-point FLOOR/WALL/FURNITURE from studio.classify)
adds a parallel class grid so a downstream localizer can weight structural
walls (stable) above furniture (moves between the scan and the drive).
"""
from __future__ import annotations

import base64
import json
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from studio.rasterize import FREE, OCCUPIED, UNKNOWN, OccupancyGrid

# class grid values (only meaningful where occ == OCCUPIED)
CLS_NONE = 0
CLS_WALL = 1
CLS_FURNITURE = 2

# packed slicemap-v1 cell codes (for the JSON the JS side reads)
CODE_UNKNOWN = 0
CODE_FREE = 1
CODE_OCC_FURNITURE = 2  # also used when no class info is available
CODE_OCC_WALL = 3


@dataclass
class SliceGrid:
    occ: OccupancyGrid  # free/occupied/unknown, reuse studio.rasterize savers
    cls: np.ndarray  # (H, W) int8, CLS_*; meaningful only where occ.grid == OCCUPIED
    z: float  # slice centre height (m above floor)
    band: float  # slice half-thickness (m)


def rasterize_slice(
    points: np.ndarray,
    z: float,
    band: float = 0.05,
    resolution: float = 0.05,
    padding: float = 0.5,
    floor_z_tolerance: float = 0.05,
    labels: np.ndarray | None = None,
) -> SliceGrid:
    """Project a floor-normalized point cloud (z=0 at floor) into a 2D
    occupancy grid *as seen by a sensor at height `z`*.

    labels: optional (N,) array of studio.classify FLOOR/WALL/FURNITURE codes.
    """
    if len(points) == 0:
        raise ValueError("no points to rasterize")
    if band <= 0:
        raise ValueError("band must be positive")

    x, y, pz = points[:, 0], points[:, 1], points[:, 2]

    min_x, min_y = float(x.min() - padding), float(y.min() - padding)
    max_x, max_y = float(x.max() + padding), float(y.max() + padding)
    width = max(int(np.ceil((max_x - min_x) / resolution)), 1)
    height = max(int(np.ceil((max_y - min_y) / resolution)), 1)

    col = np.clip(((x - min_x) / resolution).astype(np.int64), 0, width - 1)
    row = np.clip(((y - min_y) / resolution).astype(np.int64), 0, height - 1)
    flat = row * width + col

    is_floor = pz <= floor_z_tolerance
    in_band = (pz >= z - band) & (pz <= z + band) & ~is_floor

    n_cells = width * height
    occ_hits = np.bincount(flat[in_band], minlength=n_cells) > 0
    floor_hits = np.bincount(flat[is_floor], minlength=n_cells) > 0

    grid = np.full(n_cells, UNKNOWN, dtype=np.int8)
    grid[floor_hits] = FREE  # floor visible + (checked next) nothing in the band
    grid[occ_hits] = OCCUPIED  # occupied overrides free
    grid = grid.reshape(height, width)

    cls = np.full((height, width), CLS_NONE, dtype=np.int8)
    if labels is not None:
        from studio.classify import FURNITURE, WALL

        band_idx = flat[in_band]
        band_lab = labels[in_band]
        wall_ct = np.bincount(band_idx[band_lab == WALL], minlength=n_cells)
        furn_ct = np.bincount(band_idx[band_lab == FURNITURE], minlength=n_cells)
        cls_flat = np.full(n_cells, CLS_NONE, dtype=np.int8)
        any_lab = (wall_ct + furn_ct) > 0
        cls_flat[any_lab] = np.where(wall_ct >= furn_ct, CLS_WALL, CLS_FURNITURE)[any_lab]
        cls = cls_flat.reshape(height, width)

    occ = OccupancyGrid(grid=grid, resolution=resolution, origin=(min_x, min_y))
    return SliceGrid(occ=occ, cls=cls, z=float(z), band=float(band))


def slice_to_codes(sg: SliceGrid) -> np.ndarray:
    """(H, W) uint8 grid of packed slicemap-v1 codes (row 0 = min y)."""
    codes = np.full(sg.occ.grid.shape, CODE_UNKNOWN, dtype=np.uint8)
    codes[sg.occ.grid == FREE] = CODE_FREE
    occ_mask = sg.occ.grid == OCCUPIED
    codes[occ_mask] = CODE_OCC_FURNITURE
    codes[occ_mask & (sg.cls == CLS_WALL)] = CODE_OCC_WALL
    return codes


def save_slice_json(path: str | Path, sg: SliceGrid) -> Path:
    """Write a compact self-describing JSON the robot-os-chromium side reads
    directly (no image decoding): base64 of a row-major uint8 code grid, plus
    the metric frame. Row 0 = min y, col 0 = min x -- matches that repo's
    occupancy-grid convention (cellIndex = row*cols + col, origin at the min
    corner).
    """
    path = Path(path)
    codes = slice_to_codes(sg)
    h, w = codes.shape
    obj = {
        "format": "slicemap-v1",
        "z": sg.z,
        "band": sg.band,
        "resolution": sg.occ.resolution,
        "origin": [sg.occ.origin[0], sg.occ.origin[1]],
        "cols": w,
        "rows": h,
        "data": base64.b64encode(codes.tobytes()).decode("ascii"),
    }
    path.write_text(json.dumps(obj), encoding="ascii")
    return path


def load_slice_json(path: str | Path) -> SliceGrid:
    """Inverse of save_slice_json (for round-trip tests / re-use)."""
    obj = json.loads(Path(path).read_text(encoding="ascii"))
    if obj.get("format") != "slicemap-v1":
        raise ValueError(f"not a slicemap-v1 file: {path}")
    h, w = obj["rows"], obj["cols"]
    codes = np.frombuffer(base64.b64decode(obj["data"]), dtype=np.uint8).reshape(h, w)

    grid = np.full((h, w), UNKNOWN, dtype=np.int8)
    grid[codes == CODE_FREE] = FREE
    grid[(codes == CODE_OCC_FURNITURE) | (codes == CODE_OCC_WALL)] = OCCUPIED
    cls = np.full((h, w), CLS_NONE, dtype=np.int8)
    cls[codes == CODE_OCC_WALL] = CLS_WALL
    cls[codes == CODE_OCC_FURNITURE] = CLS_FURNITURE

    occ = OccupancyGrid(grid=grid, resolution=obj["resolution"], origin=(obj["origin"][0], obj["origin"][1]))
    return SliceGrid(occ=occ, cls=cls, z=obj["z"], band=obj["band"])
