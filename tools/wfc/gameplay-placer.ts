/**
 * Places gameplay elements (spawns, capture zones) on a collapsed WFC grid.
 *
 * - Team spawns on opposite edges (prefer road/building tiles)
 * - 3-5 capture points along center axis (prefer building tiles)
 */

import type { SolveResult } from './solver.js';
import type { TileVariant, GameplayMeta, SpawnPoint, CaptureZone } from './types.js';

const TILE_SIZE = 16;

/** Check if a variant has a given tag. */
function hasTag(variant: TileVariant, tag: string): boolean {
  return variant.spec.tags.includes(tag);
}

/**
 * Scan tile voxels top-down to find the actual ground surface Y.
 * Returns the Y coordinate of the highest non-air voxel at the tile center,
 * plus 1 (so entities spawn on top of it).
 */
function findSurfaceY(variant: TileVariant): number {
  const cx = Math.floor(TILE_SIZE / 2);
  const cz = Math.floor(TILE_SIZE / 2);
  // Scan from top down at tile center
  for (let y = TILE_SIZE - 1; y >= 0; y--) {
    const idx = cx + cz * TILE_SIZE + y * TILE_SIZE * TILE_SIZE;
    if (variant.voxels[idx] !== 0) {
      return y + 1; // spawn on top of surface
    }
  }
  // Also try a few nearby positions if center is air
  for (const [ox, oz] of [[2, 2], [-2, -2], [4, 0], [0, 4]]) {
    const sx = cx + ox;
    const sz = cz + oz;
    if (sx < 0 || sx >= TILE_SIZE || sz < 0 || sz >= TILE_SIZE) continue;
    for (let y = TILE_SIZE - 1; y >= 0; y--) {
      const idx = sx + sz * TILE_SIZE + y * TILE_SIZE * TILE_SIZE;
      if (variant.voxels[idx] !== 0) {
        return y + 1;
      }
    }
  }
  return 2; // fallback
}

/**
 * Place gameplay elements based on collapsed grid.
 */
export function placeGameplay(
  result: SolveResult,
  variants: TileVariant[],
): GameplayMeta {
  const { grid, width, depth } = result;
  const mapWidth = width * TILE_SIZE;
  const mapDepth = depth * TILE_SIZE;

  // --- Team spawns ---
  // Team 1: west edge (x=0), Team 2: east edge (x=width-1)
  const team1Spawns = findEdgeSpawns(grid, variants, 0, width, depth, 'col');
  const team2Spawns = findEdgeSpawns(grid, variants, width - 1, width, depth, 'col');

  // --- Capture zones ---
  // Place 3-5 capture points along the center axis (x = width/2 ± 1)
  const captureZones = placeCaptureZones(grid, variants, width, depth);

  return {
    spawns: { team1: team1Spawns, team2: team2Spawns },
    captureZones,
    mapWidth,
    mapDepth,
    tileSize: TILE_SIZE,
  };
}

function findEdgeSpawns(
  grid: SolveResult['grid'],
  variants: TileVariant[],
  edgeIdx: number,
  _width: number,
  depth: number,
  mode: 'col' | 'row',
): SpawnPoint[] {
  const spawns: SpawnPoint[] = [];
  const candidates: { x: number; z: number; priority: number }[] = [];

  for (let i = 0; i < depth; i++) {
    const x = mode === 'col' ? edgeIdx : i;
    const z = mode === 'col' ? i : edgeIdx;
    const cell = grid[z][x];
    if (cell.collapsed === null) continue;

    const variant = variants[cell.collapsed];
    let priority = 1;
    if (hasTag(variant, 'road')) priority = 3;
    if (hasTag(variant, 'building')) priority = 2;
    candidates.push({ x, z, priority });
  }

  // Sort by priority (higher = better), pick top 3
  candidates.sort((a, b) => b.priority - a.priority);
  const picks = candidates.slice(0, 3);

  for (const p of picks) {
    const cell = grid[p.z][p.x];
    const variant = cell.collapsed !== null ? variants[cell.collapsed] : null;
    const surfaceY = variant ? findSurfaceY(variant) : 2;
    spawns.push({
      x: p.x * TILE_SIZE + TILE_SIZE / 2,
      y: surfaceY,
      z: p.z * TILE_SIZE + TILE_SIZE / 2,
    });
  }

  // Ensure at least 1 spawn
  if (spawns.length === 0) {
    spawns.push({
      x: edgeIdx * TILE_SIZE + TILE_SIZE / 2,
      y: 2,
      z: (depth / 2) * TILE_SIZE + TILE_SIZE / 2,
    });
  }

  return spawns;
}

function placeCaptureZones(
  grid: SolveResult['grid'],
  variants: TileVariant[],
  width: number,
  depth: number,
): CaptureZone[] {
  const zones: CaptureZone[] = [];
  const centerX = Math.floor(width / 2);

  // Scan center column for building/road tiles
  const candidates: { x: number; z: number; score: number }[] = [];

  for (let z = 0; z < depth; z++) {
    for (let dx = -1; dx <= 1; dx++) {
      const x = centerX + dx;
      if (x < 0 || x >= width) continue;
      const cell = grid[z][x];
      if (cell.collapsed === null) continue;

      const variant = variants[cell.collapsed];
      let score = 0;
      if (hasTag(variant, 'building')) score = 5;
      else if (hasTag(variant, 'road')) score = 3;
      else if (hasTag(variant, 'cover')) score = 2;
      else score = 1;
      candidates.push({ x, z, score });
    }
  }

  candidates.sort((a, b) => b.score - a.score);

  // Pick 3-7 capture points, spaced apart (more for larger maps)
  const numZones = Math.min(7, Math.max(3, Math.floor(depth / 6)));
  const spacing = Math.floor(depth / (numZones + 1));

  for (let i = 0; i < numZones; i++) {
    const targetZ = (i + 1) * spacing;
    // Find best candidate near targetZ
    let best = candidates[0];
    let bestDist = Infinity;
    for (const c of candidates) {
      const dist = Math.abs(c.z - targetZ);
      if (dist < bestDist || (dist === bestDist && c.score > (best?.score ?? 0))) {
        bestDist = dist;
        best = c;
      }
    }

    if (best) {
      const id = String.fromCharCode(65 + i); // A, B, C, ..., G
      const cell = grid[best.z][best.x];
      const variant = cell.collapsed !== null ? variants[cell.collapsed] : null;
      const surfaceY = variant ? findSurfaceY(variant) : 2;
      zones.push({
        id,
        x: best.x * TILE_SIZE + TILE_SIZE / 2,
        y: surfaceY,
        z: best.z * TILE_SIZE + TILE_SIZE / 2,
        radius: TILE_SIZE,
      });
    }
  }

  return zones;
}
