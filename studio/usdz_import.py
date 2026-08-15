"""Import a .usdz/.usd scan (e.g. exported by an iPhone LiDAR scanning app)
into a plain (x, y, z) point array in our Z-up, meters convention.

Requires the `usd-core` package (Pixar's OpenUSD Python bindings).
"""
from __future__ import annotations

import numpy as np
from pxr import Usd, UsdGeom


def load_usdz_points(path: str) -> np.ndarray:
    """Extract and world-transform all mesh vertex positions from a USD(Z)
    file, converting to Z-up meters if the stage is authored Y-up (the
    common case for ARKit-based scanning apps).
    """
    stage = Usd.Stage.Open(str(path))
    if stage is None:
        raise ValueError(f"could not open USD stage: {path}")

    up_axis = UsdGeom.GetStageUpAxis(stage)
    meters_per_unit = UsdGeom.GetStageMetersPerUnit(stage)

    xform_cache = UsdGeom.XformCache()
    all_points: list[np.ndarray] = []

    for prim in stage.Traverse():
        if not prim.IsA(UsdGeom.Mesh):
            continue
        mesh = UsdGeom.Mesh(prim)
        raw = mesh.GetPointsAttr().Get()
        if not raw:
            continue
        local_points = np.array(raw, dtype=np.float64)

        matrix = np.array(xform_cache.GetLocalToWorldTransform(prim), dtype=np.float64).reshape(4, 4)
        homogeneous = np.hstack([local_points, np.ones((len(local_points), 1))])
        world_points = (homogeneous @ matrix)[:, :3]  # USD: row-vector * matrix
        all_points.append(world_points)

    if not all_points:
        raise ValueError(f"no mesh geometry found in {path}")

    points = np.concatenate(all_points, axis=0) * meters_per_unit

    if up_axis == UsdGeom.Tokens.y:
        x, y, z = points[:, 0], points[:, 1], points[:, 2]
        points = np.column_stack([x, -z, y])
    elif up_axis != UsdGeom.Tokens.z:
        raise ValueError(f"unexpected stage up axis: {up_axis!r}")

    return points
