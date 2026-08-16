"""Validation for image georeferencing (studio/image_align.py): the
pixel-row-negation fix for the pixel-Y-down vs world-Y-up axis flip, and the
ESRI world-file coefficient derivation. Run directly:
    python tests/test_image_align.py
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import numpy as np

from studio.image_align import fit_pixel_to_world_transform, world_file_extension, world_file_lines, write_world_file

TRUE_SCALE = 0.05  # world-units per pixel
TRUE_ROTATION_DEG = 8.0
TRUE_TRANSLATION = (10.0, 20.0)  # world position of pixel (0, 0)'s center


def _true_pixel_to_world(pixel_points: np.ndarray) -> np.ndarray:
    """Ground truth: world = scale * R(theta) @ (col, -row) + translation --
    the row negation models a normal (non-mirrored) image, where row
    increases downward but world-y increases upward."""
    theta = np.radians(TRUE_ROTATION_DEG)
    c, s = np.cos(theta), np.sin(theta)
    rotation = np.array([[c, -s], [s, c]])
    flipped = pixel_points.copy().astype(np.float64)
    flipped[:, 1] = -flipped[:, 1]
    return TRUE_SCALE * (flipped @ rotation.T) + np.array(TRUE_TRANSLATION)


def run() -> None:
    # -- recover a known rotated + scaled pixel-to-world mapping --
    pixel_points = np.array([[0, 0], [200, 0], [0, 150], [123, 47]], dtype=float)
    world_points = _true_pixel_to_world(pixel_points)

    fit = fit_pixel_to_world_transform(pixel_points, world_points)
    print(f"fit: scale={fit.scale:.6f} rotation_deg={fit.rotation_deg:.6f} translation={fit.translation}")
    assert abs(fit.scale - TRUE_SCALE) < 1e-9, f"scale off: {fit.scale}"
    assert abs(fit.rotation_deg - TRUE_ROTATION_DEG) < 1e-6, f"rotation off: {fit.rotation_deg}"
    assert abs(fit.translation[0] - TRUE_TRANSLATION[0]) < 1e-6
    assert abs(fit.translation[1] - TRUE_TRANSLATION[1]) < 1e-6

    # -- theta=0 sign check: this is the check that would catch a flipped
    # sign in the world-file derivation -- a non-rotated image must have a
    # POSITIVE x pixel size and a NEGATIVE y pixel size (row-down vs y-up). --
    zero_rot_pixels = np.array([[0, 0], [10, 0], [0, 10]], dtype=float)
    zero_rot_world = np.array([[100.0, 200.0], [100.0 + 10 * 2.0, 200.0], [100.0, 200.0 - 10 * 2.0]])
    fit0 = fit_pixel_to_world_transform(zero_rot_pixels, zero_rot_world)
    print(f"theta=0 fit: scale={fit0.scale:.6f} rotation_deg={fit0.rotation_deg:.2e}")
    assert abs(fit0.rotation_deg) < 1e-6
    assert abs(fit0.scale - 2.0) < 1e-9

    a, d, b, e, c, f = world_file_lines(fit0)
    print(f"theta=0 world file: A={a:.6f} D={d:.6f} B={b:.6f} E={e:.6f} C={c:.6f} F={f:.6f}")
    assert abs(a - 2.0) < 1e-9, f"A (x pixel size) should be +scale, got {a}"
    assert abs(d) < 1e-9, f"D should be ~0 for a non-rotated image, got {d}"
    assert abs(b) < 1e-9, f"B should be ~0 for a non-rotated image, got {b}"
    assert abs(e - (-2.0)) < 1e-9, f"E (y pixel size) should be -scale (row-down vs y-up), got {e}"
    assert abs(c - 100.0) < 1e-9 and abs(f - 200.0) < 1e-9

    # -- rotated case: A/B/D/E derivation matches world_x = A*col + B*row + C, world_y = D*col + E*row + F --
    a, d, b, e, c, f = world_file_lines(fit)
    for col, row in [(0, 0), (200, 0), (0, 150), (57, 91)]:
        wx = a * col + b * row + c
        wy = d * col + e * row + f
        [expected] = _true_pixel_to_world(np.array([[col, row]]))
        assert abs(wx - expected[0]) < 1e-6, f"world_x mismatch at ({col},{row}): {wx} vs {expected[0]}"
        assert abs(wy - expected[1]) < 1e-6, f"world_y mismatch at ({col},{row}): {wy} vs {expected[1]}"

    # -- world file I/O --
    import tempfile

    with tempfile.TemporaryDirectory() as tmp:
        path = write_world_file(Path(tmp) / "test.pgw", fit)
        lines = path.read_text(encoding="ascii").strip().splitlines()
        assert len(lines) == 6, f"world file must have exactly 6 lines, got {len(lines)}"
        assert abs(float(lines[0]) - a) < 1e-6

    assert world_file_extension("scan.png") == ".pgw"
    assert world_file_extension("scan.JPG") == ".jgw"
    assert world_file_extension("scan.tif") == ".tfw"
    assert world_file_extension("scan.tiff") == ".tfw"
    assert world_file_extension("scan.bmp") == ".bpw"
    assert world_file_extension("scan.weirdext") == ".wld"

    print("PASS")


if __name__ == "__main__":
    run()
