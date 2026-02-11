/**
 * Rotation utilities for 16³ voxel tiles.
 * Rotates around the Y axis (CW when viewed from above).
 */

import type { Sockets } from './types.js';

const SIZE = 16;

/** Voxel linear index: x + z*16 + y*256 */
function idx(x: number, y: number, z: number): number {
  return x + z * SIZE + y * SIZE * SIZE;
}

/**
 * Rotate a 16³ voxel grid 90° CW around Y axis once.
 * Mapping: (x, y, z) → (SIZE-1-z, y, x)
 */
function rotateVoxels90(voxels: Uint8Array): Uint8Array {
  const out = new Uint8Array(SIZE * SIZE * SIZE);
  for (let y = 0; y < SIZE; y++) {
    for (let z = 0; z < SIZE; z++) {
      for (let x = 0; x < SIZE; x++) {
        const v = voxels[idx(x, y, z)];
        if (v !== 0) {
          const nx = SIZE - 1 - z;
          const nz = x;
          out[idx(nx, y, nz)] = v;
        }
      }
    }
  }
  return out;
}

/** Rotate sockets 90° CW: N→E, E→S, S→W, W→N */
function rotateSockets90(s: Sockets): Sockets {
  return { n: s.w, e: s.n, s: s.e, w: s.s };
}

/**
 * Rotate a tile's voxels and sockets by `times` × 90° CW.
 */
export function rotateTile(
  voxels: Uint8Array,
  sockets: Sockets,
  times: number,
): { voxels: Uint8Array; sockets: Sockets } {
  let v = voxels;
  let s = { ...sockets };
  for (let i = 0; i < (times % 4); i++) {
    v = rotateVoxels90(v);
    s = rotateSockets90(s);
  }
  return { voxels: v, sockets: s };
}
