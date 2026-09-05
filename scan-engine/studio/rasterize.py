"""2D occupancy-grid rasterization of a (ceiling/floor-cleaned) base map point
cloud, in ROS/nav2 map_server format (PLAN.md section 3.3).

Convention (matches nav_msgs/OccupancyGrid + map_server pgm/yaml):
- cell value 0   = free (floor visible there -> line of sight reached the floor)
- cell value 100 = occupied (an obstacle point exists in that column)
- cell value -1  = unknown (never scanned)

Occupied takes priority over free when both are present in the same cell,
since an obstacle blocks the cell for navigation regardless of floor visibility.
"""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import numpy as np

UNKNOWN = -1
FREE = 0
OCCUPIED = 100


@dataclass
class OccupancyGrid:
    grid: np.ndarray  # (H, W) int8, values in {UNKNOWN, FREE, OCCUPIED}; grid[0] is the row at min y
    resolution: float  # meters per cell
    origin: tuple[float, float]  # world (x, y) of the lower-left corner of grid[0, 0]


def rasterize_occupancy_grid(
    points: np.ndarray,
    resolution: float = 0.05,
    obstacle_min_height: float = 0.08,
    padding: float = 0.5,
) -> OccupancyGrid:
    """Project a floor-normalized point cloud (z=0 at floor) down into a 2D
    occupancy grid.

    - Points with z <= obstacle_min_height are treated as floor (mark free).
    - Points with z > obstacle_min_height are treated as obstacles anywhere in
      their column (full-height projection: conservative, matches "can a robot
      pass through this (x, y) column at all" rather than a single sensor-height
      slice).
    """
    if len(points) == 0:
        raise ValueError("no points to rasterize")

    x, y, z = points[:, 0], points[:, 1], points[:, 2]

    min_x, min_y = x.min() - padding, y.min() - padding
    max_x, max_y = x.max() + padding, y.max() + padding
    width = max(int(np.ceil((max_x - min_x) / resolution)), 1)
    height = max(int(np.ceil((max_y - min_y) / resolution)), 1)

    col = np.clip(((x - min_x) / resolution).astype(np.int64), 0, width - 1)
    row = np.clip(((y - min_y) / resolution).astype(np.int64), 0, height - 1)

    floor_mask = z <= obstacle_min_height
    obstacle_mask = ~floor_mask

    free_cells = np.zeros((height, width), dtype=bool)
    occupied_cells = np.zeros((height, width), dtype=bool)
    free_cells[row[floor_mask], col[floor_mask]] = True
    occupied_cells[row[obstacle_mask], col[obstacle_mask]] = True

    grid = np.full((height, width), UNKNOWN, dtype=np.int8)
    grid[free_cells] = FREE
    grid[occupied_cells] = OCCUPIED  # obstacles override free

    return OccupancyGrid(grid=grid, resolution=resolution, origin=(float(min_x), float(min_y)))


@dataclass
class ColorTopDown:
    image: np.ndarray  # (H, W, 3) uint8; image[0] is the row at min y (matches OccupancyGrid.grid)
    resolution: float
    origin: tuple[float, float]


def rasterize_color_topdown(
    points: np.ndarray,
    colors: np.ndarray,
    resolution: float = 0.05,
    padding: float = 0.5,
    grid_shape: tuple[int, int] | None = None,
    origin: tuple[float, float] | None = None,
    background: tuple[int, int, int] = (255, 255, 255),
) -> ColorTopDown:
    """Render a top-down (orthographic, looking straight down) colored image
    of the point cloud, for a photo-like floor plan instead of the plain
    free/occupied/unknown occupancy grid.

    Each cell shows the color of its HIGHEST point rather than an average --
    averaging would blend a desk's color with the floor beneath it into a
    muddy mess; taking the top point is what you'd actually see looking
    straight down.

    Pass `origin`/`grid_shape` from an already-computed OccupancyGrid (see
    rasterize_occupancy_grid) to align this image pixel-for-pixel with it.
    """
    if len(points) != len(colors):
        raise ValueError("points and colors must be the same length")

    x, y, z = points[:, 0], points[:, 1], points[:, 2]

    if origin is None or grid_shape is None:
        min_x, min_y = float(x.min() - padding), float(y.min() - padding)
        width = max(int(np.ceil((x.max() + padding - min_x) / resolution)), 1)
        height = max(int(np.ceil((y.max() + padding - min_y) / resolution)), 1)
    else:
        min_x, min_y = origin
        height, width = grid_shape

    col = np.clip(((x - min_x) / resolution).astype(np.int64), 0, width - 1)
    row = np.clip(((y - min_y) / resolution).astype(np.int64), 0, height - 1)

    # Sort ascending by height: numpy fancy-index assignment keeps the LAST
    # write per duplicate (row, col) pair, so this leaves each cell holding
    # its highest point's color.
    order = np.argsort(z)
    image = np.full((height, width, 3), background, dtype=np.uint8)
    image[row[order], col[order]] = colors[order, :3]

    return ColorTopDown(image=image, resolution=resolution, origin=(float(min_x), float(min_y)))


def save_color_topdown_png(path: str | Path, color_topdown: ColorTopDown) -> Path:
    """Save a ColorTopDown as a PNG, row-flipped to match save_occupancy_grid_pgm
    (image row 0 = max y)."""
    from PIL import Image

    path = Path(path)
    Image.fromarray(np.flipud(color_topdown.image)).save(path)
    return path


