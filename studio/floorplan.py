"""앱(vps-system/ios-capture)이 스캔마다 내보내는 바닥 이미지 floorplan.png/json.

FloorPlanRenderer.swift(v2) 규약: 5 cm/px RGBA 톱다운 텍스처(바닥 색 + 궤적).
픽셀 (col, row) 의 ARKit 평면 좌표는
    x = origin_x     + col * res
    z = origin_top_z + row * res      (row 0 = 최소 z = 이미지 위쪽)
슬라이스 평면 (x, y) = (x, -z) 에서는 y = -(origin_top_z + row*res), 즉 이미지 위쪽이 +y —
일반 이미지 방향과 같다. 슬라이스맵(row 0 = 최소 y)과는 위아래가 반대이니 주의.

여기서 하는 일:
  - load_floorplan: 스캔 폴더에서 읽기 (format_version >= 2만)
  - FloorPlan.payload: 정합 워크스페이스가 캔버스에 겹쳐 그릴 data URL + 메타
  - composite_floorplans: group_alignment 로 각 스캔 이미지를 합쳐 merged 슬라이스맵과
    같은 격자(origin/res/cols/rows)의 한 장으로 -- publish 되어 시뮬레이터 worlds/ 옆에
    <group>.floor.png/.json 으로 놓이고, pathfinder 가 프로젝트 배경으로 깐다.
"""
from __future__ import annotations

import base64
import io
import json
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from PIL import Image

from studio.merge_slicemaps import GroupAlignment, Slice

FLOOR_FORMAT = "floor-image-v1"
FLOOR_STEM = "floor"


@dataclass
class FloorPlan:
    image: np.ndarray  # (h, w, 4) uint8 RGBA, row 0 = top = min z = max y
    resolution: float
    origin_x: float
    origin_top_z: float

    @property
    def width(self) -> int:
        return int(self.image.shape[1])

    @property
    def height(self) -> int:
        return int(self.image.shape[0])

    def extent_xy(self) -> tuple[float, float, float, float]:
        """(min_x, min_y, max_x, max_y) in the slice plane (x, y) = (x, -z)."""
        return (
            self.origin_x,
            -(self.origin_top_z + self.height * self.resolution),
            self.origin_x + self.width * self.resolution,
            -self.origin_top_z,
        )

    def to_png_bytes(self) -> bytes:
        buf = io.BytesIO()
        Image.fromarray(self.image, "RGBA").save(buf, format="PNG")
        return buf.getvalue()

    def to_data_url(self) -> str:
        return "data:image/png;base64," + base64.b64encode(self.to_png_bytes()).decode("ascii")

    def payload(self) -> dict:
        """What the alignment workspace embeds per layer."""
        return {
            "dataUrl": self.to_data_url(),
            "originX": self.origin_x,
            "originTopZ": self.origin_top_z,
            "resolution": self.resolution,
            "width": self.width,
            "height": self.height,
        }


def load_floorplan(scan_dir: Path, background_to_alpha: bool = True) -> FloorPlan | None:
    """floorplan.png + floorplan.json in a scan folder, or None when absent /
    older than format_version 2 (v1 rows ran the other way; the app rewrites
    them on its side, we don't guess here). The opaque background colour
    (sampled at pixel 0,0) becomes alpha 0 unless background_to_alpha=False."""
    png = Path(scan_dir) / "floorplan.png"
    meta_path = Path(scan_dir) / "floorplan.json"
    if not png.exists() or not meta_path.exists():
        return None
    meta = json.loads(meta_path.read_text(encoding="utf-8"))
    if int(meta.get("format_version", 1)) < 2:
        return None
    with Image.open(png) as im:
        arr = np.array(im.convert("RGBA"), dtype=np.uint8)
    if background_to_alpha:
        # The app fills everything outside the mesh with one opaque grey (205,205,205
        # today; read from the corner rather than hard-coding). Make it transparent so
        # overlays/composites show the scan underneath instead of a grey square.
        bg = arr[0, 0, :3]
        mask = (arr[..., :3] == bg).all(axis=-1)
        arr = arr.copy()
        arr[mask, 3] = 0
    res = float(meta["resolution_meters_per_pixel"])
    fp = FloorPlan(image=arr, resolution=res, origin_x=float(meta["origin_x"]), origin_top_z=float(meta["origin_top_z"]))
    if fp.width != int(meta.get("width_px", fp.width)) or fp.height != int(meta.get("height_px", fp.height)):
        raise ValueError(f"{png}: image {fp.width}x{fp.height} != floorplan.json {meta.get('width_px')}x{meta.get('height_px')}")
    return fp


def composite_floorplans(floors: dict[str, FloorPlan], ga: GroupAlignment, target: Slice) -> np.ndarray:
    """Paint every scan's floor image, placed by its ScanAlignment, onto an
    RGBA canvas with the target slice's grid (same origin/resolution/cols/rows,
    so the PNG lines up with merged.slicemap.json pixel for pixel). Returned
    array is image-oriented: row 0 = max y (top). Reference first, then the
    others 'over' it where they have alpha."""
    rows, cols, res = target.rows, target.cols, target.resolution
    canvas = np.zeros((rows, cols, 4), dtype=np.float32)  # grid orientation: row 0 = min y
    cx = target.origin[0] + (np.arange(cols) + 0.5) * res
    cy = target.origin[1] + (np.arange(rows) + 0.5) * res
    X, Y = np.meshgrid(cx, cy)  # (rows, cols)
    pts = np.column_stack([X.ravel(), Y.ravel()])

    order = [ga.reference] + [s for s in floors if s != ga.reference]
    for sid in order:
        fp = floors.get(sid)
        if fp is None:
            continue
        a = ga.get(sid)
        local = a.inverse_xy(pts)  # slice plane of this scan
        col = np.floor((local[:, 0] - fp.origin_x) / fp.resolution).astype(np.int64)
        row = np.floor((-local[:, 1] - fp.origin_top_z) / fp.resolution).astype(np.int64)
        ok = (col >= 0) & (col < fp.width) & (row >= 0) & (row < fp.height)
        if not ok.any():
            continue
        src = np.zeros((pts.shape[0], 4), dtype=np.float32)
        src[ok] = fp.image[row[ok], col[ok]].astype(np.float32)
        src = src.reshape(rows, cols, 4)
        alpha = (src[..., 3:4] / 255.0)
        canvas[..., :3] = src[..., :3] * alpha + canvas[..., :3] * (1 - alpha)
        canvas[..., 3:4] = src[..., 3:4] + canvas[..., 3:4] * (1 - alpha)

    img = np.clip(canvas, 0, 255).astype(np.uint8)
    return img[::-1]  # grid row 0 (min y) -> image bottom


def floor_meta(target: Slice, img: np.ndarray) -> dict:
    """Sidecar for a composited floor image: where it sits in the slice plane."""
    return {
        "format": FLOOR_FORMAT,
        "resolution": target.resolution,
        "origin": [target.origin[0], target.origin[1]],  # lower-left corner (slice plane), like slicemap-v1
        "width_px": int(img.shape[1]),
        "height_px": int(img.shape[0]),
        "row0": "max y (image top)",
    }


def save_floor(png_path: Path, json_path: Path, img: np.ndarray, target: Slice) -> tuple[Path, Path]:
    Image.fromarray(img, "RGBA").save(png_path, format="PNG")
    json_path.write_text(json.dumps(floor_meta(target, img), indent=2), encoding="utf-8")
    return png_path, json_path
