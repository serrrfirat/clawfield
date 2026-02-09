/**
 * building-detector.ts — Detect enclosed building volumes and generate
 * playable interiors: rooms, doorways, stairs.
 *
 * Algorithm:
 * 1. Flood fill exterior air from map edges
 * 2. Remaining air = interior (enclosed by walls)
 * 3. Slice buildings into floors
 * 4. BSP subdivide each floor into rooms
 * 5. Carve doorways and stairs
 */

import type { ClassifiedGrid, BuildingVolume, RGB } from './types.js';

const CHUNK_SIZE = 16;
const FLOOR_HEIGHT = 4;   // 4 voxels per floor (4 meters)
const MIN_ROOM_SIZE = 4;  // Minimum room dimension
const MAX_ROOM_SIZE = 8;  // Maximum room dimension
const DOOR_WIDTH = 2;     // Door opening width
const DOOR_HEIGHT = 3;    // Door opening height
const STAIR_WIDTH = 2;    // Stairwell width

// Material IDs
const MAT_AIR = 0;
const MAT_CONCRETE = 11;
const MAT_CONCRETE_DARK = 12;
const MAT_WOOD = 13;
const MAT_WALL = 4;

/**
 * Detect buildings and generate interiors.
 */
export function detectAndGenerateInteriors(grid: ClassifiedGrid): BuildingVolume[] {
  console.log('Detecting buildings and generating interiors...');

  const { bounds } = grid;
  const width = bounds.xMax - bounds.xMin;
  const depth = bounds.zMax - bounds.zMin;
  const height = bounds.yMax - bounds.yMin;

  console.log(`  Map size: ${width} × ${height} × ${depth}`);

  const totalCells = width * height * depth;
  if (totalCells > 50_000_000) {
    console.log(`  Grid too large for flood fill (${(totalCells / 1e6).toFixed(1)}M cells), skipping interior detection`);
    console.log(`  Tip: use --skip-interiors or reduce --radius`);
    return [];
  }

  // Step 1: Find all enclosed volumes via flood fill
  const buildings = findEnclosedVolumes(grid);
  console.log(`  Found ${buildings.length} enclosed building volumes`);

  if (buildings.length === 0) return [];

  // Step 2: Generate interiors for each building
  for (const building of buildings) {
    generateBuildingInterior(grid, building);
  }

  console.log(`  Interior generation complete`);
  return buildings;
}

// ---------------------------------------------------------------------------
// Building detection via flood fill (optimized with flat Uint8Array)
// ---------------------------------------------------------------------------

