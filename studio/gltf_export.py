"""Combine a textured mesh (e.g. a raw .usdz scan) and one or more point
clouds (e.g. our processed base map / occupancy sources) into a single .glb
scene, so they can be viewed overlaid in a single-asset viewer like
gltf-inspector (https://github.com/dcrobot-keen/gltf-inspector) -- it loads
one primary glTF/GLB at a time, so "overlay two files" means "merge into one
file with multiple nodes" rather than loading two files side by side.
"""
from __future__ import annotations

import io
from dataclasses import dataclass

import numpy as np
import trimesh

from studio.usdz_import import UsdzMesh


@dataclass
class PointCloudLayer:
    name: str
    points: np.ndarray  # (N, 3)
    # a single flat RGBA to apply to every point, OR a per-point (N, 3)/(N, 4)
    # array (e.g. the PLY's own original colors, sampled from a texture --
    # see studio.usdz_import.sample_vertex_colors)
    color: tuple[int, int, int, int] | np.ndarray = (255, 0, 0, 255)


def build_overlay_scene(mesh: UsdzMesh | None, point_clouds: list[PointCloudLayer]) -> trimesh.Scene:
    scene = trimesh.Scene()

    if mesh is not None:
        visual = None
        if mesh.texture is not None and mesh.uv is not None:
            from PIL import Image

            image = Image.open(io.BytesIO(mesh.texture))
            visual = trimesh.visual.TextureVisuals(uv=mesh.uv, image=image)
        tmesh = trimesh.Trimesh(vertices=mesh.vertices, faces=mesh.faces, visual=visual, process=False)
        scene.add_geometry(tmesh, node_name="scan_mesh")

    for layer in point_clouds:
        color_arr = np.asarray(layer.color)
        if color_arr.ndim == 2:  # per-point colors already, e.g. sampled from a texture
            colors = color_arr
            if colors.shape[1] == 3:
                alpha = np.full((len(colors), 1), 255, dtype=np.uint8)
                colors = np.hstack([colors, alpha])
        else:  # single flat RGBA applied to every point
            colors = np.tile(color_arr.astype(np.uint8), (len(layer.points), 1))
        cloud = trimesh.PointCloud(layer.points, colors=colors.astype(np.uint8))
        scene.add_geometry(cloud, node_name=layer.name)

    return scene


def save_overlay_glb(mesh: UsdzMesh | None, point_clouds: list[PointCloudLayer], output_path: str) -> None:
    scene = build_overlay_scene(mesh, point_clouds)
    scene.export(output_path)
