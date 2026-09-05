"""Fit a similarity transform (rotation + uniform scale + translation) from
a handful of user-picked control-point correspondences, and apply it to an
externally-sourced GeoJSON to bring it into this project's base-map frame
(PLAN.md "좌표 보정").

Why control points + similarity transform instead of ICP: `studio.registration`
does dense point-cloud ICP (rigid, no scale) because both point sets are
already real-world meters and dense enough for nearest-neighbor
correspondence to work. A GeoJSON from an outside CAD/survey tool is the
opposite: a handful of sparse vector features, in units/origin that are not
guaranteed to match ours at all (could be centimeters, an arbitrary local
survey grid, anything) -- there's no dense point cloud to run ICP against,
and a *scale* factor may be needed on top of rotation+translation. The fix
is the classic surveying/GIS approach: a human clicks 2+ matching landmarks
in both coordinate systems, and we solve for the best-fit similarity
transform (Umeyama 1991 -- the scale-inclusive generalization of the
Kabsch/Procrustes rigid fit already used in `studio.registration`).
"""
from __future__ import annotations

import copy
from dataclasses import dataclass

import numpy as np


@dataclass
class SimilarityTransform:
    scale: float
    rotation_deg: float
    translation: tuple[float, float]

    def apply(self, points: np.ndarray) -> np.ndarray:
        points = np.asarray(points, dtype=np.float64)
        theta = np.radians(self.rotation_deg)
        c, s = np.cos(theta), np.sin(theta)
        rotation = np.array([[c, -s], [s, c]])
        return self.scale * (points @ rotation.T) + np.array(self.translation)


def fit_similarity_transform(source: np.ndarray, target: np.ndarray) -> SimilarityTransform:
    """Umeyama's closed-form least-squares similarity transform: the
    rotation + uniform scale + translation minimizing
    `sum ||target_i - (scale * R @ source_i + translation)||^2`.

    Steps: center both point sets on their own centroid -> cross-covariance
    of the centered sets -> SVD of that covariance -> rotation = U @ S @ V^T,
    where S is identity except its last diagonal entry is flipped to -1 if
    `det(U) * det(V) < 0` (this rejects the degenerate case where the raw
    U @ V^T would be a *reflection* rather than a rotation -- a mirrored fit
    can have lower squared error than any true rotation for pathological
    correspondences, which we never want for a floor plan) -> scale is the
    ratio of the (sign-corrected) singular values to the source's own
    variance -> translation recenters the scaled+rotated source onto the
    target centroid.
    """
    source = np.asarray(source, dtype=np.float64)
    target = np.asarray(target, dtype=np.float64)
    if len(source) != len(target):
        raise ValueError("source and target must have the same number of points")
    if len(source) < 2:
        raise ValueError("need at least 2 point correspondences to fit a similarity transform")

    src_mean = source.mean(axis=0)
    tgt_mean = target.mean(axis=0)
    src_centered = source - src_mean
    tgt_centered = target - tgt_mean

    src_var = float(np.mean(np.sum(src_centered**2, axis=1)))
    if src_var < 1e-12:
        raise ValueError("source points are coincident -- can't determine scale/rotation from a single location")
    cov = (tgt_centered.T @ src_centered) / len(source)

    u, d, vt = np.linalg.svd(cov)
    s = np.eye(2)
    if np.linalg.det(u) * np.linalg.det(vt) < 0:
        s[-1, -1] = -1.0

    rotation = u @ s @ vt
    scale = float(np.trace(np.diag(d) @ s) / src_var)
    translation = tgt_mean - scale * (rotation @ src_mean)

    rotation_deg = float(np.degrees(np.arctan2(rotation[1, 0], rotation[0, 0])))
    return SimilarityTransform(scale=scale, rotation_deg=rotation_deg, translation=(float(translation[0]), float(translation[1])))


def residuals(transform: SimilarityTransform, source: np.ndarray, target: np.ndarray) -> np.ndarray:
    """Per-pair fit error (in target units) -- how far each correspondence
    lands from its intended target after applying `transform`. A single
    large residual usually means one control point was mis-clicked."""
    predicted = transform.apply(source)
    return np.linalg.norm(predicted - np.asarray(target, dtype=np.float64), axis=1)


def _is_leaf_coordinate(node: object) -> bool:
    return isinstance(node, list) and 2 <= len(node) <= 3 and all(isinstance(v, (int, float)) for v in node)


def _transform_coordinates(node: list, transform: SimilarityTransform) -> list:
    if _is_leaf_coordinate(node):
        x, y = transform.apply(np.array([[node[0], node[1]]]))[0]
        transformed = [float(x), float(y)]
        if len(node) == 3:
            transformed.append(node[2])  # z untouched -- this is a 2D transform
        return transformed
    return [_transform_coordinates(child, transform) for child in node]


def _transform_geometry(geometry: dict, transform: SimilarityTransform) -> None:
    if "coordinates" in geometry:
        geometry["coordinates"] = _transform_coordinates(geometry["coordinates"], transform)
    elif "geometries" in geometry:  # GeometryCollection
        for geom in geometry["geometries"]:
            _transform_geometry(geom, transform)


def transform_geojson(geojson: dict, transform: SimilarityTransform) -> dict:
    """Apply `transform` to every feature's geometry, returning a new
    FeatureCollection. Coordinate arrays are walked generically (any list
    whose leaves are [x, y] or [x, y, z] numbers gets transformed; anything
    else is a container to recurse into) rather than special-cased per
    geometry type -- Point/LineString/Polygon/Multi* all nest their
    coordinate arrays to different depths, but "is this a leaf coordinate or
    a list of children" is the same check at every depth.
    """
    result = copy.deepcopy(geojson)
    features = result["features"] if result.get("type") == "FeatureCollection" else [result]
    for feature in features:
        geometry = feature.get("geometry")
        if geometry is not None:
            _transform_geometry(geometry, transform)
    return result
