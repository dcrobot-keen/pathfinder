"""Robot trajectory (time-stamped 2D pose) data model, for the overlay
playback viewer (PLAN.md section 3.4). No real robot trajectory exists yet
(PLAN.md section 6 -- robot map data not available until the on-site visit),
so this also provides a synthetic generator for building/testing the viewer.
"""
from __future__ import annotations

import json
from dataclasses import asdict, dataclass
from pathlib import Path

import numpy as np


@dataclass
class Pose:
    t: float  # seconds since trajectory start
    x: float  # meters, base map world frame
    y: float
    theta: float  # radians, 0 = +x axis


def save_trajectory(path: str | Path, poses: list[Pose]) -> None:
    Path(path).write_text(json.dumps([asdict(p) for p in poses], indent=2), encoding="utf-8")


def load_trajectory(path: str | Path) -> list[Pose]:
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    return [Pose(**entry) for entry in data]


def generate_lawnmower_trajectory(
    x_range: tuple[float, float],
    y_range: tuple[float, float],
    row_spacing: float = 0.5,
    speed: float = 0.5,
    points_per_meter: float = 2.0,
) -> list[Pose]:
    """A simple back-and-forth "lawnmower" coverage path across a rectangular
    area, as a stand-in for a real robot patrol/coverage trajectory.
    """
    x0, x1 = x_range
    y0, y1 = y_range
    rows = np.arange(y0, y1 + 1e-9, row_spacing)

    waypoints: list[tuple[float, float]] = []
    for i, y in enumerate(rows):
        row_x = [x0, x1] if i % 2 == 0 else [x1, x0]
        waypoints.append((row_x[0], y))
        waypoints.append((row_x[1], y))

    poses: list[Pose] = []
    t = 0.0
    for i in range(len(waypoints) - 1):
        x_a, y_a = waypoints[i]
        x_b, y_b = waypoints[i + 1]
        segment_len = float(np.hypot(x_b - x_a, y_b - y_a))
        if segment_len < 1e-9:
            continue
        theta = float(np.arctan2(y_b - y_a, x_b - x_a))
        n_steps = max(int(segment_len * points_per_meter), 1)
        for s in range(n_steps):
            frac = s / n_steps
            x = x_a + (x_b - x_a) * frac
            y = y_a + (y_b - y_a) * frac
            poses.append(Pose(t=t, x=x, y=y, theta=theta))
            t += (segment_len / n_steps) / speed

    x_last, y_last = waypoints[-1]
    poses.append(Pose(t=t, x=x_last, y=y_last, theta=poses[-1].theta if poses else 0.0))
    return poses
