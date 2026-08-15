"""Import a .usdz/.usd scan (e.g. exported by an iPhone LiDAR scanning app)
into plain numpy geometry in our Z-up, meters convention.

Requires the `usd-core` package (Pixar's OpenUSD Python bindings).
"""
from __future__ import annotations

import zipfile
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from pxr import Usd, UsdGeom


def _convert_to_zup(points: np.ndarray, up_axis) -> np.ndarray:
    if up_axis == UsdGeom.Tokens.y:
        x, y, z = points[:, 0], points[:, 1], points[:, 2]
        return np.column_stack([x, -z, y])
    if up_axis == UsdGeom.Tokens.z:
        return points
    raise ValueError(f"unexpected stage up axis: {up_axis!r}")


def _world_points(mesh, xform_cache) -> np.ndarray:
    local_points = np.array(mesh.GetPointsAttr().Get(), dtype=np.float64)
    matrix = np.array(xform_cache.GetLocalToWorldTransform(mesh.GetPrim()), dtype=np.float64).reshape(4, 4)
    homogeneous = np.hstack([local_points, np.ones((len(local_points), 1))])
    return (homogeneous @ matrix)[:, :3]  # USD: row-vector * matrix


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

    all_points = [
        _world_points(UsdGeom.Mesh(prim), xform_cache)
        for prim in stage.Traverse()
        if prim.IsA(UsdGeom.Mesh) and UsdGeom.Mesh(prim).GetPointsAttr().Get()
    ]
    if not all_points:
        raise ValueError(f"no mesh geometry found in {path}")

    points = np.concatenate(all_points, axis=0) * meters_per_unit
    return _convert_to_zup(points, up_axis)


@dataclass
class UsdzMesh:
    vertices: np.ndarray  # (N, 3) Z-up meters
    faces: np.ndarray  # (F, 3) int, triangle vertex indices into `vertices`
    uv: np.ndarray | None  # (N, 2) or None if not available / not per-vertex
    texture: bytes | None  # raw image bytes (jpg/png) or None


def load_usdz_mesh(path: str) -> UsdzMesh:
    """Extract a combined triangle mesh (with UVs, if a simple per-vertex UV
    is available) plus the first embedded texture image found in the .usdz
    archive. Only triangulated meshes are supported (the common case for
    scanning-app exports).
    """
    stage = Usd.Stage.Open(str(path))
    if stage is None:
        raise ValueError(f"could not open USD stage: {path}")

    up_axis = UsdGeom.GetStageUpAxis(stage)
    meters_per_unit = UsdGeom.GetStageMetersPerUnit(stage)
    xform_cache = UsdGeom.XformCache()

    all_vertices: list[np.ndarray] = []
    all_faces: list[np.ndarray] = []
    all_uv: list[np.ndarray | None] = []
    vertex_offset = 0

    for prim in stage.Traverse():
        if not prim.IsA(UsdGeom.Mesh):
            continue
        mesh = UsdGeom.Mesh(prim)
        if not mesh.GetPointsAttr().Get():
            continue

        counts = np.array(mesh.GetFaceVertexCountsAttr().Get())
        if len(counts) == 0 or not np.all(counts == 3):
            raise NotImplementedError(
                f"{prim.GetPath()}: only triangulated meshes are supported "
                f"(found face(s) with != 3 vertices)"
            )
        indices = np.array(mesh.GetFaceVertexIndicesAttr().Get(), dtype=np.int64).reshape(-1, 3)

        points = _world_points(mesh, xform_cache)

        uv = None
        pv_api = UsdGeom.PrimvarsAPI(mesh)
        st_pv = pv_api.GetPrimvar("st")
        if st_pv and st_pv.HasValue():
            st = np.array(st_pv.Get(), dtype=np.float64)
            if len(st) == len(points):
                uv = st  # simple per-vertex UV (indices match position indices)

        all_vertices.append(points)
        all_faces.append(indices + vertex_offset)
        all_uv.append(uv)
        vertex_offset += len(points)

    if not all_vertices:
        raise ValueError(f"no mesh geometry found in {path}")

    vertices = np.concatenate(all_vertices, axis=0) * meters_per_unit
    vertices = _convert_to_zup(vertices, up_axis)
    faces = np.concatenate(all_faces, axis=0)
    uv = np.concatenate(all_uv, axis=0) if all(u is not None for u in all_uv) else None

    texture = None
    if Path(path).suffix.lower() == ".usdz":
        with zipfile.ZipFile(path) as z:
            image_names = [n for n in z.namelist() if n.lower().endswith((".jpg", ".jpeg", ".png"))]
            if image_names:
                texture = z.read(image_names[0])

    return UsdzMesh(vertices=vertices, faces=faces, uv=uv, texture=texture)


def sample_vertex_colors(uv: np.ndarray, texture: bytes) -> np.ndarray:
    """Sample the texture image at each vertex's UV coordinate (nearest
    neighbor) to get a per-vertex RGB color -- there's no per-vertex color
    primvar in typical scanning-app usdz exports (just UV + a photo texture),
    so this is how you recover "what did this point actually look like".
    """
    import io

    from PIL import Image

    image = np.array(Image.open(io.BytesIO(texture)).convert("RGB"))
    height, width = image.shape[:2]

    u = np.clip(uv[:, 0], 0.0, 1.0)
    v = np.clip(uv[:, 1], 0.0, 1.0)
    col = np.clip((u * (width - 1)).astype(np.int64), 0, width - 1)
    row = np.clip(((1.0 - v) * (height - 1)).astype(np.int64), 0, height - 1)  # USD st: v=0 at bottom

    return image[row, col].astype(np.uint8)
