"""Validation for the ROS static-tf export (studio/tf_export.py). Run
directly: python tests/test_tf_export.py
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import numpy as np

from studio.tf_export import (
    build_launch_py_snippet,
    build_static_transform_publisher_command,
    static_transform_from_registration,
)


def run() -> None:
    t = static_transform_from_registration(rotation_deg=90.0, translation=(1.8639, -0.1167))
    print(f"x={t.x} y={t.y} yaw={t.yaw} frame_id={t.frame_id} child_frame_id={t.child_frame_id}")
    assert abs(t.yaw - np.pi / 2) < 1e-3, f"expected yaw ~= pi/2 for 90deg, got {t.yaw}"
    assert t.x == 1.8639 and t.y == -0.1167
    assert t.z == 0.0 and t.roll == 0.0 and t.pitch == 0.0
    assert t.frame_id == "scan_basemap" and t.child_frame_id == "map"

    command = build_static_transform_publisher_command(90.0, (1.8639, -0.1167))
    print(command)
    assert command.startswith("ros2 run tf2_ros static_transform_publisher")
    assert "--frame-id scan_basemap" in command
    assert "--child-frame-id map" in command
    assert "--x 1.8639" in command
    assert "--y -0.1167" in command
    assert f"--yaw {t.yaw}" in command

    custom = build_static_transform_publisher_command(0.0, (0.0, 0.0), frame_id="scan_office", child_frame_id="robot_map")
    assert "--frame-id scan_office" in custom
    assert "--child-frame-id robot_map" in custom
    assert "--yaw 0.0" in custom

    snippet = build_launch_py_snippet(90.0, (1.8639, -0.1167))
    print(snippet)
    assert "package='tf2_ros'" in snippet
    assert "executable='static_transform_publisher'" in snippet
    assert "'--frame-id', 'scan_basemap'" in snippet
    assert "'--child-frame-id', 'map'" in snippet
    assert f"'--yaw', '{t.yaw}'" in snippet

    print("PASS")


if __name__ == "__main__":
    run()
