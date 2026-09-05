"""PLY point cloud read/write helpers built on plyfile (pure-Python, no compiled
extensions), used instead of Open3D because Open3D has no wheel for Python 3.13 yet.
"""
from __future__ import annotations

from pathlib import Path

import numpy as np
from plyfile import PlyData, PlyElement


def load_point_cloud(path: str | Path) -> tuple[np.ndarray, np.ndarray | None]:
    """Load a PLY file's vertex positions (and colors, if present).

    Returns (points, colors): points is (N, 3) float64; colors is (N, 3) uint8
    or None if the file has no red/green/blue vertex properties.
    """
    ply = PlyData.read(str(path))
    vertex = ply["vertex"]
    points = np.stack(
        [np.asarray(vertex["x"]), np.asarray(vertex["y"]), np.asarray(vertex["z"])],
        axis=1,
    ).astype(np.float64)

    names = vertex.data.dtype.names
    colors = None
    if names is not None and {"red", "green", "blue"}.issubset(names):
        colors = np.stack(
            [vertex["red"], vertex["green"], vertex["blue"]], axis=1
        ).astype(np.uint8)

    return points, colors


def save_point_cloud(
    path: str | Path,
    points: np.ndarray,
    colors: np.ndarray | None = None,
    binary: bool = True,
) -> None:
    """Write points (N, 3) and optional colors (N, 3) uint8 to a PLY file."""
    points = np.asarray(points, dtype=np.float64)
    if colors is None:
        dtype = [("x", "f4"), ("y", "f4"), ("z", "f4")]
        data = np.empty(len(points), dtype=dtype)
        data["x"], data["y"], data["z"] = (
            points[:, 0],
            points[:, 1],
            points[:, 2],
        )
    else:
        colors = np.asarray(colors, dtype=np.uint8)
        dtype = [
            ("x", "f4"),
            ("y", "f4"),
            ("z", "f4"),
            ("red", "u1"),
            ("green", "u1"),
            ("blue", "u1"),
        ]
        data = np.empty(len(points), dtype=dtype)
        data["x"], data["y"], data["z"] = (
            points[:, 0],
            points[:, 1],
            points[:, 2],
        )
        data["red"], data["green"], data["blue"] = (
            colors[:, 0],
            colors[:, 1],
            colors[:, 2],
        )

    element = PlyElement.describe(data, "vertex")
    PlyData([element], text=not binary).write(str(path))
