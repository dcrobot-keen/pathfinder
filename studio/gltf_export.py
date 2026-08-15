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
    color: tuple[int, int, int, int] = (255, 0, 0, 255)  # RGBA 0-255


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
        colors = np.tile(np.array(layer.color, dtype=np.uint8), (len(layer.points), 1))
        cloud = trimesh.PointCloud(layer.points, colors=colors)
        scene.add_geometry(cloud, node_name=layer.name)

    return scene


def save_overlay_glb(mesh: UsdzMesh | None, point_clouds: list[PointCloudLayer], output_path: str) -> None:
    scene = build_overlay_scene(mesh, point_clouds)
    scene.export(output_path)