function findEnclosedVolumes(grid: ClassifiedGrid): BuildingVolume[] {
  const { bounds } = grid;
  const w = bounds.xMax - bounds.xMin;
  const h = bounds.yMax - bounds.yMin;
  const d = bounds.zMax - bounds.zMin;

  // Flat bitfield: 0=unknown, 1=exterior, 2=solid
  const field = new Uint8Array(w * h * d);
  const idx = (x: number, y: number, z: number) =>
    (x - bounds.xMin) + (y - bounds.yMin) * w + (z - bounds.zMin) * w * h;

  // Pre-mark solid voxels
  for (const [key, chunk] of grid.chunks) {
    const [cx, cy, cz] = key.split(',').map(Number);
    const baseX = cx * CHUNK_SIZE;
    const baseY = cy * CHUNK_SIZE;
    const baseZ = cz * CHUNK_SIZE;
    for (let ly = 0; ly < CHUNK_SIZE; ly++) {
      for (let lx = 0; lx < CHUNK_SIZE; lx++) {
        for (let lz = 0; lz < CHUNK_SIZE; lz++) {
          if (chunk[lx + ly * CHUNK_SIZE + lz * CHUNK_SIZE * CHUNK_SIZE] !== MAT_AIR) {
            const wx = baseX + lx, wy = baseY + ly, wz = baseZ + lz;
            if (wx >= bounds.xMin && wx < bounds.xMax &&
                wy >= bounds.yMin && wy < bounds.yMax &&
                wz >= bounds.zMin && wz < bounds.zMax) {
              field[idx(wx, wy, wz)] = 2; // solid
            }
          }
        }
      }
    }
  }

  // BFS flood fill from edges — use typed array queue with head pointer
  const queue = new Int32Array(w * h * d); // worst-case size
  let qHead = 0, qTail = 0;

  const enqueue = (x: number, y: number, z: number) => {
    const i = idx(x, y, z);
    if (field[i] === 0) { // unknown air
      field[i] = 1; // exterior
      // Pack 3 coords into queue as flat index
      queue[qTail++] = i;
    }
  };

  // Seed from all 6 faces of the bounding box
  for (let y = bounds.yMin; y < bounds.yMax; y++) {
    for (let z = bounds.zMin; z < bounds.zMax; z++) {
      enqueue(bounds.xMin, y, z);
      enqueue(bounds.xMax - 1, y, z);
    }
    for (let x = bounds.xMin; x < bounds.xMax; x++) {
      enqueue(x, y, bounds.zMin);
      enqueue(x, y, bounds.zMax - 1);
    }
  }
  for (let x = bounds.xMin; x < bounds.xMax; x++) {
    for (let z = bounds.zMin; z < bounds.zMax; z++) {
      enqueue(x, bounds.yMax - 1, z);
      enqueue(x, bounds.yMin, z);
    }
  }

  // BFS using head pointer (O(1) dequeue)
  while (qHead < qTail) {
    const fi = queue[qHead++];
    // Decode flat index back to coordinates
    const lz = Math.floor(fi / (w * h));
    const rem = fi - lz * w * h;
    const ly = Math.floor(rem / w);
    const lx = rem - ly * w;
    const x = lx + bounds.xMin;
    const y = ly + bounds.yMin;
    const z = lz + bounds.zMin;

    // 6-connected neighbors
    if (x + 1 < bounds.xMax) enqueue(x + 1, y, z);
    if (x - 1 >= bounds.xMin) enqueue(x - 1, y, z);
    if (y + 1 < bounds.yMax) enqueue(x, y + 1, z);
    if (y - 1 >= bounds.yMin) enqueue(x, y - 1, z);
    if (z + 1 < bounds.zMax) enqueue(x, y, z + 1);
    if (z - 1 >= bounds.zMin) enqueue(x, y, z - 1);
  }

  console.log(`  Flood fill: ${qTail} exterior air voxels`);

  // Find interior air voxels (field[i] == 0 means unknown = interior air)
  // Cluster into connected components
  const buildings: BuildingVolume[] = [];
  const dirs = [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]];

  // Reuse queue for component BFS
  for (let i = 0; i < field.length; i++) {
    if (field[i] !== 0) continue; // not interior air

    // Found an interior air voxel — BFS to find connected component
    field[i] = 3; // mark visited
    let cHead = 0, cTail = 0;
    queue[cTail++] = i;

    let bxMin = Infinity, bxMax = -Infinity;
    let byMin = Infinity, byMax = -Infinity;
    let bzMin = Infinity, bzMax = -Infinity;
    let componentSize = 0;

    while (cHead < cTail) {
      const fi = queue[cHead++];
      componentSize++;

      const lz = Math.floor(fi / (w * h));
      const rem = fi - lz * w * h;
      const ly = Math.floor(rem / w);
      const lx = rem - ly * w;
      const wx = lx + bounds.xMin;
      const wy = ly + bounds.yMin;
      const wz = lz + bounds.zMin;

      if (wx < bxMin) bxMin = wx;
      if (wx > bxMax) bxMax = wx;
      if (wy < byMin) byMin = wy;
      if (wy > byMax) byMax = wy;
      if (wz < bzMin) bzMin = wz;
      if (wz > bzMax) bzMax = wz;

      for (const [dx, dy, dz] of dirs) {
        const nx = wx + dx, ny = wy + dy, nz = wz + dz;
        if (nx < bounds.xMin || nx >= bounds.xMax) continue;
        if (ny < bounds.yMin || ny >= bounds.yMax) continue;
        if (nz < bounds.zMin || nz >= bounds.zMax) continue;
        const ni = idx(nx, ny, nz);
        if (field[ni] === 0) {
          field[ni] = 3;
          queue[cTail++] = ni;
        }
      }
    }

    // Only count volumes large enough to be a building
    const bWidth = bxMax - bxMin;
    const bHeight = byMax - byMin;
    const bDepth = bzMax - bzMin;

    if (bWidth >= 4 && bHeight >= 3 && bDepth >= 4 && componentSize >= 20) {
      buildings.push({
        xMin: bxMin, xMax: bxMax,
        yMin: byMin, yMax: byMax,
        zMin: bzMin, zMax: bzMax,
        floorCount: Math.max(1, Math.floor(bHeight / FLOOR_HEIGHT)),
      });
    }
  }

  return buildings;
}

