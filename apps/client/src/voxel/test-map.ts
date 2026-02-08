import { CHUNK_SIZE, MAT_GRASS, MAT_DIRT, MAT_WALL, MAT_ROOF, setVoxel } from '@clawfield/shared';

/**
 * Generate a procedural test map:
 * - Flat ground (8x1x8 chunks = 128x16x128 voxels, 1 voxel high ground)
 * - 3 simple buildings with hollow interiors
 */
export function generateTestMap(): Map<string, Uint8Array> {
  const chunks = new Map<string, Uint8Array>();

  const mapWidth = 8;  // chunks in X
  const mapDepth = 8;  // chunks in Z

  // Ground layer: y=0 is grass, fill dirt below in the same chunk
  for (let cx = 0; cx < mapWidth; cx++) {
    for (let cz = 0; cz < mapDepth; cz++) {
      for (let x = 0; x < CHUNK_SIZE; x++) {
        for (let z = 0; z < CHUNK_SIZE; z++) {
          const wx = cx * CHUNK_SIZE + x;
          const wz = cz * CHUNK_SIZE + z;
          setVoxel(chunks, wx, 0, wz, MAT_GRASS);
        }
      }
    }
  }

  // Building 1: 8x6x8 at position (20, 1, 20)
  makeBuilding(chunks, 20, 1, 20, 8, 6, 8);

  // Building 2: 6x4x10 at position (50, 1, 30)
  makeBuilding(chunks, 50, 1, 30, 6, 4, 10);

  // Building 3: 10x5x6 at position (80, 1, 70)
  makeBuilding(chunks, 80, 1, 70, 10, 5, 6);

  return chunks;
}

/**
 * Create a hollow building with walls, floor, roof, and a door opening.
 */
function makeBuilding(
  chunks: Map<string, Uint8Array>,
  startX: number,
  startY: number,
  startZ: number,
  sizeX: number,
  sizeY: number,
  sizeZ: number
): void {
  for (let x = startX; x < startX + sizeX; x++) {
    for (let y = startY; y < startY + sizeY; y++) {
      for (let z = startZ; z < startZ + sizeZ; z++) {
        const isWallX = x === startX || x === startX + sizeX - 1;
        const isWallZ = z === startZ || z === startZ + sizeZ - 1;
        const isFloor = y === startY;
        const isRoof = y === startY + sizeY - 1;

        if (isRoof) {
          setVoxel(chunks, x, y, z, MAT_ROOF);
        } else if (isFloor) {
          setVoxel(chunks, x, y, z, MAT_WALL);
        } else if (isWallX || isWallZ) {
          // Door opening: 2 wide, 3 tall, on the front wall (minZ), centered
          const doorMinX = startX + Math.floor(sizeX / 2) - 1;
          const doorMaxX = doorMinX + 2;
          const doorMaxY = startY + 3;
          const isDoor =
            z === startZ &&
            x >= doorMinX &&
            x < doorMaxX &&
            y < doorMaxY;

          if (!isDoor) {
            setVoxel(chunks, x, y, z, MAT_WALL);
          }
        }
        // Interior is air (default)
      }
    }
  }
}

/** Convert chunk map to the serializable format for network transport */
export function serializeChunks(
  chunks: Map<string, Uint8Array>
): { key: string; voxels: number[] }[] {
  const result: { key: string; voxels: number[] }[] = [];
  for (const [key, voxels] of chunks) {
    result.push({ key, voxels: Array.from(voxels) });
  }
  return result;
}

/** Deserialize chunk data from network transport back to a chunk map */
export function deserializeChunks(
  data: { key: string; voxels: number[] }[]
): Map<string, Uint8Array> {
  const chunks = new Map<string, Uint8Array>();
  for (const { key, voxels } of data) {
    chunks.set(key, new Uint8Array(voxels));
  }
  return chunks;
}