def cell_centers_world(occ: OccupancyGrid, value: int) -> np.ndarray:
    """World-coordinate (x, y) centers of all cells matching `value`
    (FREE/OCCUPIED/UNKNOWN), e.g. for feeding into registration (studio.registration)."""
    rows, cols = np.nonzero(occ.grid == value)
    x = occ.origin[0] + (cols + 0.5) * occ.resolution
    y = occ.origin[1] + (rows + 0.5) * occ.resolution
    return np.column_stack([x, y])


def save_occupancy_grid_pgm(path_prefix: str | Path, occ: OccupancyGrid) -> tuple[Path, Path]:
    """Write a ROS map_server-compatible .pgm + .yaml pair.

    Pixel convention: 254 (white) = free, 0 (black) = occupied, 205 (gray) = unknown.
    Image row 0 is the top of the image (max y); occ.grid row 0 is min y, so the
    array is flipped vertically when writing.
    """
    path_prefix = Path(path_prefix)
    pgm_path = path_prefix.with_suffix(".pgm")
    yaml_path = path_prefix.with_suffix(".yaml")

    pixel = np.full(occ.grid.shape, 205, dtype=np.uint8)
    pixel[occ.grid == FREE] = 254
    pixel[occ.grid == OCCUPIED] = 0
    image = np.flipud(pixel)  # image row 0 = max y

    height, width = image.shape
    with open(pgm_path, "wb") as f:
        f.write(f"P5\n{width} {height}\n255\n".encode("ascii"))
        f.write(image.tobytes())

    yaml_content = (
        f"image: {pgm_path.name}\n"
        f"resolution: {occ.resolution}\n"
        f"origin: [{occ.origin[0]}, {occ.origin[1]}, 0.0]\n"
        f"negate: 0\n"
        f"occupied_thresh: 0.65\n"
        f"free_thresh: 0.196\n"
    )
    yaml_path.write_text(yaml_content, encoding="ascii")

    return pgm_path, yaml_path


def save_occupancy_preview_png(path: str | Path, occ: OccupancyGrid) -> Path:
    """Save a free(white)/occupied(black)/unknown(gray) PNG preview of an
    OccupancyGrid -- a quick-look image, distinct from the .pgm/.yaml pair
    (that's the machine-readable nav2 format; this is for a browser/report).
    """
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    path = Path(path)
    rgb = np.zeros((*occ.grid.shape, 3), dtype=np.uint8)
    rgb[occ.grid == FREE] = (255, 255, 255)
    rgb[occ.grid == OCCUPIED] = (0, 0, 0)
    rgb[occ.grid == UNKNOWN] = (128, 128, 128)
    plt.imsave(path, np.flipud(rgb))
    return path


def _parse_map_yaml(yaml_path: Path) -> dict[str, str]:
    """Minimal, tolerant parser for ROS map_server-style YAML: plain
    `key: value` lines, `#` comments (whole-line or trailing), any key/value
    ordering, extra unrecognized keys (e.g. nav2's `mode: trinary`) ignored.
    Avoids requiring a real YAML library since this file format is always
    this simple in practice.
    """
    values: dict[str, str] = {}
    for raw_line in yaml_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.split("#", 1)[0].strip()
        if not line or ":" not in line:
            continue
        key, _, value = line.partition(":")
        values[key.strip()] = value.strip()
    return values


def _read_pgm_header_tokens(f, count: int) -> list[bytes]:
    """Read `count` whitespace-separated header tokens from a PGM file,
    skipping `#`-prefixed comment lines (allowed anywhere in a PGM header
    per the netpbm spec, and used by some map_server variants)."""
    tokens: list[bytes] = []
    buf = b""
    while len(tokens) < count:
        byte = f.read(1)
        if not byte:
            raise ValueError("unexpected end of file while reading PGM header")
        if byte in b" \t\r\n":
            if buf:
                if not buf.startswith(b"#"):
                    tokens.append(buf)
                buf = b""
        elif byte == b"#" and not buf:
            f.readline()  # skip the rest of the comment line
        else:
            buf += byte
    return tokens


def load_occupancy_grid_pgm(path_prefix: str | Path) -> OccupancyGrid:
    """Read back a .pgm + .yaml pair written by save_occupancy_grid_pgm, or a
    real ROS/nav2 map_server export (`ros2 run nav2_map_server map_saver_cli`).
    """
    path_prefix = Path(path_prefix)
    pgm_path = path_prefix.with_suffix(".pgm")
    yaml_path = path_prefix.with_suffix(".yaml")

    yaml_values = _parse_map_yaml(yaml_path)

    resolution = float(yaml_values["resolution"])
    origin = yaml_values["origin"].strip("[]").split(",")
    origin_xy = (float(origin[0]), float(origin[1]))
    negate = yaml_values.get("negate", "0").strip().lower() in ("1", "true")

    with open(pgm_path, "rb") as f:
        magic, width_tok, height_tok, maxval_tok = _read_pgm_header_tokens(f, 4)
        if magic != b"P5":
            raise ValueError(f"unsupported PGM magic number: {magic!r}")
        width, height = int(width_tok), int(height_tok)
        maxval = int(maxval_tok)
        raw = f.read(width * height * (2 if maxval > 255 else 1))
        dtype = ">u2" if maxval > 255 else "u1"
        image = np.frombuffer(raw, dtype=dtype).reshape(height, width)
        if maxval > 255:
            image = (image.astype(np.float64) * 255 / maxval).astype(np.uint8)

    if negate:
        image = 255 - image

    pixel = np.flipud(image)  # undo the row-0-is-max-y flip from saving
    grid = np.full(pixel.shape, UNKNOWN, dtype=np.int8)
    grid[pixel >= 250] = FREE
    grid[pixel <= 5] = OCCUPIED

    return OccupancyGrid(grid=grid, resolution=resolution, origin=origin_xy)
