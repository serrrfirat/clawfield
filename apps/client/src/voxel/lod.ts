import { CHUNK_SIZE, LOD_DISTANCE_SQ, LOD_FACTORS } from '@clawfield/shared';

/**
 * Determine LOD level for a chunk based on squared distance to the player (in chunk units).
 * Returns 0 (full detail), 1 (half), or 2 (quarter).
 */
export function getLodLevel(distSq: number): number {
  if (distSq <= LOD_DISTANCE_SQ[0]) return 0;
  if (distSq <= LOD_DISTANCE_SQ[1]) return 1;
  return 2;
}

/**
 * Downsample a 16^3 voxel chunk by the given factor (1, 2, or 4).
 * Each factor×factor×factor block is reduced to a single voxel using
 * most-common-non-air-material voting.
 *
 * factor=1 returns the original array unchanged.
 * factor=2 produces an 8^3 = 512-byte array.
 * factor=4 produces a 4^3 = 64-byte array.
 */
export function downsampleChunk(voxels: Uint8Array, factor: number): Uint8Array {
  if (factor === 1) return voxels;

  const outSize = CHUNK_SIZE / factor;
  const out = new Uint8Array(outSize * outSize * outSize);

  // Reusable vote array (material IDs are 0-255)
  const votes = new Uint16Array(256);

  for (let oz = 0; oz < outSize; oz++) {
    for (let oy = 0; oy < outSize; oy++) {
      for (let ox = 0; ox < outSize; ox++) {
        // Sample the factor^3 block
        votes.fill(0);
        const bx = ox * factor;
        const by = oy * factor;
        const bz = oz * factor;

        for (let dz = 0; dz < factor; dz++) {
          for (let dy = 0; dy < factor; dy++) {
            for (let dx = 0; dx < factor; dx++) {
              const ix = bx + dx;
              const iy = by + dy;
              const iz = bz + dz;
              const mat = voxels[ix + iy * CHUNK_SIZE + iz * CHUNK_SIZE * CHUNK_SIZE];
              if (mat !== 0) votes[mat]++;
            }
          }
        }

        // Pick the non-air material with the most votes
        let bestMat = 0;
        let bestCount = 0;
        for (let m = 1; m < 256; m++) {
          if (votes[m] > bestCount) {
            bestCount = votes[m];
            bestMat = m;
          }
        }

        out[ox + oy * outSize + oz * outSize * outSize] = bestMat;
      }
    }
  }

  return out;
}

/** Get the downsample factor for a LOD level */
export function lodFactor(level: number): number {
  return LOD_FACTORS[level] ?? 1;
}
