/**
 * voxel-object.ts
 *
 * Types and utilities for multi-resolution voxel objects.
 * Objects carry their own voxel grid, palette, and resolution —
 * independent of the chunk-based terrain system.
 */

import type { Vec3 } from './types.js';

/** Object category determines default voxel resolution */
export type VoxelObjectCategory = 'terrain' | 'building' | 'prop' | 'vegetation';

/** Voxels per meter for each category (inverse of voxelSize) */
export const CATEGORY_RESOLUTION: Record<VoxelObjectCategory, number> = {
  terrain: 2,     // 0.5m voxels
  building: 4,    // 0.25m voxels
  prop: 8,        // 0.125m voxels
  vegetation: 5,  // 0.2m voxels
};

/**
 * Self-contained voxel object definition (.vobj.json format).
 *
 * Each object has its own grid dimensions, voxel size, and 256-color palette.
 * Voxels are stored as a flat array indexed by: x + y * sizeX + z * sizeX * sizeY
 * Index 0 = air, 1-255 = palette color indices.
 */
export interface VoxelObjectDef {
  name: string;
  version: 1;
  category: VoxelObjectCategory;

  /** Grid dimensions in voxel counts */
  sizeX: number;
  sizeY: number;
  sizeZ: number;

  /** World-space size of one voxel in meters */
  voxelSize: number;

  /** Pivot point in voxel coordinates (where the placement position anchors) */
  origin: { x: number; y: number; z: number };

  /** 256-entry palette of hex colors (0xRRGGBB). Index 0 = air. */
  palette: number[];

  /** Flat voxel data, length = sizeX * sizeY * sizeZ. Values are palette indices. */
  voxels: number[];
}

/**
 * Describes a placed voxel object in the world.
 * Stored in map metadata (.meta.json).
 */
export interface MapObjectPlacement {
  /** Reference to object ID in the registry */
  objectId: string;
  /** World-space position (pivot point) */
  position: Vec3;
  /** Y-axis rotation in degrees (0, 90, 180, 270) */
  rotation: number;
}

/** Object registry entry (from registry.json) */
export interface ObjectRegistryEntry {
  id: string;
  path: string;
  category: VoxelObjectCategory;
}

/** Object registry format (registry.json) */
export interface ObjectRegistry {
  version: 1;
  objects: ObjectRegistryEntry[];
}

/**
 * Get the voxel at (x, y, z) in an object's flat voxel array.
 * Returns 0 for out-of-bounds coordinates.
 */
export function getObjectVoxel(
  voxels: number[] | Uint8Array,
  x: number,
  y: number,
  z: number,
  sizeX: number,
  sizeY: number,
  sizeZ: number
): number {
  if (x < 0 || x >= sizeX || y < 0 || y >= sizeY || z < 0 || z >= sizeZ) {
    return 0;
  }
  return voxels[x + y * sizeX + z * sizeX * sizeY];
}

/**
 * Compute the world-space AABB for a placed object.
 */
export function getObjectWorldBounds(
  def: VoxelObjectDef,
  placement: MapObjectPlacement
): { minX: number; minY: number; minZ: number; maxX: number; maxY: number; maxZ: number } {
  const { sizeX, sizeY, sizeZ, voxelSize, origin } = def;
  const rot = ((placement.rotation % 360) + 360) % 360;

  // Object local extents in world units (before rotation)
  let extX = sizeX * voxelSize;
  let extZ = sizeZ * voxelSize;
  let ofsX = -origin.x * voxelSize;
  let ofsZ = -origin.z * voxelSize;

  // For 90/270 rotations, swap X and Z extents
  if (rot === 90 || rot === 270) {
    [extX, extZ] = [extZ, extX];
    [ofsX, ofsZ] = [ofsZ, ofsX];
  }
  if (rot === 180 || rot === 270) {
    ofsX = -extX - ofsX + (rot === 180 ? 0 : extX);
  }

  // Simplified: compute bounds as the full bounding box regardless of rotation
  const halfX = (sizeX * voxelSize) / 2;
  const halfZ = (sizeZ * voxelSize) / 2;
  const maxHalf = Math.max(halfX, halfZ);

  const cx = placement.position.x;
  const cy = placement.position.y;
  const cz = placement.position.z;

  return {
    minX: cx - maxHalf,
    minY: cy - origin.y * voxelSize,
    minZ: cz - maxHalf,
    maxX: cx + maxHalf,
    maxY: cy + (sizeY - origin.y) * voxelSize,
    maxZ: cz + maxHalf,
  };
}

/**
 * Convert an object's local voxel coordinate to world coordinates,
 * accounting for placement position, origin, rotation, and voxel size.
 */
export function objectVoxelToWorld(
  lx: number,
  ly: number,
  lz: number,
  def: VoxelObjectDef,
  placement: MapObjectPlacement
): Vec3 {
  const { voxelSize, origin } = def;

  // Offset from origin (in world units)
  let dx = (lx - origin.x) * voxelSize;
  const dy = (ly - origin.y) * voxelSize;
  let dz = (lz - origin.z) * voxelSize;

  // Apply Y-axis rotation
  const rot = ((placement.rotation % 360) + 360) % 360;
  if (rot === 90) {
    [dx, dz] = [-dz, dx];
  } else if (rot === 180) {
    dx = -dx;
    dz = -dz;
  } else if (rot === 270) {
    [dx, dz] = [dz, -dx];
  }

  return {
    x: placement.position.x + dx,
    y: placement.position.y + dy,
    z: placement.position.z + dz,
  };
}
