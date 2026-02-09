import { CHUNK_SIZE, setVoxel } from '@clawfield/shared';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MapdefBounds {
  xMin: number; xMax: number;
  yMin: number; yMax: number;
  zMin: number; zMax: number;
}

export interface TerrainPaletteEntry {
  index: number; r: number; g: number; b: number;
}

export interface TerrainConfig {
  seed: number;
  maxStepHeight: number;
  waterLevel: number;
  bounds: MapdefBounds;
}

const DEFAULT_CONFIG: TerrainConfig = {
  seed: 0,
  maxStepHeight: 1,
  waterLevel: 0,
  bounds: { xMin: -130, xMax: 130, yMin: -4, yMax: 32, zMin: -110, zMax: 110 },
};

// ---------------------------------------------------------------------------
// Heightmap — ported from tools/map-compose.ts
// ---------------------------------------------------------------------------

function heightAtShoreline(x: number, z: number, bounds: MapdefBounds): number {
  const normalized = (x - bounds.xMin) / (bounds.xMax - bounds.xMin);
  let h = 2 + normalized * 6;

  if (x < -50) {
    const beachFactor = (-50 - x) / 80;
    h = h * (1 - beachFactor) + (-2) * beachFactor;
  }

  const zEdgeDist = Math.min(Math.abs(z - bounds.zMin), Math.abs(z - bounds.zMax));
  if (zEdgeDist < 15) {
    const edgeFactor = 1 - zEdgeDist / 15;
    h -= edgeFactor * (h + 2);
  }

  const dxN = (x - 60) / 40;
  const dzN = (z - (-70)) / 35;
  const distN = dxN * dxN + dzN * dzN;
  if (distN < 1) {
    h += (1 - distN) * 6;
  }

  const dxS = (x - 58) / 35;
  const dzS = (z - 60) / 30;
  const distS = dxS * dxS + dzS * dzS;
  if (distS < 1) {
    h += (1 - distS) * 5;
  }

  h += Math.sin(x / 20) * Math.cos(z / 15) * 1.5;
  h += Math.sin(x / 11 + 0.5) * Math.cos(z / 9 + 0.3) * 0.7;

  return Math.round(h);
}

function heightAtGeneric(x: number, z: number, bounds: MapdefBounds, seed: number): number {
  // Base height: gentle rolling hills centered around y=3, amplitude ~2
  let h = 3;

  // Seed-based sine offsets for variety
  const s = seed * 0.1;
  h += Math.sin(x / 25 + s) * Math.cos(z / 20 + s * 0.7) * 1.5;
  h += Math.sin(x / 13 + s * 1.3) * Math.cos(z / 11 + s * 0.4) * 0.8;
  h += Math.sin(x / 40 + s * 0.5) * Math.cos(z / 35 + s * 1.1) * 0.5;

  // Gentle edge drop-off at map borders (cosmetic, still stays positive)
  const xRange = bounds.xMax - bounds.xMin;
  const zRange = bounds.zMax - bounds.zMin;
  const xEdgeDist = Math.min(Math.abs(x - bounds.xMin), Math.abs(x - bounds.xMax));
  const zEdgeDist = Math.min(Math.abs(z - bounds.zMin), Math.abs(z - bounds.zMax));
  const edgeDist = Math.min(xEdgeDist / (xRange * 0.1), zEdgeDist / (zRange * 0.1), 1);
  if (edgeDist < 1) {
    h = h * edgeDist + 1 * (1 - edgeDist);
  }

  // Clamp to ensure all heights stay well above 0 (no accidental water)
  h = Math.max(1, h);

  return Math.round(h);
}

// Current map context for heightAt dispatch
let editorMapName = 'Shoreline';
let editorSeed = 0;

export function setEditorMapContext(mapName: string, seed: number): void {
  editorMapName = mapName;
  editorSeed = seed;
}

export function heightAt(x: number, z: number, bounds: MapdefBounds): number {
  if (editorMapName === 'Shoreline') {
    return heightAtShoreline(x, z, bounds);
  }
  return heightAtGeneric(x, z, bounds, editorSeed);
}

// ---------------------------------------------------------------------------
// Traversability constraint — BFS from center, clamping height diffs
// ---------------------------------------------------------------------------

