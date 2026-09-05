"""Vectorize a classified base map into GeoJSON -- follow-up to
floor/wall/furniture classification (PLAN.md "스튜디오 제품 방향").

Primary approach -- room outlines via contour tracing (`trace_room_polygons`):
rasterize ALL classified points (any label) into a binary "was this scanned"
mask and trace its boundary with `cv2.findContours` + `cv2.approxPolyDP`. A
filled-region contour is closed by construction, which is the property a
first version (assembling individual `cv2.HoughLinesP` wall line segments)
did not have -- disconnected walls and rooms with no detected walls at all
were the direct result of stitching unconnected segments together. Furniture
footprints (`detect_furniture_polygons`) use the same contour-tracing
technique per connected component, for a tighter fit than an axis-aligned
bounding box.

`detect_wall_lines` / `merge_collinear_segments` (the original Hough
approach) are kept as an optional secondary/debug output -- individual wall
line segments are still occasionally useful (e.g. length reporting) even
though they're no longer the primary shape output.

Orthogonal snapping (`rectify_orthogonal`, `dominant_angle_deg`): a real
scan's traced contour is still pixel-noisy (100+ corners on a real office).
Since almost every real building is built on a right-angle grid even when
the scan's coordinate frame is rotated relative to it, edges are classified
as horizontal/vertical in the building's dominant orientation and each
vertex is recomputed as the intersection of its two adjacent (now axis-
aligned) edges -- this both straightens the walls and collapses the pixel
noise into a small, CAD-like vertex count.

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
    corners: list[tuple[float, float]]  # simplified contour polygon, world (x, y)
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


def rasterize_interior_mask(points: np.ndarray, resolution: float = 0.05, padding: float = 0.5) -> OccupancyGrid:
    """Binary mask of every 2D column that contains ANY classified point
    (floor, wall, or furniture) -- i.e. "was this square meter scanned at
    all", regardless of label.

    This is the basis for contour-based room-outline tracing (see
    `trace_room_polygons`), which replaced the original Hough-line wall
    approach: individual line segments have no guaranteed connectivity, so
    stitching them into a closed room shape is fragile (this is exactly
    what went wrong -- disconnected walls, missing sides). The boundary of a
    filled region, by contrast, is closed by construction.
    """
    if len(points) == 0:
        raise ValueError("no points to rasterize")
    x, y = points[:, 0], points[:, 1]

    min_x, min_y = float(x.min() - padding), float(y.min() - padding)
    width = max(int(np.ceil((x.max() + padding - min_x) / resolution)), 1)
    height = max(int(np.ceil((y.max() + padding - min_y) / resolution)), 1)

    col = np.clip(((x - min_x) / resolution).astype(np.int64), 0, width - 1)
    row = np.clip(((y - min_y) / resolution).astype(np.int64), 0, height - 1)

    grid = np.full((height, width), -1, dtype=np.int8)
    grid[row, col] = OCCUPIED
    return OccupancyGrid(grid=grid, resolution=resolution, origin=(min_x, min_y))


def trace_room_polygons(
    occ: OccupancyGrid,
    min_area_m2: float = 2.0,
    simplify_epsilon_m: float = 0.35,
    close_radius_m: float = 0.3,
) -> list[list[tuple[float, float]]]:
    """Trace the outer boundary of each connected scanned region as a closed
    polygon (the room outline(s)), instead of assembling independent wall
    line segments into a closed shape.

    A morphological close bridges small scan gaps (occlusion behind
    furniture, thin unscanned strips, doorway noise) without merging
    genuinely separate rooms -- `close_radius_m` controls how big a gap gets
    bridged. `cv2.approxPolyDP` then collapses the pixel-staircase contour
    into straight edges. A multi-room building whose rooms weren't fully
    connected by the scan naturally produces multiple separate polygons
    here, which is correct (better than one polygon missing walls).
    """
    binary = (occ.grid == OCCUPIED).astype(np.uint8) * 255
    close_px = max(int(round(close_radius_m / occ.resolution)), 1)
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (close_px * 2 + 1, close_px * 2 + 1))
    closed = cv2.morphologyEx(binary, cv2.MORPH_CLOSE, kernel)

    contours, _ = cv2.findContours(closed, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    epsilon_px = simplify_epsilon_m / occ.resolution
    polygons = []
    for cnt in contours:
        area_m2 = cv2.contourArea(cnt) * occ.resolution**2
        if area_m2 < min_area_m2:
            continue
        approx = cv2.approxPolyDP(cnt, epsilon_px, True).reshape(-1, 2)
        ring = [
            (occ.origin[0] + (float(px) + 0.5) * occ.resolution, occ.origin[1] + (float(py) + 0.5) * occ.resolution)
            for px, py in approx
        ]
        polygons.append(ring)
    return polygons


def dominant_angle_deg(ring: list[tuple[float, float]], angle_bin_deg: float = 1.0) -> float:
    """Length-weighted mode of polygon edge angles, mod 90 degrees -- the
    building's principal (Manhattan) axis. Weighting by edge length makes
    this robust to a contour's many short noisy edges: a handful of long
    straight wall runs outvotes them.
    """
    pts = np.array(ring, dtype=np.float64)
    edges = np.roll(pts, -1, axis=0) - pts
    lengths = np.hypot(edges[:, 0], edges[:, 1])
    angles = np.degrees(np.arctan2(edges[:, 1], edges[:, 0])) % 90.0

    n_bins = max(int(round(90.0 / angle_bin_deg)), 1)
    bins = np.zeros(n_bins)
    idx = np.clip((angles / angle_bin_deg).astype(int), 0, n_bins - 1)
    np.add.at(bins, idx, lengths)
    return float((bins.argmax() + 0.5) * angle_bin_deg)


def rectify_orthogonal(
    ring: list[tuple[float, float]],
    angle_deg: float | None = None,
    min_edge_m: float = 0.05,
) -> list[tuple[float, float]]:
    """Snap a polygon's edges to be purely horizontal/vertical in the
    building's dominant orientation -- a Manhattan-world assumption that
    holds for essentially all office/room floor plans, even when the scan's
    coordinate frame is rotated relative to the walls.

    Each edge is classified as horizontal or vertical (whichever it's
    already closer to, in the dominant-angle frame) and replaced by a
    constant-y or constant-x line; each vertex is then recomputed as the
    *intersection* of its two adjacent edge lines. Intersecting lines close
    a loop exactly, which is why this is done edge-by-edge rather than by
    propagating an offset forward around the polygon vertex-by-vertex (a
    forward pass drifts and leaves a gap where the loop closes on itself).

    Pass a shared `angle_deg` (e.g. from the room polygon) when rectifying
    several rings from the same scan -- furniture pieces are individually
    too small/noisy for `dominant_angle_deg` to reliably recover the
    building's true orientation on their own.
    """
    pts = np.array(ring, dtype=np.float64)
    n = len(pts)
    if n < 3:
        return ring

    if angle_deg is None:
        angle_deg = dominant_angle_deg(ring)
    theta = np.radians(angle_deg)
    c, s = np.cos(theta), np.sin(theta)
    centroid = pts.mean(axis=0)

    d = pts - centroid
    local = np.column_stack([d[:, 0] * c + d[:, 1] * s, -d[:, 0] * s + d[:, 1] * c])

    edge_next = np.roll(local, -1, axis=0) - local
    is_horizontal = np.abs(edge_next[:, 0]) >= np.abs(edge_next[:, 1])
    edge_value = np.where(
        is_horizontal,
        (local[:, 1] + np.roll(local[:, 1], -1)) / 2.0,  # edge lies on constant y
        (local[:, 0] + np.roll(local[:, 0], -1)) / 2.0,  # edge lies on constant x
    )

    new_local = np.empty_like(local)
    for i in range(n):
        prev = (i - 1) % n
        h_prev, v_prev = is_horizontal[prev], edge_value[prev]
        h_cur, v_cur = is_horizontal[i], edge_value[i]
        if h_prev == h_cur:
            # degenerate: two adjacent edges share an orientation, so this
            # vertex isn't really a corner -- keep the original point rather
            # than guessing an intersection that doesn't exist.
            new_local[i] = local[i]
        elif h_prev:
            new_local[i] = (v_cur, v_prev)  # edge[prev] const y, edge[i] const x
        else:
            new_local[i] = (v_prev, v_cur)  # edge[prev] const x, edge[i] const y

    world_x = new_local[:, 0] * c - new_local[:, 1] * s + centroid[0]
    world_y = new_local[:, 0] * s + new_local[:, 1] * c + centroid[1]
    world = np.column_stack([world_x, world_y])

    # Drop near-duplicate consecutive vertices left by tiny snapped edges.
    cleaned = [tuple(world[0])]
    for p in world[1:]:
        if np.hypot(p[0] - cleaned[-1][0], p[1] - cleaned[-1][1]) >= min_edge_m:
            cleaned.append(tuple(p))
    if len(cleaned) > 1 and np.hypot(cleaned[0][0] - cleaned[-1][0], cleaned[0][1] - cleaned[-1][1]) < min_edge_m:
        cleaned.pop()

    return cleaned if len(cleaned) >= 3 else ring


def _polygon_area_m2(ring: list[tuple[float, float]]) -> float:
    """Shoelace formula."""
    pts = np.array(ring)
    x, y = pts[:, 0], pts[:, 1]
    return float(0.5 * abs(np.dot(x, np.roll(y, 1)) - np.dot(y, np.roll(x, 1))))


def detect_furniture_polygons(
    points: np.ndarray,
    labels: np.ndarray,
    resolution: float = 0.05,
    padding: float = 0.5,
    min_area_m2: float = 0.03,
    simplify_epsilon_m: float = 0.03,
) -> list[FurnitureFootprint]:
    """Per-piece footprint via contour tracing + simplification -- a tighter
    fit than an axis-aligned bounding box, and correctly separates adjacent
    furniture that a shared bbox would merge/overlap into one blob.
    """
    occ = rasterize_label_mask(points, labels, FURNITURE, resolution=resolution, padding=padding)
    binary = (occ.grid == OCCUPIED).astype(np.uint8) * 255
    contours, _ = cv2.findContours(binary, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    epsilon_px = simplify_epsilon_m / resolution
    footprints = []
    for cnt in contours:
        area_m2 = cv2.contourArea(cnt) * resolution**2
        if area_m2 < min_area_m2:
            continue
        approx = cv2.approxPolyDP(cnt, epsilon_px, True).reshape(-1, 2)
        if len(approx) < 3:
            continue
        corners = [
            (occ.origin[0] + (float(px) + 0.5) * resolution, occ.origin[1] + (float(py) + 0.5) * resolution)
            for px, py in approx
        ]
        footprints.append(FurnitureFootprint(corners=corners, area_m2=area_m2))
    return footprints


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


def to_geojson(
    walls: list[WallSegment] | None = None,
    furniture: list[FurnitureFootprint] | None = None,
    rooms: list[list[tuple[float, float]]] | None = None,
) -> dict:
    features = []
    for ring in rooms or []:
        coords = [list(p) for p in ring] + [list(ring[0])]
        features.append(
            {
                "type": "Feature",
                "geometry": {"type": "Polygon", "coordinates": [coords]},
                "properties": {"category": "room", "area_m2": round(_polygon_area_m2(ring), 2)},
            }
        )
    for wall in walls or []:
        features.append(
            {
                "type": "Feature",
                "geometry": {"type": "LineString", "coordinates": [list(wall.p1), list(wall.p2)]},
                "properties": {"category": "wall", "length_m": round(wall.length, 2)},
            }
        )
    for item in furniture or []:
        ring = [list(c) for c in item.corners] + [list(item.corners[0])]
        features.append(
            {
                "type": "Feature",
                "geometry": {"type": "Polygon", "coordinates": [ring]},
                "properties": {"category": "furniture", "area_m2": round(item.area_m2, 2)},
            }
        )
    return {"type": "FeatureCollection", "features": features}
