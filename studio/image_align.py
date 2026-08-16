"""Georeference an externally-sourced raster image (a scanned/photographed
floor plan) onto this project's base-map frame, via the same control-point
similarity-transform fit used for GeoJSON (`studio.geojson_align`,
PLAN.md "좌표 보정") -- reused as-is, not reimplemented.

The one thing that's different from the GeoJSON case, and silently wrong if
missed: image/canvas pixel coordinates have row increasing *downward*, but
our world coordinates have y increasing *upward* (same convention as
`studio.rasterize`/`studio.registration`). A normal (non-mirrored) photo
mapped onto world coordinates is therefore an orientation-*reversing*
transform, but `fit_similarity_transform`'s Umeyama fit explicitly forbids
reflections (that's the whole point of its `det(U)*det(V)` sign check) --
feeding it raw (col, row) against (world_x, world_y) produces a bad fit.
Negating the row coordinate before fitting cancels the axis-convention flip,
leaving a pure rotation+scale+translation for Umeyama to solve, and the
output is delivered as a standard ESRI world file (.pgw/.jgw/.tfw/...) --
the standard zero-cost way for any GIS/CAD tool to read a georeferenced
raster without us resampling/warping the pixels ourselves.
"""
from __future__ import annotations

from pathlib import Path

import numpy as np

from studio.geojson_align import SimilarityTransform, fit_similarity_transform

_WORLD_FILE_EXTENSIONS = {
    ".png": ".pgw",
    ".jpg": ".jgw",
    ".jpeg": ".jgw",
    ".tif": ".tfw",
    ".tiff": ".tfw",
    ".bmp": ".bpw",
    ".gif": ".gfw",
}


def fit_pixel_to_world_transform(pixel_points: np.ndarray, world_points: np.ndarray) -> SimilarityTransform:
    """Same fit as `studio.geojson_align.fit_similarity_transform`, with
    `pixel_points`' row (column index 1) negated first so the pixel-row-down
    vs world-y-up axis flip doesn't get passed to Umeyama as a reflection."""
    pixel_points = np.asarray(pixel_points, dtype=np.float64)
    flipped = pixel_points.copy()
    flipped[:, 1] = -flipped[:, 1]
    return fit_similarity_transform(flipped, world_points)


def world_file_lines(transform: SimilarityTransform) -> tuple[float, float, float, float, float, float]:
    """ESRI world file coefficients (A, D, B, E, C, F) -- the order the 6
    lines are written in -- for `world_x = A*col + B*row + C`,
    `world_y = D*col + E*row + F`, derived from a transform fit via
    `fit_pixel_to_world_transform` (i.e. `world = scale * R(theta) @ (col,
    -row) + translation`):

        world_x = scale*cos(theta)*col + scale*sin(theta)*row + tx
        world_y = scale*sin(theta)*col - scale*cos(theta)*row + ty

    So A=D=scale*sin/cos pair up as (A=s*cos, B=s*sin, D=s*sin, E=-s*cos).
    Sanity check at theta=0: A=scale, B=0, D=0, E=-scale, matching the
    textbook non-rotated world file (positive x pixel size, *negative* y
    pixel size, since row increases downward while world-y increases up).
    """
    theta = np.radians(transform.rotation_deg)
    s = transform.scale
    a = s * np.cos(theta)
    b = s * np.sin(theta)
    tx, ty = transform.translation
    return (float(a), float(b), float(b), float(-a), float(tx), float(ty))


def write_world_file(path: str | Path, transform: SimilarityTransform) -> Path:
    """Write the 6-line ESRI world file (A, D, B, E, C, F -- one coefficient
    per line, that specific order) for `transform`."""
    a, d, b, e, c, f = world_file_lines(transform)
    path = Path(path)
    path.write_text("\n".join(f"{v:.8f}" for v in (a, d, b, e, c, f)) + "\n", encoding="ascii")
    return path


def world_file_extension(image_path: str | Path) -> str:
    """Standard world-file extension for an image's own extension (e.g.
    .png -> .pgw); unrecognized extensions fall back to the generic .wld."""
    return _WORLD_FILE_EXTENSIONS.get(Path(image_path).suffix.lower(), ".wld")