export function constrainHeightmap(
  rawHeights: Map<string, number>,
  bounds: MapdefBounds,
  maxStep: number,
): Map<string, number> {
  const constrained = new Map<string, number>();
  const visited = new Set<string>();

  const key = (x: number, z: number) => `${x},${z}`;
  const cx = Math.round((bounds.xMin + bounds.xMax) / 2);
  const cz = Math.round((bounds.zMin + bounds.zMax) / 2);

  const startKey = key(cx, cz);
  constrained.set(startKey, rawHeights.get(startKey) ?? 0);
  visited.add(startKey);

  // BFS queue: [x, z]
  const queue: [number, number][] = [[cx, cz]];
  const neighbors = [[1, 0], [-1, 0], [0, 1], [0, -1]];

  while (queue.length > 0) {
    const [px, pz] = queue.shift()!;
    const parentH = constrained.get(key(px, pz))!;

    for (const [dx, dz] of neighbors) {
      const nx = px + dx;
      const nz = pz + dz;
      if (nx < bounds.xMin || nx > bounds.xMax || nz < bounds.zMin || nz > bounds.zMax) continue;
      const nk = key(nx, nz);
      if (visited.has(nk)) continue;
      visited.add(nk);

      const rawH = rawHeights.get(nk) ?? 0;
      const clamped = Math.max(parentH - maxStep, Math.min(parentH + maxStep, rawH));
      constrained.set(nk, clamped);
      queue.push([nx, nz]);
    }
  }

  // Smoothing pass (simple averaging with neighbors)
  const smoothed = new Map<string, number>();
  for (let x = bounds.xMin; x <= bounds.xMax; x++) {
    for (let z = bounds.zMin; z <= bounds.zMax; z++) {
      const k = key(x, z);
      const h = constrained.get(k) ?? 0;
      let sum = h;
      let count = 1;
      for (const [dx, dz] of neighbors) {
        const nk = key(x + dx, z + dz);
        const nh = constrained.get(nk);
        if (nh !== undefined) {
          sum += nh;
          count++;
        }
      }
      smoothed.set(k, Math.round(sum / count));
    }
  }

  // Re-enforce step constraint after smoothing
  const result = new Map<string, number>();
  const visited2 = new Set<string>();
  result.set(startKey, smoothed.get(startKey) ?? 0);
  visited2.add(startKey);
  const queue2: [number, number][] = [[cx, cz]];

  while (queue2.length > 0) {
    const [px, pz] = queue2.shift()!;
    const parentH = result.get(key(px, pz))!;

    for (const [dx, dz] of neighbors) {
      const nx = px + dx;
      const nz = pz + dz;
      if (nx < bounds.xMin || nx > bounds.xMax || nz < bounds.zMin || nz > bounds.zMax) continue;
      const nk = key(nx, nz);
      if (visited2.has(nk)) continue;
      visited2.add(nk);

      const smoothedH = smoothed.get(nk) ?? 0;
      const clamped = Math.max(parentH - maxStep, Math.min(parentH + maxStep, smoothedH));
      result.set(nk, clamped);
      queue2.push([nx, nz]);
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Generate terrain into chunk map
// ---------------------------------------------------------------------------

export function generateTerrain(
  chunks: Map<string, Uint8Array>,
  terrainPalette: Record<string, TerrainPaletteEntry>,
  config: TerrainConfig,
): Map<string, number> {
  const { bounds, waterLevel, maxStepHeight } = config;

  // Build palette lookup
  const P: Record<string, number> = {};
  for (const [name, entry] of Object.entries(terrainPalette)) {
    P[name] = entry.index;
  }

  // Step 1: compute raw heightmap
  const rawHeights = new Map<string, number>();
  for (let x = bounds.xMin; x <= bounds.xMax; x++) {
    for (let z = bounds.zMin; z <= bounds.zMax; z++) {
      rawHeights.set(`${x},${z}`, heightAt(x, z, bounds));
    }
  }

  // Step 2: constrain
  const heights = constrainHeightmap(rawHeights, bounds, maxStepHeight);

  // Detect desert: no water means arid/desert map
  const isDesert = waterLevel < 0;

  // Step 3: generate voxels
  for (let x = bounds.xMin; x <= bounds.xMax; x++) {
    for (let z = bounds.zMin; z <= bounds.zMax; z++) {
      const surfaceY = heights.get(`${x},${z}`) ?? 0;
      const minY = Math.max(bounds.yMin, -4);
      const maxY = Math.max(surfaceY, waterLevel);

      for (let y = minY; y <= maxY; y++) {
        let mat: number;

        // Water
        if (surfaceY <= waterLevel && y <= waterLevel && y > surfaceY) {
          mat = y === waterLevel ? (P.WATER ?? 14) : (P.WATER_DEEP ?? 15);
        }
        // Beach sand (Shoreline-specific, skip for desert)
        else if (!isDesert && x < -40 && surfaceY <= 2 && y <= surfaceY) {
          mat = y === surfaceY
            ? (P.SAND_LIGHT ?? 1)
            : (y === surfaceY - 1
              ? (P.SAND_DARK ?? 2)
              : (P.DIRT ?? 5));
        }
        // Surface
        else if (y === surfaceY) {
          if (isDesert) {
            mat = (x + z) % 3 === 0 ? (P.SAND_DARK ?? 2) : (P.SAND_LIGHT ?? 1);
          } else if (surfaceY <= 2) {
            mat = P.GRASS ?? 3;
          } else if (surfaceY <= 5) {
            mat = (x + z) % 3 === 0 ? (P.GRASS_DARK ?? 4) : (P.GRASS ?? 3);
          } else {
            mat = (x + z) % 2 === 0 ? (P.STONE ?? 6) : (P.GRASS_DARK ?? 4);
          }
        }
        // Sub-surface
        else if (y >= surfaceY - 2) {
          mat = isDesert ? (P.SAND_DARK ?? 2) : (P.DIRT ?? 5);
        } else {
          mat = P.STONE_DARK ?? 7;
        }

        setVoxel(chunks, x, y, z, mat);
      }
    }
  }

  return heights;
}

export function getDefaultConfig(): TerrainConfig {
  return { ...DEFAULT_CONFIG };
}