// ---------------------------------------------------------------------------
// Interior generation
// ---------------------------------------------------------------------------

function generateBuildingInterior(grid: ClassifiedGrid, building: BuildingVolume): void {
  const bWidth = building.xMax - building.xMin;
  const bDepth = building.zMax - building.zMin;

  // Size classification
  let roomCount: number;
  let stairwellCount: number;

  if (bWidth < 10 && bDepth < 10) {
    roomCount = 1;
    stairwellCount = 0;
  } else if (bWidth < 20 && bDepth < 20) {
    roomCount = 3;
    stairwellCount = 1;
  } else {
    roomCount = 6;
    stairwellCount = 2;
  }

  const maxAccessibleFloors = 6;
  const totalFloors = building.floorCount;

  for (let floor = 0; floor < totalFloors; floor++) {
    if (totalFloors > maxAccessibleFloors && floor >= 3 && floor < totalFloors - 3) {
      continue;
    }

    const floorY = building.yMin + floor * FLOOR_HEIGHT;

    clearFloorInterior(grid, building, floorY);

    if (roomCount > 1) {
      generateRoomPartitions(grid, building, floorY, roomCount);
    }

    addDoorways(grid, building, floorY);
  }

  for (let s = 0; s < stairwellCount; s++) {
    const stairX = building.xMin + (s === 0 ? 2 : bWidth - STAIR_WIDTH - 2);
    const stairZ = building.zMin + Math.floor(bDepth / 2);
    addStairwell(grid, building, stairX, stairZ);
  }
}

function clearFloorInterior(
  grid: ClassifiedGrid,
  building: BuildingVolume,
  floorY: number,
): void {
  for (let y = floorY + 1; y < floorY + FLOOR_HEIGHT - 1 && y <= building.yMax; y++) {
    for (let x = building.xMin + 1; x < building.xMax; x++) {
      for (let z = building.zMin + 1; z < building.zMax; z++) {
        setVoxel(grid, x, y, z, MAT_AIR);
      }
    }
  }

  for (let x = building.xMin; x <= building.xMax; x++) {
    for (let z = building.zMin; z <= building.zMax; z++) {
      if (getVoxel(grid, x, floorY, z) === MAT_AIR) {
        setVoxel(grid, x, floorY, z, MAT_CONCRETE);
      }
    }
  }
}

