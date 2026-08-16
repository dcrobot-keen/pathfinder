"""Export a registration transform (studio.registration.icp_2d_multistart's
result, or a hand-tuned one from align.html's "변환값 내보내기") as a ROS2
static tf, instead of baking it into a re-projected/merged map file.

Why a tf and not a baked map: the robot's own app already understands tf --
`static_transform_publisher` is the standard way any ROS/nav2 tool (RViz,
costmap layers, `tf2_echo`, ...) picks up a fixed frame relationship with
zero custom parsing on the robot side. Re-projecting our GeoJSON/occupancy
grid into the robot's frame instead would mean regenerating a file every
time the robot re-maps; publishing one static tf means everything we already
export (GeoJSON, occupancy grid) stays in its own frame and gets looked up
through tf on demand.

Frame direction: `icp_2d_multistart(source=robot_points, target=base_points)`
finds the transform mapping robot points ONTO the base map, i.e.
`base_point = R(rotation_deg) @ robot_point + translation`. A tf's
`frame_id -> child_frame_id` transform expresses child_frame_id's origin as
seen from frame_id -- exactly this relationship, with frame_id as the base
map's frame and child_frame_id as the robot's own live frame. The robot's
SLAM stack almost always already owns the name `map`, so that name is
reserved for `child_frame_id`; the base map frame defaults to
`scan_basemap` to avoid the collision.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np


@dataclass
class StaticTransform:
    x: float
    y: float
    z: float
    roll: float
    pitch: float
    yaw: float
    frame_id: str
    child_frame_id: str


def static_transform_from_registration(
    rotation_deg: float,
    translation: tuple[float, float],
    frame_id: str = "scan_basemap",
    child_frame_id: str = "map",
) -> StaticTransform:
    return StaticTransform(
        x=round(float(translation[0]), 4),
        y=round(float(translation[1]), 4),
        z=0.0,
        roll=0.0,
        pitch=0.0,
        yaw=round(float(np.radians(rotation_deg)), 4),
        frame_id=frame_id,
        child_frame_id=child_frame_id,
    )


def build_static_transform_publisher_command(
    rotation_deg: float,
    translation: tuple[float, float],
    frame_id: str = "scan_basemap",
    child_frame_id: str = "map",
) -> str:
    """Modern ROS2 (Humble+) named-argument form of the tf2_ros CLI. The
    older positional form (`static_transform_publisher x y z yaw pitch roll
    frame_id child_frame_id`) still exists but is deprecated in favor of
    this one -- don't emit it.
    """
    t = static_transform_from_registration(rotation_deg, translation, frame_id, child_frame_id)
    return (
        "ros2 run tf2_ros static_transform_publisher "
        f"--x {t.x} --y {t.y} --z {t.z} "
        f"--roll {t.roll} --pitch {t.pitch} --yaw {t.yaw} "
        f"--frame-id {t.frame_id} --child-frame-id {t.child_frame_id}"
    )


def build_launch_py_snippet(
    rotation_deg: float,
    translation: tuple[float, float],
    frame_id: str = "scan_basemap",
    child_frame_id: str = "map",
) -> str:
    t = static_transform_from_registration(rotation_deg, translation, frame_id, child_frame_id)
    return (
        "Node(\n"
        "    package='tf2_ros',\n"
        "    executable='static_transform_publisher',\n"
        f"    name='{t.frame_id}_to_{t.child_frame_id}',\n"
        "    arguments=[\n"
        f"        '--x', '{t.x}', '--y', '{t.y}', '--z', '{t.z}',\n"
        f"        '--roll', '{t.roll}', '--pitch', '{t.pitch}', '--yaw', '{t.yaw}',\n"
        f"        '--frame-id', '{t.frame_id}', '--child-frame-id', '{t.child_frame_id}',\n"
        "    ],\n"
        "),"
    )
