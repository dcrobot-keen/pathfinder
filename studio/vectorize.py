"""Vectorize a classified base map into 2D line segments (walls) and
polygons (furniture footprints), exportable as GeoJSON -- follow-up to
floor/wall/furniture classification (PLAN.md "스튜디오 제품 방향").

Walls: rather than iteratively fitting 3D planes (studio.classify), this
rasterizes only the WALL-labeled points into a 2D binary grid and runs a
probabilistic Hough transform (cv2.HoughLinesP) on it. A wall is
fundamentally a 2D line viewed from above, and Hough finds many segments of
varying length in a single pass -- much better suited to a real building's
mix of long and short wall runs than repeated single-best-fit RANSAC, and
its output (line endpoints) is already the vector representation we want.

GeoJSON note: this uses local planar (x, y) meters as "coordinates", not
real longitude/latitude -- an established (if technically off-label) use of
the format for CAD/robot-mapping data, not a geographic map.
"""
from __future__ import annotations

from dataclasses import dataclass

import cv2
import numpy as np
from scipy import ndimage

from studio.classify import FURNITURE, WALL
from studio.rasterize import OCCUPIED, OccupancyGrid


@dataclass
class WallSegment:
    p1: tuple[float, float]
    p2: tuple[float, float]

    @property
    def length(self) -> float:
        return float(np.hypot(self.p2[0] - self.p1[0], self.p2[1] - self.p1[1]))


@dataclass
class FurnitureFootprint:
    corners: list[tuple[float, float]]  # axis-aligned bounding box, 4 corners (world x, y)
    area_m2: float


def rasterize_label_mask(
    points: np.ndarray, labels: np.ndarray, target_label: int, resolution: float = 0.05, padding: float = 0.5
) -> OccupancyGrid:
    """Rasterize only the points matching `target_label` into a binary grid
    (grid == OCCUPIED where that label was seen, UNKNOWN elsewhere) -- e.g.
    a wall-only occupancy grid, cleaner for Hough than the general
    free/occupied grid which mixes in furniture edges too.
    """
    mask = labels == target_label
    if not mask.any():
        raise ValueError(f"no points with label {target_label}")
    x, y = points[mask, 0], points[mask, 1]

    min_x, min_y = float(x.min() - padding), float(y.min() - padding)
    width = max(int(np.ceil((x.max() + padding - min_x) / resolution)), 1)
    height = max(int(np.ceil((y.max() + padding - min_y) / resolution)), 1)

    col = np.clip(((x - min_x) / resolution).astype(np.int64), 0, width - 1)
    row = np.clip(((y - min_y) / resolution).astype(np.int64), 0, height - 1)

    grid = np.full((height, width), -1, dtype=np.int8)
    grid[row, col] = OCCUPIED
    return OccupancyGrid(grid=grid, resolution=resolution, origin=(min_x, min_y))


def detect_wall_lines(
    occ: OccupancyGrid,
    min_line_length_m: float = 0.4,
    max_line_gap_m: float = 0.2,
    hough_threshold: int = 15,
) -> list[WallSegment]:
    """Probabilistic Hough transform on occ's OCCUPIED mask; returns
    world-coordinate line segments.
    """
    binary = (occ.grid == OCCUPIED).astype(np.uint8) * 255

    lines = cv2.HoughLinesP(
        binary,
        rho=1.0,
        theta=np.radians(1.0),
        threshold=hough_threshold,
        minLineLength=min_line_length_m / occ.resolution,
        maxLineGap=max_line_gap_m / occ.resolution,
    )
    if lines is None:
        return []

    segments = []
    for col1, row1, col2, row2 in lines.reshape(-1, 4):  # (N,4) or (N,1,4) depending on OpenCV version
        p1 = (occ.origin[0] + (col1 + 0.5) * occ.resolution, occ.origin[1] + (row1 + 0.5) * occ.resolution)
        p2 = (occ.origin[0] + (col2 + 0.5) * occ.resolution, occ.origin[1] + (row2 + 0.5) * occ.resolution)
        segments.append(WallSegment(p1, p2))
    return segments