function generateRoomPartitions(
  grid: ClassifiedGrid,
  building: BuildingVolume,
  floorY: number,
  targetRooms: number,
): void {
  const rooms: { xMin: number; xMax: number; zMin: number; zMax: number }[] = [
    {
      xMin: building.xMin + 1,
      xMax: building.xMax - 1,
      zMin: building.zMin + 1,
      zMax: building.zMax - 1,
    },
  ];

  while (rooms.length < targetRooms) {
    let bestIdx = 0;
    let bestArea = 0;
    for (let i = 0; i < rooms.length; i++) {
      const area = (rooms[i].xMax - rooms[i].xMin) * (rooms[i].zMax - rooms[i].zMin);
      if (area > bestArea) { bestArea = area; bestIdx = i; }
    }

    const room = rooms[bestIdx];
    const w = room.xMax - room.xMin;
    const d = room.zMax - room.zMin;

    if (w < MIN_ROOM_SIZE * 2 && d < MIN_ROOM_SIZE * 2) break;

    if (w >= d && w >= MIN_ROOM_SIZE * 2) {
      const splitX = room.xMin + Math.floor(w / 2);
      rooms.splice(bestIdx, 1,
        { xMin: room.xMin, xMax: splitX, zMin: room.zMin, zMax: room.zMax },
        { xMin: splitX + 1, xMax: room.xMax, zMin: room.zMin, zMax: room.zMax },
      );

      for (let y = floorY + 1; y < floorY + FLOOR_HEIGHT - 1 && y <= building.yMax; y++) {
        for (let z = room.zMin; z <= room.zMax; z++) {
          setVoxel(grid, splitX, y, z, MAT_WALL);
        }
      }
    } else if (d >= MIN_ROOM_SIZE * 2) {
      const splitZ = room.zMin + Math.floor(d / 2);
      rooms.splice(bestIdx, 1,
        { xMin: room.xMin, xMax: room.xMax, zMin: room.zMin, zMax: splitZ },
        { xMin: room.xMin, xMax: room.xMax, zMin: splitZ + 1, zMax: room.zMax },
      );

      for (let y = floorY + 1; y < floorY + FLOOR_HEIGHT - 1 && y <= building.yMax; y++) {
        for (let x = room.xMin; x <= room.xMax; x++) {
          setVoxel(grid, x, y, splitZ, MAT_WALL);
        }
      }
    } else {
      break;
    }
  }
}

function addDoorways(
  grid: ClassifiedGrid,
  building: BuildingVolume,
  floorY: number,
): void {
  const bWidth = building.xMax - building.xMin;
  const bDepth = building.zMax - building.zMin;

  const doorPositions: [number, number, 'x' | 'z'][] = [];

  const doorSpacing = Math.max(6, Math.floor(bWidth / 3));
  for (let x = building.xMin + 3; x < building.xMax - 3; x += doorSpacing) {
    doorPositions.push([x, building.zMin, 'z']);
    doorPositions.push([x, building.zMax, 'z']);
  }

  const doorSpacingZ = Math.max(6, Math.floor(bDepth / 3));
  for (let z = building.zMin + 3; z < building.zMax - 3; z += doorSpacingZ) {
    doorPositions.push([building.xMin, z, 'x']);
    doorPositions.push([building.xMax, z, 'x']);
  }

  for (const [px, pz, axis] of doorPositions) {
    for (let dy = 1; dy <= DOOR_HEIGHT; dy++) {
      const y = floorY + dy;
      if (y > building.yMax) break;

      if (axis === 'x') {
        for (let dz = 0; dz < DOOR_WIDTH; dz++) {
          setVoxel(grid, px, y, pz + dz, MAT_AIR);
        }
      } else {
        for (let dx = 0; dx < DOOR_WIDTH; dx++) {
          setVoxel(grid, px + dx, y, pz, MAT_AIR);
        }
      }
    }
  }

  for (let x = building.xMin + 2; x < building.xMax - 2; x++) {
    for (let z = building.zMin + 2; z < building.zMax - 2; z++) {
      const voxel = getVoxel(grid, x, floorY + 1, z);
      if (voxel === MAT_WALL) {
        const airEast = getVoxel(grid, x + 1, floorY + 1, z) === MAT_AIR;
        const airWest = getVoxel(grid, x - 1, floorY + 1, z) === MAT_AIR;
        const airNorth = getVoxel(grid, x, floorY + 1, z - 1) === MAT_AIR;
        const airSouth = getVoxel(grid, x, floorY + 1, z + 1) === MAT_AIR;

        if ((airEast && airWest) && (x % 6 < DOOR_WIDTH)) {
          for (let dy = 1; dy <= DOOR_HEIGHT; dy++) {
            setVoxel(grid, x, floorY + dy, z, MAT_AIR);
          }
        }
        if ((airNorth && airSouth) && (z % 6 < DOOR_WIDTH)) {
          for (let dy = 1; dy <= DOOR_HEIGHT; dy++) {
            setVoxel(grid, x, floorY + dy, z, MAT_AIR);
          }
        }
      }
    }
  }
}

