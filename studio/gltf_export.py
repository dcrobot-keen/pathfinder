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
from pathlib import Path

import numpy as np
import trimesh

from studio.usdz_import import UsdzMesh

# glTF is Y-up; our frame is Z-up with (x, y, z) = (x_arkit, -z_arkit, y_arkit) -- the same
# conversion usdz_import applies to the usdz points, so both meshes land in one frame.
_YUP_TO_ZUP = np.array([[1, 0, 0, 0], [0, 0, -1, 0], [0, 1, 0, 0], [0, 0, 0, 1]], dtype=np.float64)


def load_textured_scan_mesh(glb_path: str | Path) -> trimesh.Trimesh:
    """The iOS app (vps-system/ios-capture TextureBaker) bakes the RGB keyframes onto the
    LiDAR mesh and writes `textured.glb` next to `scan.usdz` -- the usdz itself carries no
    texture. Load it as one textured Trimesh in our Z-up meters frame."""
    loaded = trimesh.load(str(glb_path), force="mesh")
    if not isinstance(loaded, trimesh.Trimesh):
        raise ValueError(f"{glb_path}: expected a single mesh, got {type(loaded).__name__}")
    loaded.apply_transform(_YUP_TO_ZUP)
    return loaded


@dataclass
class PointCloudLayer:
    name: str
    points: np.ndarray  # (N, 3)
    # a single flat RGBA to apply to every point, OR a per-point (N, 3)/(N, 4)
    # array (e.g. the PLY's own original colors, sampled from a texture --
    # see studio.usdz_import.sample_vertex_colors)
    color: tuple[int, int, int, int] | np.ndarray = (255, 0, 0, 255)


def build_overlay_scene(
    mesh: UsdzMesh | None,
    point_clouds: list[PointCloudLayer],
    textured_glb: str | Path | None = None,
) -> trimesh.Scene:
    scene = trimesh.Scene()

    if textured_glb is not None:
        # prefer the app's baked textured mesh over the bare usdz geometry
        scene.add_geometry(load_textured_scan_mesh(textured_glb), node_name="scan_mesh")
    elif mesh is not None:
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


def save_overlay_glb(
    mesh: UsdzMesh | None,
    point_clouds: list[PointCloudLayer],
    output_path: str,
    textured_glb: str | Path | None = None,
) -> None:
    scene = build_overlay_scene(mesh, point_clouds, textured_glb=textured_glb)
    scene.export(output_path)
