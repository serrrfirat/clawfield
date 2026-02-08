#!/usr/bin/env python3
"""
Generate a Shoreline MVP .vox map using the local MagicaVoxel MCP voxel utilities.

The generator builds a single 192x192x160 model with PRD-inspired features:
- Coastal harbor + beach flank route
- Waterfront town buildings (multi-floor)
- Main road and under-road tunnel
- Elevated bridge connecting hill sides
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MCP_UTILS = ROOT / 'tools' / 'magicavoxel-mcp'
sys.path.insert(0, str(MCP_UTILS))

from vox_utils import VoxelModel, write_vox_file  # type: ignore

SIZE_X = 192
SIZE_Y = 192
SIZE_Z = 160
ORIGIN_X = SIZE_X // 2
ORIGIN_Y = SIZE_Y // 2
GROUND_Z = SIZE_Z // 2

COL_SAND = 1
COL_GRASS = 2
COL_ROCK = 3
COL_WALL = 4
COL_ROOF = 5
COL_ROAD = 6
COL_WOOD = 7
COL_DIRT = 8
COL_CONCRETE = 9

PALETTE = {
    COL_SAND: (218, 198, 145, 255),
    COL_GRASS: (90, 146, 70, 255),
    COL_ROCK: (114, 116, 124, 255),
    COL_WALL: (198, 192, 180, 255),
    COL_ROOF: (120, 84, 74, 255),
    COL_ROAD: (63, 63, 67, 255),
    COL_WOOD: (151, 110, 66, 255),
    COL_DIRT: (132, 101, 73, 255),
    COL_CONCRETE: (164, 168, 172, 255),
}


def game_to_vox(gx: int, gy: int, gz: int) -> tuple[int, int, int]:
    """Convert game coordinates to .vox coordinates used by the converter."""
    vx = gx + ORIGIN_X
    vy = gz + ORIGIN_Y
    vz = GROUND_Z - gy
    return vx, vy, vz


def in_bounds(vx: int, vy: int, vz: int) -> bool:
    return 0 <= vx < SIZE_X and 0 <= vy < SIZE_Y and 0 <= vz < SIZE_Z


def set_game_voxel(model: VoxelModel, gx: int, gy: int, gz: int, color: int) -> None:
    vx, vy, vz = game_to_vox(gx, gy, gz)
    if in_bounds(vx, vy, vz):
        model.set_voxel(vx, vy, vz, color)


def clear_game_voxel(model: VoxelModel, gx: int, gy: int, gz: int) -> None:
    vx, vy, vz = game_to_vox(gx, gy, gz)
    if in_bounds(vx, vy, vz):
        model.remove_voxel(vx, vy, vz)


def fill_box_game(
    model: VoxelModel,
    x1: int,
    y1: int,
    z1: int,
    x2: int,
    y2: int,
    z2: int,
    color: int,
) -> None:
    min_x, max_x = sorted((x1, x2))
    min_y, max_y = sorted((y1, y2))
    min_z, max_z = sorted((z1, z2))
    for gx in range(min_x, max_x + 1):
        for gy in range(min_y, max_y + 1):
            for gz in range(min_z, max_z + 1):
                set_game_voxel(model, gx, gy, gz, color)


def clear_box_game(
    model: VoxelModel,
    x1: int,
    y1: int,
    z1: int,
    x2: int,
    y2: int,
    z2: int,
) -> None:
    min_x, max_x = sorted((x1, x2))
    min_y, max_y = sorted((y1, y2))
    min_z, max_z = sorted((z1, z2))
    for gx in range(min_x, max_x + 1):
        for gy in range(min_y, max_y + 1):
            for gz in range(min_z, max_z + 1):
                clear_game_voxel(model, gx, gy, gz)


def flatten_patch(
    model: VoxelModel,
    x1: int,
    x2: int,
    z1: int,
    z2: int,
    target_y: int,
    top_color: int,
    sub_color: int,
    clearance: int,
) -> None:
    min_x, max_x = sorted((x1, x2))
    min_z, max_z = sorted((z1, z2))

    for gx in range(min_x, max_x + 1):
        for gz in range(min_z, max_z + 1):
            for gy in range(target_y + 1, target_y + clearance + 1):
                clear_game_voxel(model, gx, gy, gz)

            for gy in range(-10, target_y):
                set_game_voxel(model, gx, gy, gz, sub_color)

            set_game_voxel(model, gx, target_y, gz, top_color)


def add_hill(model: VoxelModel, cx: int, cz: int, radius: int, peak_height: int) -> None:
    for gx in range(cx - radius, cx + radius + 1):
        for gz in range(cz - radius, cz + radius + 1):
            dist = math.sqrt((gx - cx) ** 2 + (gz - cz) ** 2)
            if dist > radius:
                continue

            local_peak = peak_height - int((dist / radius) * peak_height)
            if local_peak <= 0:
                continue

            for gy in range(2, 2 + local_peak):
                set_game_voxel(model, gx, gy, gz, COL_ROCK if gy > 6 else COL_DIRT)


def add_building(
    model: VoxelModel,
    center_x: int,
    center_z: int,
    width: int,
    depth: int,
    floors: int,
) -> None:
    base_y = 2
    floor_height = 4
    height = floors * floor_height

    x1 = center_x - width // 2
    x2 = x1 + width - 1
    z1 = center_z - depth // 2
    z2 = z1 + depth - 1

    # Building shell, floors, and roof.
    for gx in range(x1, x2 + 1):
        for gz in range(z1, z2 + 1):
            for gy in range(base_y, base_y + height + 1):
                is_wall = gx in (x1, x2) or gz in (z1, z2)
                is_floor = (gy - base_y) % floor_height == 0
                is_roof = gy == base_y + height

                if is_roof:
                    set_game_voxel(model, gx, gy, gz, COL_ROOF)
                elif is_floor:
                    set_game_voxel(model, gx, gy, gz, COL_WALL)
                elif is_wall:
                    set_game_voxel(model, gx, gy, gz, COL_WALL)

    # Hollow interior.
    clear_box_game(model, x1 + 1, base_y + 1, z1 + 1, x2 - 1, base_y + height - 1, z2 - 1)

    # Door opening on the west face.
    door_z = center_z
    clear_box_game(model, x1, base_y + 1, door_z - 1, x1, base_y + 3, door_z + 1)

    # Window strips on every upper floor.
    for floor in range(1, floors):
        window_y = base_y + floor * floor_height + 1
        clear_box_game(model, x1 + 2, window_y, z1, x2 - 2, window_y + 1, z1)
        clear_box_game(model, x1 + 2, window_y, z2, x2 - 2, window_y + 1, z2)


def build_terrain(model: VoxelModel) -> None:
    for gx in range(-94, 95):
        for gz in range(-94, 95):
            noise = int(
                round(
                    math.sin((gx + 13) * 0.11) * 1.2
                    + math.cos((gz - 7) * 0.09) * 1.1
                )
            )

            if gx < -62:
                surface = -2 + noise // 2
                top_color = COL_SAND
            elif gx < -25:
                surface = -1 + noise // 2
                top_color = COL_SAND if gx < -40 else COL_GRASS
            elif gx < 48:
                surface = 1 + noise // 2
                top_color = COL_GRASS
            else:
                slope = min(11, max(0, (gx - 48) // 5))
                surface = 2 + slope + noise // 2
                top_color = COL_ROCK if surface >= 8 else COL_GRASS

            for gy in range(-10, surface):
                fill_color = COL_ROCK if gy < surface - 3 else COL_DIRT
                set_game_voxel(model, gx, gy, gz, fill_color)

            set_game_voxel(model, gx, surface, gz, top_color)


def build_features(model: VoxelModel) -> None:
    # Harbor and paved waterfront.
    flatten_patch(
        model,
        x1=-68,
        x2=-18,
        z1=-44,
        z2=44,
        target_y=1,
        top_color=COL_CONCRETE,
        sub_color=COL_ROCK,
        clearance=8,
    )

    # Beach flank route (open, low, sandy).
    flatten_patch(
        model,
        x1=-94,
        x2=-72,
        z1=-92,
        z2=92,
        target_y=-1,
        top_color=COL_SAND,
        sub_color=COL_SAND,
        clearance=6,
    )

    # Main road through town and hill side.
    flatten_patch(
        model,
        x1=-18,
        x2=86,
        z1=-5,
        z2=5,
        target_y=2,
        top_color=COL_ROAD,
        sub_color=COL_ROCK,
        clearance=10,
    )

    # Beach-to-town crossover ramps for lane rotation.
    flatten_patch(
        model,
        x1=-60,
        x2=-34,
        z1=-52,
        z2=-36,
        target_y=1,
        top_color=COL_SAND,
        sub_color=COL_DIRT,
        clearance=7,
    )
    flatten_patch(
        model,
        x1=-60,
        x2=-34,
        z1=36,
        z2=52,
        target_y=1,
        top_color=COL_SAND,
        sub_color=COL_DIRT,
        clearance=7,
    )

    # Harbor piers.
    for pz in (-32, -14, 4, 22):
        fill_box_game(model, -84, 1, pz, -62, 2, pz + 6, COL_WOOD)
        for px in (-84, -76, -68, -62):
            fill_box_game(model, px, -2, pz, px, 1, pz, COL_WOOD)
            fill_box_game(model, px, -2, pz + 6, px, 1, pz + 6, COL_WOOD)

    # Hills framing bridge ends.
    add_hill(model, 8, 60, radius=22, peak_height=12)
    add_hill(model, 90, 60, radius=20, peak_height=13)

    # Elevated bridge between hills.
    clear_box_game(model, 18, 3, 55, 88, 12, 65)
    fill_box_game(model, 16, 8, 56, 90, 8, 64, COL_WOOD)
    fill_box_game(model, 16, 9, 56, 90, 10, 56, COL_WALL)
    fill_box_game(model, 16, 9, 64, 90, 10, 64, COL_WALL)
    fill_box_game(model, 16, 2, 57, 20, 11, 63, COL_ROCK)
    fill_box_game(model, 86, 2, 57, 90, 11, 63, COL_ROCK)

    # Tunnel under the road through eastern high ground.
    clear_box_game(model, 30, -2, -3, 86, 2, 3)
    fill_box_game(model, 30, -2, -4, 86, 2, -4, COL_WALL)
    fill_box_game(model, 30, -2, 4, 86, 2, 4, COL_WALL)
    fill_box_game(model, 30, -3, -4, 86, -3, 4, COL_WALL)
    fill_box_game(model, 30, 3, -4, 86, 3, 4, COL_WALL)

    # Tunnel ramps/entries.
    for step in range(10):
        gy = 2 - step // 3
        fill_box_game(model, 20 + step, gy, -2, 20 + step, gy, 2, COL_ROAD)
        fill_box_game(model, 96 - step, gy, -2, 96 - step, gy, 2, COL_ROAD)

    # Mid-lane hard cover to break long road sightlines.
    for cx in (-12, 4, 20, 36, 52, 68):
        fill_box_game(model, cx, 3, -2, cx + 2, 5, 2, COL_CONCRETE)
        fill_box_game(model, cx + 1, 6, -1, cx + 1, 6, 1, COL_WALL)

    # Beach cover clusters to reduce spawn-to-spawn chip damage.
    for cz in range(-72, 73, 18):
        fill_box_game(model, -83, 0, cz - 3, -79, 2, cz + 3, COL_SAND)
        fill_box_game(model, -77, 0, cz - 2, -75, 1, cz + 2, COL_WOOD)

    # Waterfront + town buildings (multi-story mix).
    building_specs = [
        (-2, -44, 16, 12, 3),
        (20, -46, 14, 10, 2),
        (40, -36, 14, 12, 3),
        (-6, 26, 14, 12, 2),
        (24, 28, 16, 12, 3),
        (48, 18, 12, 10, 2),
        (-36, 22, 18, 14, 2),
        (-28, -16, 20, 12, 2),
    ]
    for cx, cz, width, depth, floors in building_specs:
        add_building(model, cx, cz, width, depth, floors)

    # Spawn pads.
    fill_box_game(model, -92, 2, -24, -84, 2, -16, COL_CONCRETE)
    fill_box_game(model, -92, 2, 16, -84, 2, 24, COL_CONCRETE)
    fill_box_game(model, 84, 6, -20, 92, 6, -12, COL_CONCRETE)
    fill_box_game(model, 84, 6, 12, 92, 6, 20, COL_CONCRETE)

    # Alpha spawn compound (west) with 3 exits.
    fill_box_game(model, -96, 2, -30, -78, 8, -30, COL_WALL)
    fill_box_game(model, -96, 2, 30, -78, 8, 30, COL_WALL)
    fill_box_game(model, -96, 2, -30, -96, 8, 30, COL_WALL)
    fill_box_game(model, -78, 2, -30, -78, 8, 30, COL_WALL)
    clear_box_game(model, -78, 2, -4, -78, 5, 4)      # main east gate
    clear_box_game(model, -90, 2, -30, -86, 5, -30)   # south gate
    clear_box_game(model, -90, 2, 30, -86, 5, 30)     # north gate
    fill_box_game(model, -94, 3, -26, -92, 5, -24, COL_WOOD)
    fill_box_game(model, -94, 3, 24, -92, 5, 26, COL_WOOD)

    # Bravo spawn compound (east hill) with mirrored exits.
    fill_box_game(model, 78, 6, -28, 96, 12, -28, COL_WALL)
    fill_box_game(model, 78, 6, 28, 96, 12, 28, COL_WALL)
    fill_box_game(model, 96, 6, -28, 96, 12, 28, COL_WALL)
    fill_box_game(model, 78, 6, -28, 78, 12, 28, COL_WALL)
    clear_box_game(model, 78, 6, -4, 78, 10, 4)       # main west gate
    clear_box_game(model, 84, 6, -28, 88, 10, -28)    # south gate
    clear_box_game(model, 84, 6, 28, 88, 10, 28)      # north gate
    fill_box_game(model, 92, 7, -24, 94, 9, -22, COL_WOOD)
    fill_box_game(model, 92, 7, 22, 94, 9, 24, COL_WOOD)


def main() -> None:
    model = VoxelModel(SIZE_X, SIZE_Y, SIZE_Z)

    for idx, rgba in PALETTE.items():
        model.set_palette_color(idx, rgba[0], rgba[1], rgba[2], rgba[3])

    print('Generating Shoreline terrain...')
    build_terrain(model)
    print('Adding Shoreline landmarks...')
    build_features(model)

    output_path = ROOT / 'assets' / 'vox' / 'shoreline_mvp.vox'
    output_path.parent.mkdir(parents=True, exist_ok=True)
    write_vox_file(output_path, model)

    bounds = model.get_bounds()
    print('Shoreline .vox generated')
    print(f'  output: {output_path}')
    print(f'  model size: {SIZE_X}x{SIZE_Y}x{SIZE_Z}')
    print(f'  used bounds: {bounds[0]}x{bounds[1]}x{bounds[2]}')
    print(f'  voxels: {model.get_voxel_count():,}')


if __name__ == '__main__':
    main()
