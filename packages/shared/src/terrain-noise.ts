import { createNoise2D } from 'simplex-noise';
import type { MatchConfig } from './types.js';

/** mulberry32 PRNG - deterministic random from seed */
function mulberry32(seed: number): () => number {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const TERRAIN_NOISE_SEED = 1337;

const defaultNoise2D = createNoise2D(mulberry32(TERRAIN_NOISE_SEED));

/** Default terrain parameters matching the prototype */
export const DEFAULT_TERRAIN_SCALE = 0.05;
export const DEFAULT_TERRAIN_AMPLITUDE = 2;

/** Height getter type for heightmap-based physics */
export type HeightGetter = (wx: number, wz: number) => number;

type HeightmapData = MatchConfig['heightmap'];

function sampleHeightmapDelta(wx: number, wz: number, cellSize: number, cellsByKey: Map<string, number>): number {
  if (cellsByKey.size === 0) return 0;

  const gx = wx / cellSize;
  const gz = wz / cellSize;
  const x0 = Math.floor(gx);
  const z0 = Math.floor(gz);
  const x1 = x0 + 1;
  const z1 = z0 + 1;
  const tx = gx - x0;
  const tz = gz - z0;

  const h00 = cellsByKey.get(`${x0},${z0}`) ?? 0;
  const h10 = cellsByKey.get(`${x1},${z0}`) ?? 0;
  const h01 = cellsByKey.get(`${x0},${z1}`) ?? 0;
  const h11 = cellsByKey.get(`${x1},${z1}`) ?? 0;

  const hx0 = h00 + (h10 - h00) * tx;
  const hx1 = h01 + (h11 - h01) * tx;
  return hx0 + (hx1 - hx0) * tz;
}

/**
 * Create a height getter function from noise parameters.
 * Returns terrain height at the given world (x, z) coordinates.
 * When seed differs from TERRAIN_NOISE_SEED, a new noise function is created.
 */
export function createTerrainHeight(
  scale: number = DEFAULT_TERRAIN_SCALE,
  amplitude: number = DEFAULT_TERRAIN_AMPLITUDE,
  seed: number = TERRAIN_NOISE_SEED,
  heightmap?: HeightmapData,
): HeightGetter {
  const noise = seed === TERRAIN_NOISE_SEED
    ? defaultNoise2D
    : createNoise2D(mulberry32(seed));

  const safeCellSize = Math.max(0.25, heightmap?.cellSize || 1);
  const cellsByKey = new Map<string, number>();
  if (heightmap?.cells?.length) {
    for (const c of heightmap.cells) {
      cellsByKey.set(`${c.x},${c.z}`, c.h);
    }
  }

  return (wx: number, wz: number): number => {
    const base = noise(wx * scale, wz * scale) * amplitude;
    return base + sampleHeightmapDelta(wx, wz, safeCellSize, cellsByKey);
  };
}
