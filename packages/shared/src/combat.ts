import { isWater } from './constants.js';
import type { Vec3, AABB } from './types.js';
import type { HeightGetter } from './terrain-noise.js';

/** Team identifiers */
export enum Team {
  Alpha = 0,
  Bravo = 1,
}

/** Team colors (hex) */
export const TEAM_COLORS: Record<Team, number> = {
  [Team.Alpha]: 0x3498db, // blue
  [Team.Bravo]: 0xe74c3c, // red
};

/** Default tickets per team for TDM */
export const TDM_TICKETS = 75;

/** Respawn delay in seconds */
export const RESPAWN_DELAY = 5;

/** Max player health */
export const MAX_HEALTH = 100;

/** Spawn points per team (world coordinates) */
export const SPAWN_POINTS: Record<Team, Vec3[]> = {
  [Team.Alpha]: [
    { x: 20, y: 2, z: 10 },
    { x: 24, y: 2, z: 10 },
    { x: 22, y: 2, z: 14 },
  ],
  [Team.Bravo]: [
    { x: 100, y: 2, z: 110 },
    { x: 104, y: 2, z: 110 },
    { x: 102, y: 2, z: 114 },
  ],
};

// --- Raycasting ---

/** Result of a ray-AABB intersection test */
export interface RayHit {
  /** Distance along ray to hit point */
  t: number;
  /** Hit point in world space */
  point: Vec3;
}

/**
 * Ray-AABB intersection test (slab method).
 * Returns hit info or null if no intersection.
 */
export function rayIntersectAABB(
  origin: Vec3,
  direction: Vec3,
  aabb: AABB,
  maxDist: number
): RayHit | null {
  let tMin = 0;
  let tMax = maxDist;

  // X slab
  if (Math.abs(direction.x) < 1e-8) {
    if (origin.x < aabb.minX || origin.x > aabb.maxX) return null;
  } else {
    const invD = 1 / direction.x;
    let t0 = (aabb.minX - origin.x) * invD;
    let t1 = (aabb.maxX - origin.x) * invD;
    if (t0 > t1) { const tmp = t0; t0 = t1; t1 = tmp; }
    tMin = Math.max(tMin, t0);
    tMax = Math.min(tMax, t1);
    if (tMin > tMax) return null;
  }

  // Y slab
  if (Math.abs(direction.y) < 1e-8) {
    if (origin.y < aabb.minY || origin.y > aabb.maxY) return null;
  } else {
    const invD = 1 / direction.y;
    let t0 = (aabb.minY - origin.y) * invD;
    let t1 = (aabb.maxY - origin.y) * invD;
    if (t0 > t1) { const tmp = t0; t0 = t1; t1 = tmp; }
    tMin = Math.max(tMin, t0);
    tMax = Math.min(tMax, t1);
    if (tMin > tMax) return null;
  }

  // Z slab
  if (Math.abs(direction.z) < 1e-8) {
    if (origin.z < aabb.minZ || origin.z > aabb.maxZ) return null;
  } else {
    const invD = 1 / direction.z;
    let t0 = (aabb.minZ - origin.z) * invD;
    let t1 = (aabb.maxZ - origin.z) * invD;
    if (t0 > t1) { const tmp = t0; t0 = t1; t1 = tmp; }
    tMin = Math.max(tMin, t0);
    tMax = Math.min(tMax, t1);
    if (tMin > tMax) return null;
  }

  return {
    t: tMin,
    point: {
      x: origin.x + direction.x * tMin,
      y: origin.y + direction.y * tMin,
      z: origin.z + direction.z * tMin,
    },
  };
}

/**
 * DDA ray march through voxel grid.
 * Returns the distance to the first solid voxel hit, or maxDist if none.
 */
export function rayVoxelMarch(
  origin: Vec3,
  direction: Vec3,
  maxDist: number,
  getVoxel: (wx: number, wy: number, wz: number) => number
): number {
  // Current voxel
  let x = Math.floor(origin.x);
  let y = Math.floor(origin.y);
  let z = Math.floor(origin.z);

  // Step direction
  const stepX = direction.x >= 0 ? 1 : -1;
  const stepY = direction.y >= 0 ? 1 : -1;
  const stepZ = direction.z >= 0 ? 1 : -1;

  // Distance along ray to cross one voxel in each axis
  const tDeltaX = Math.abs(direction.x) > 1e-8 ? Math.abs(1 / direction.x) : 1e30;
  const tDeltaY = Math.abs(direction.y) > 1e-8 ? Math.abs(1 / direction.y) : 1e30;
  const tDeltaZ = Math.abs(direction.z) > 1e-8 ? Math.abs(1 / direction.z) : 1e30;

  // Distance to next voxel boundary
  let tMaxX = direction.x >= 0
    ? (x + 1 - origin.x) * tDeltaX
    : (origin.x - x) * tDeltaX;
  let tMaxY = direction.y >= 0
    ? (y + 1 - origin.y) * tDeltaY
    : (origin.y - y) * tDeltaY;
  let tMaxZ = direction.z >= 0
    ? (z + 1 - origin.z) * tDeltaZ
    : (origin.z - z) * tDeltaZ;

  let dist = 0;

  while (dist < maxDist) {
    // Check current voxel (skip origin voxel, bullets pass through water)
    if (dist > 0) {
      const v = getVoxel(x, y, z);
      if (v !== 0 && !isWater(v)) {
        return dist;
      }
    }

    // Advance to next voxel
    if (tMaxX < tMaxY) {
      if (tMaxX < tMaxZ) {
        dist = tMaxX;
        tMaxX += tDeltaX;
        x += stepX;
      } else {
        dist = tMaxZ;
        tMaxZ += tDeltaZ;
        z += stepZ;
      }
    } else {
      if (tMaxY < tMaxZ) {
        dist = tMaxY;
        tMaxY += tDeltaY;
        y += stepY;
      } else {
        dist = tMaxZ;
        tMaxZ += tDeltaZ;
        z += stepZ;
      }
    }
  }

  return maxDist;
}

/**
 * Ray march along a heightmap terrain.
 * Walks the ray in 3D, sampling terrain height at each step.
 * Returns distance to first terrain hit, or maxDist if unobstructed.
 */
export function rayHeightmapMarch(
  origin: Vec3,
  direction: Vec3,
  maxDist: number,
  getHeight: HeightGetter,
  sampleStep: number = 0.5,
): number {
  let t = sampleStep;
  while (t < maxDist) {
    const px = origin.x + direction.x * t;
    const py = origin.y + direction.y * t;
    const pz = origin.z + direction.z * t;
    const terrainY = getHeight(px, pz);
    if (py <= terrainY) {
      return t;
    }
    t += sampleStep;
  }
  return maxDist;
}

/** Normalize a vector */
export function normalize(v: Vec3): Vec3 {
  const len = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
  if (len < 1e-8) return { x: 0, y: 0, z: 1 };
  return { x: v.x / len, y: v.y / len, z: v.z / len };
}

/** Get forward direction from yaw and pitch */
export function aimDirection(yaw: number, pitch: number): Vec3 {
  return normalize({
    x: Math.sin(yaw) * Math.cos(pitch),
    y: Math.sin(pitch),
    z: -Math.cos(yaw) * Math.cos(pitch),
  });
}
