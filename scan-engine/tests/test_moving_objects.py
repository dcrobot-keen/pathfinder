"""Validation for isolated-cluster ("moving object") removal.

Uses the synthetic room fixture plus an injected "fake person" -- a small
vertical column of points standing alone in open floor space, disconnected
from the walls/table -- since real scan data has no ground truth for
whether a given isolated blob was actually a moving object or just scan
noise (see studio/moving_objects.py docstring). Run directly:
    python tests/test_moving_objects.py
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import numpy as np

from studio.moving_objects import remove_isolated_clusters
from studio.preprocess import remove_ceiling
from studio.synthetic_room import generate_room


def inject_fake_person(points: np.ndarray, position: tuple[float, float], height: float = 1.7) -> np.ndarray:
    """A thin vertical column of points, like a person standing alone in
    open floor space, disconnected from any other structure."""
    rng = np.random.default_rng(1)
    n = 300
    x, y = position
    person = np.column_stack(
        [
            x + rng.normal(0, 0.12, n),
            y + rng.normal(0, 0.12, n),
            rng.uniform(0.05, height, n),
        ]
    )
    return np.concatenate([points, person], axis=0)


def run() -> None:
    room = generate_room(width=4.0, depth=5.0, height=2.7, seed=0)
    # place the fake person in an open floor area, away from the table (at
    # room center) and away from all walls.
    room_with_person = inject_fake_person(room, position=(1.0, 4.0))

    base = remove_ceiling(room_with_person, seed=0)
    print(f"base map (with injected person): {len(base.points)} points")

    result = remove_isolated_clusters(base.points, base.colors)
    print(f"components: {result.num_components} total, {result.kept_component_count} kept")
    print(f"removed points: {result.removed_mask.sum()}")

    # The injected person should be gone: no points left near (1.0, 4.0)
    # above floor height.
    near_person = (
        (np.abs(result.points[:, 0] - 1.0) < 0.3)
        & (np.abs(result.points[:, 1] - 4.0) < 0.3)
        & (result.points[:, 2] > 0.1)
    )
    assert near_person.sum() == 0, f"expected the injected person to be fully removed, {near_person.sum()} points remain"

    # The table (large, connected, real structure) should survive.
    table_mask = (result.points[:, 2] > 0.6) & (result.points[:, 2] < 0.9)
    assert table_mask.sum() > 500, f"expected the table to survive, found {table_mask.sum()} points in its height band"

    # A generous majority of the room's real structure should be untouched.
    assert len(result.points) > 0.9 * len(base.points), "removed too much of the real structure"

    print("PASS")


if __name__ == "__main__":
    run()
