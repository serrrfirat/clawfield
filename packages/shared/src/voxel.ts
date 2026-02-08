import { CHUNK_SIZE } from './constants.js';

/** Convert world position to chunk key and local coordinates */
export function worldToChunk(
  wx: number,
  wy: number,
  wz: number
): { chunkKey: string; localX: number; localY: number; localZ: number } {
  const cx = Math.floor(wx / CHUNK_SIZE);
  const cy = Math.floor(wy / CHUNK_SIZE);
  const cz = Math.floor(wz / CHUNK_SIZE);
  return {
    chunkKey: `${cx},${cy},${cz}`,
    localX: ((wx % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE,
    localY: ((wy % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE,
    localZ: ((wz % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE,
  };
}

/** Convert chunk key back to world-space origin position */
export function chunkKeyToPosition(key: string): { x: number; y: number; z: number } {
  const [cx, cy, cz] = key.split(',').map(Number);
  return {
    x: cx * CHUNK_SIZE,
    y: cy * CHUNK_SIZE,
    z: cz * CHUNK_SIZE,
  };
}

/** Local 3D index → flat array index within a chunk */
function localIndex(lx: number, ly: number, lz: number): number {
  return lx + ly * CHUNK_SIZE + lz * CHUNK_SIZE * CHUNK_SIZE;
}

/** Read a voxel value at world coordinates from the chunk map */
export function getVoxel(
  chunks: Map<string, Uint8Array>,
  wx: number,
  wy: number,
  wz: number
): number {
  const { chunkKey, localX, localY, localZ } = worldToChunk(
    Math.floor(wx),
    Math.floor(wy),
    Math.floor(wz)
  );
  const chunk = chunks.get(chunkKey);
  if (!chunk) return 0;
  return chunk[localIndex(localX, localY, localZ)];
}

/** Write a voxel value at world coordinates into the chunk map */
export function setVoxel(
  chunks: Map<string, Uint8Array>,
  wx: number,
  wy: number,
  wz: number,
  value: number
): void {
  const { chunkKey, localX, localY, localZ } = worldToChunk(
    Math.floor(wx),
    Math.floor(wy),
    Math.floor(wz)
  );
  let chunk = chunks.get(chunkKey);
  if (!chunk) {
    chunk = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE * CHUNK_SIZE);
    chunks.set(chunkKey, chunk);
  }
  chunk[localIndex(localX, localY, localZ)] = value;
}

/** Create an empty chunk data array */
export function createEmptyChunk(): Uint8Array {
  return new Uint8Array(CHUNK_SIZE * CHUNK_SIZE * CHUNK_SIZE);
}
