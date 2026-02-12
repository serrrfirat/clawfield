import { createNoise2D } from 'simplex-noise';

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

/**
 * Create a height getter function from noise parameters.
 * Returns terrain height at the given world (x, z) coordinates.
 * When seed differs from TERRAIN_NOISE_SEED, a new noise function is created.
 */
export function createTerrainHeight(
  scale: number = DEFAULT_TERRAIN_SCALE,
  amplitude: number = DEFAULT_TERRAIN_AMPLITUDE,
  seed: number = TERRAIN_NOISE_SEED,
): HeightGetter {
  const noise = seed === TERRAIN_NOISE_SEED
    ? defaultNoise2D
    : createNoise2D(mulberry32(seed));
  return (wx: number, wz: number): number => {
    return noise(wx * scale, wz * scale) * amplitude;
  };
}