def merge_collinear_segments(
    segments: list[WallSegment], angle_tolerance_deg: float = 5.0, distance_tolerance_m: float = 0.1
) -> list[WallSegment]:
    """A single physical wall band (a few cells thick, or with small gaps)
    typically produces several near-duplicate/near-parallel Hough segments.
    Group segments that share direction (within `angle_tolerance_deg`) and
    perpendicular offset (within `distance_tolerance_m`), then collapse each
    group into one segment spanning its extremes.
    """
    if not segments:
        return []

    def angle_of(seg: WallSegment) -> float:
        dx, dy = seg.p2[0] - seg.p1[0], seg.p2[1] - seg.p1[1]
        return np.degrees(np.arctan2(dy, dx)) % 180

    def perp_offset(seg: WallSegment, ref_angle_deg: float) -> float:
        ref_rad = np.radians(ref_angle_deg)
        nx, ny = -np.sin(ref_rad), np.cos(ref_rad)
        mx, my = (seg.p1[0] + seg.p2[0]) / 2, (seg.p1[1] + seg.p2[1]) / 2
        return mx * nx + my * ny

    angles = [angle_of(s) for s in segments]
    used = [False] * len(segments)
    merged: list[WallSegment] = []

    for i in range(len(segments)):
        if used[i]:
            continue
        group = [i]
        used[i] = True
        for j in range(i + 1, len(segments)):
            if used[j]:
                continue
            da = abs(angles[i] - angles[j])
            da = min(da, 180 - da)
            if da > angle_tolerance_deg:
                continue
            if abs(perp_offset(segments[i], angles[i]) - perp_offset(segments[j], angles[i])) > distance_tolerance_m:
                continue
            group.append(j)
            used[j] = True

        ref_rad = np.radians(angles[i])
        direction = np.array([np.cos(ref_rad), np.sin(ref_rad)])
        endpoints = np.array([pt for idx in group for pt in (segments[idx].p1, segments[idx].p2)])
        proj = endpoints @ direction
        merged.append(WallSegment(tuple(endpoints[proj.argmin()]), tuple(endpoints[proj.argmax()])))

    return merged


def detect_furniture_footprints(
    points: np.ndarray, labels: np.ndarray, resolution: float = 0.05, padding: float = 0.5, min_area_m2: float = 0.03
) -> list[FurnitureFootprint]:
    """Connected-component (2D, 8-connectivity) axis-aligned bounding boxes
    for FURNITURE-labeled points -- one footprint polygon per cluster.
    """
    occ = rasterize_label_mask(points, labels, FURNITURE, resolution=resolution, padding=padding)
    mask = occ.grid == OCCUPIED
    comp_labels, num = ndimage.label(mask, structure=np.ones((3, 3), bool))

    footprints = []
    for comp_id in range(1, num + 1):
        rows, cols = np.nonzero(comp_labels == comp_id)
        area_m2 = len(rows) * resolution**2
        if area_m2 < min_area_m2:
            continue
        x0 = occ.origin[0] + cols.min() * resolution
        x1 = occ.origin[0] + (cols.max() + 1) * resolution
        y0 = occ.origin[1] + rows.min() * resolution
        y1 = occ.origin[1] + (rows.max() + 1) * resolution
        footprints.append(FurnitureFootprint(corners=[(x0, y0), (x1, y0), (x1, y1), (x0, y1)], area_m2=area_m2))

    return footprints


def to_geojson(walls: list[WallSegment], furniture: list[FurnitureFootprint]) -> dict:
    features = []
    for wall in walls:
        features.append(
            {
                "type": "Feature",
                "geometry": {"type": "LineString", "coordinates": [list(wall.p1), list(wall.p2)]},
                "properties": {"category": "wall", "length_m": round(wall.length, 2)},
            }
        )
    for item in furniture:
        ring = [list(c) for c in item.corners] + [list(item.corners[0])]
        features.append(
            {
                "type": "Feature",
                "geometry": {"type": "Polygon", "coordinates": [ring]},
                "properties": {"category": "furniture", "area_m2": round(item.area_m2, 2)},
            }
        )
    return {"type": "FeatureCollection", "features": features}