function addStairwell(
  grid: ClassifiedGrid,
  building: BuildingVolume,
  stairX: number,
  stairZ: number,
): void {
  const totalFloors = building.floorCount;

  for (let floor = 0; floor < totalFloors - 1; floor++) {
    const baseY = building.yMin + floor * FLOOR_HEIGHT;

    for (let dy = 0; dy < FLOOR_HEIGHT + 1; dy++) {
      for (let dx = 0; dx < STAIR_WIDTH + 1; dx++) {
        for (let dz = 0; dz < STAIR_WIDTH + 2; dz++) {
          const x = stairX + dx;
          const y = baseY + dy;
          const z = stairZ + dz;
          if (x <= building.xMax && y <= building.yMax && z <= building.zMax) {
            setVoxel(grid, x, y, z, MAT_AIR);
          }
        }
      }
    }

    const stepsPerFlight = FLOOR_HEIGHT;
    for (let step = 0; step < stepsPerFlight; step++) {
      const stepY = baseY + step + 1;
      const stepZ = stairZ + step;
      if (stepY <= building.yMax && stepZ <= building.zMax) {
        for (let dx = 0; dx < STAIR_WIDTH; dx++) {
          setVoxel(grid, stairX + dx, stepY, stepZ, MAT_CONCRETE_DARK);
        }
      }
    }

    for (let dx = 0; dx < STAIR_WIDTH; dx++) {
      for (let dz = 0; dz < STAIR_WIDTH + 1; dz++) {
        const x = stairX + dx;
        const z = stairZ + dz;
        const ceilY = baseY + FLOOR_HEIGHT;
        if (x <= building.xMax && ceilY <= building.yMax && z <= building.zMax) {
          setVoxel(grid, x, ceilY, z, MAT_AIR);
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Chunk helpers
// ---------------------------------------------------------------------------

function getVoxel(grid: ClassifiedGrid, wx: number, wy: number, wz: number): number {
  const cx = Math.floor(wx / CHUNK_SIZE);
  const cy = Math.floor(wy / CHUNK_SIZE);
  const cz = Math.floor(wz / CHUNK_SIZE);
  const key = `${cx},${cy},${cz}`;
  const chunk = grid.chunks.get(key);
  if (!chunk) return MAT_AIR;

  const lx = ((wx % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
  const ly = ((wy % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
  const lz = ((wz % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
  return chunk[lx + ly * CHUNK_SIZE + lz * CHUNK_SIZE * CHUNK_SIZE];
}

function setVoxel(grid: ClassifiedGrid, wx: number, wy: number, wz: number, value: number): void {
  const cx = Math.floor(wx / CHUNK_SIZE);
  const cy = Math.floor(wy / CHUNK_SIZE);
  const cz = Math.floor(wz / CHUNK_SIZE);
  const key = `${cx},${cy},${cz}`;

  let chunk = grid.chunks.get(key);
  if (!chunk) {
    chunk = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE * CHUNK_SIZE);
    grid.chunks.set(key, chunk);
  }

  const lx = ((wx % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
  const ly = ((wy % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
  const lz = ((wz % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
  chunk[lx + ly * CHUNK_SIZE + lz * CHUNK_SIZE * CHUNK_SIZE] = value;
}
