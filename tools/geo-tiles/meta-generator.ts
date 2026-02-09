/**
 * meta-generator.ts — Auto-place spawn points on roads/open areas
 * and capture points at intersections/plazas.
 */

import type { ClassifiedGrid, MapMeta, Vec3 } from './types.js';

const CHUNK_SIZE = 16;
const MAT_AIR = 0;
const MAT_ROAD = 18;
const MAT_GRASS = 1;
const MAT_DIRT = 2;
const MAT_SAND_LIGHT = 7;
const MAT_SAND_DARK = 8;
const MAT_CONCRETE = 11;
const MAT_STONE = 3;
const MAT_WATER = 6;
const MAT_WATER_DEEP = 17;

/** Materials considered "open ground" for spawn/capture placement */
const GROUND_MATERIALS = new Set([MAT_ROAD, MAT_GRASS, MAT_DIRT, MAT_SAND_LIGHT, MAT_SAND_DARK, MAT_CONCRETE, MAT_STONE]);
const WATER_MATERIALS = new Set([MAT_WATER, MAT_WATER_DEEP]);

/**
 * Generate map metadata: spawn points and capture points.
 */
export function generateMeta(
  grid: ClassifiedGrid,
  mapName: string,
): MapMeta {
  console.log('Generating map metadata...');

  const { bounds } = grid;

  // Find ground level
  const groundY = findGroundLevel(grid);
  console.log(`  Ground level: Y=${groundY}`);

  // Scan for road/open ground surface voxels at ground level
  const groundVoxels: { x: number; z: number; mat: number }[] = [];

  for (let x = bounds.xMin; x <= bounds.xMax; x++) {
    for (let z = bounds.zMin; z <= bounds.zMax; z++) {
      // Find surface Y at this column
      const surfY = findSurfaceY(grid, x, z, bounds);
      if (surfY === null) continue;
      if (Math.abs(surfY - groundY) > 3) continue; // Skip non-ground-level surfaces

      const mat = getVoxel(grid, x, surfY, z);
      if (GROUND_MATERIALS.has(mat)) {
        // Check for clear sky (3+ air voxels above)
        let clearAbove = true;
        for (let dy = 1; dy <= 3; dy++) {
          if (getVoxel(grid, x, surfY + dy, z) !== MAT_AIR) {
            clearAbove = false;
            break;
          }
        }
        if (clearAbove) {
          groundVoxels.push({ x, z, mat });
        }
      }
    }
  }

  console.log(`  Ground voxels at ground level: ${groundVoxels.length}`);

  // Generate spawn points
  const spawnPoints = generateSpawnPoints(grid, groundVoxels, bounds, groundY);

  // Generate capture points
  const capturePoints = generateCapturePoints(grid, groundVoxels, bounds, groundY);

  // Water indices
  const waterIndices = [MAT_WATER, MAT_WATER_DEEP];

  return {
    name: mapName,
    description: `Generated from Google 3D Tiles at ${mapName}`,
    spawnPoints,
    capturePoints,
    objectives: [],
    waterIndices,
  };
}

// ---------------------------------------------------------------------------
// Spawn point generation
// ---------------------------------------------------------------------------

function generateSpawnPoints(
  grid: ClassifiedGrid,
  groundVoxels: { x: number; z: number; mat: number }[],
  bounds: ClassifiedGrid['bounds'],
  groundY: number,
): { alpha: Vec3[]; bravo: Vec3[] } {
  const midX = (bounds.xMin + bounds.xMax) / 2;
  const thirdWidth = (bounds.xMax - bounds.xMin) / 3;

  // Alpha spawns in west third, Bravo in east third
  const alphaVoxels = groundVoxels.filter(v => v.x < bounds.xMin + thirdWidth);
  const bravoVoxels = groundVoxels.filter(v => v.x > bounds.xMax - thirdWidth);

  // Prefer road voxels for spawns
  const alphaRoads = alphaVoxels.filter(v => v.mat === MAT_ROAD);
  const bravoRoads = bravoVoxels.filter(v => v.mat === MAT_ROAD);

  const alphaPool = alphaRoads.length >= 10 ? alphaRoads : alphaVoxels;
  const bravoPool = bravoRoads.length >= 10 ? bravoRoads : bravoVoxels;

  const alpha = selectSpawnPoints(alphaPool, 3, 30, groundY);
  const bravo = selectSpawnPoints(bravoPool, 3, 30, groundY);

  // Fallback: if not enough spawns, place at edges
  while (alpha.length < 3) {
    alpha.push({
      x: bounds.xMin + 10,
      y: groundY + 1,
      z: bounds.zMin + 10 + alpha.length * 30,
    });
  }
  while (bravo.length < 3) {
    bravo.push({
      x: bounds.xMax - 10,
      y: groundY + 1,
      z: bounds.zMin + 10 + bravo.length * 30,
    });
  }

  console.log(`  Spawn points: Alpha=${alpha.length}, Bravo=${bravo.length}`);
  return { alpha, bravo };
}

function selectSpawnPoints(
  pool: { x: number; z: number }[],
  count: number,
  minSpacing: number,
  groundY: number,
): Vec3[] {
  if (pool.length === 0) return [];

  const selected: Vec3[] = [];

  // Greedy farthest-point sampling
  // Start near the center of the pool
  const avgX = pool.reduce((s, v) => s + v.x, 0) / pool.length;
  const avgZ = pool.reduce((s, v) => s + v.z, 0) / pool.length;

  let bestStart = pool[0];
  let bestDist = Infinity;
  for (const v of pool) {
    const d = (v.x - avgX) ** 2 + (v.z - avgZ) ** 2;
    if (d < bestDist) { bestDist = d; bestStart = v; }
  }

  selected.push({ x: bestStart.x, y: groundY + 1, z: bestStart.z });

  for (let i = 1; i < count && pool.length > 0; i++) {
    let farthest = pool[0];
    let farthestMinDist = 0;

    for (const v of pool) {
      let minDist = Infinity;
      for (const s of selected) {
        const d = Math.sqrt((v.x - s.x) ** 2 + (v.z - s.z) ** 2);
        if (d < minDist) minDist = d;
      }
      if (minDist > farthestMinDist && minDist >= minSpacing) {
        farthestMinDist = minDist;
        farthest = v;
      }
    }

    if (farthestMinDist >= minSpacing) {
      selected.push({ x: farthest.x, y: groundY + 1, z: farthest.z });
    }
  }

  return selected;
}

// ---------------------------------------------------------------------------
// Capture point generation
// ---------------------------------------------------------------------------

function generateCapturePoints(
  grid: ClassifiedGrid,
  groundVoxels: { x: number; z: number; mat: number }[],
  bounds: ClassifiedGrid['bounds'],
  groundY: number,
): MapMeta['capturePoints'] {
  // Find road intersections and open plazas
  const candidates: { x: number; z: number; score: number }[] = [];

  // Method 1: Road intersections (road extending in 3+ directions)
  const roadSet = new Set(
    groundVoxels.filter(v => v.mat === MAT_ROAD).map(v => `${v.x},${v.z}`)
  );

  for (const v of groundVoxels.filter(v => v.mat === MAT_ROAD)) {
    // Check 4 directions for road continuity (5 voxels deep)
    let directions = 0;
    const checkDist = 5;

    // North
    let roadCount = 0;
    for (let d = 1; d <= checkDist; d++) {
      if (roadSet.has(`${v.x},${v.z - d}`)) roadCount++;
    }
    if (roadCount >= 3) directions++;

    // South
    roadCount = 0;
    for (let d = 1; d <= checkDist; d++) {
      if (roadSet.has(`${v.x},${v.z + d}`)) roadCount++;
    }
    if (roadCount >= 3) directions++;

    // East
    roadCount = 0;
    for (let d = 1; d <= checkDist; d++) {
      if (roadSet.has(`${v.x + d},${v.z}`)) roadCount++;
    }
    if (roadCount >= 3) directions++;

    // West
    roadCount = 0;
    for (let d = 1; d <= checkDist; d++) {
      if (roadSet.has(`${v.x - d},${v.z}`)) roadCount++;
    }
    if (roadCount >= 3) directions++;

    if (directions >= 3) {
      candidates.push({ x: v.x, z: v.z, score: directions * 10 });
    }
  }

  // Method 2: Open plazas (connected ground >15x15 without roof)
  // Sample every 15 voxels and check area
  const groundSet = new Set(groundVoxels.map(v => `${v.x},${v.z}`));
  for (let x = bounds.xMin + 8; x < bounds.xMax - 8; x += 15) {
    for (let z = bounds.zMin + 8; z < bounds.zMax - 8; z += 15) {
      if (!groundSet.has(`${x},${z}`)) continue;

      // Check if 15x15 area around this point is mostly open ground
      let openCount = 0;
      const checkSize = 7; // 15x15 = ±7
      for (let dx = -checkSize; dx <= checkSize; dx++) {
        for (let dz = -checkSize; dz <= checkSize; dz++) {
          if (groundSet.has(`${x + dx},${z + dz}`)) openCount++;
        }
      }

      const area = (checkSize * 2 + 1) ** 2;
      if (openCount > area * 0.6) {
        candidates.push({ x, z, score: openCount });
      }
    }
  }

  if (candidates.length === 0) {
    // Fallback: evenly space along center X axis
    const midX = Math.floor((bounds.xMin + bounds.xMax) / 2);
    const spacing = Math.floor((bounds.zMax - bounds.zMin) / 4);
    for (let i = 1; i <= 3; i++) {
      candidates.push({
        x: midX,
        z: bounds.zMin + i * spacing,
        score: 1,
      });
    }
  }

  // Select 3-5 capture points via greedy farthest-point sampling
  const targetCount = Math.min(5, Math.max(3, Math.floor(candidates.length / 3)));
  const selected = selectCapturePoints(candidates, targetCount);

  const capturePoints: MapMeta['capturePoints'] = selected.map((cp, i) => {
    const letters = ['A', 'B', 'C', 'D', 'E'];
    return {
      id: letters[i] ?? `CP${i}`,
      position: { x: cp.x, y: groundY + 1, z: cp.z },
      initialOwner: -1, // Neutral
    };
  });

  console.log(`  Capture points: ${capturePoints.length}`);
  return capturePoints;
}

function selectCapturePoints(
  candidates: { x: number; z: number; score: number }[],
  count: number,
): { x: number; z: number }[] {
  if (candidates.length <= count) {
    return candidates.map(c => ({ x: c.x, z: c.z }));
  }

  // Sort by score descending, then greedy farthest-point
  candidates.sort((a, b) => b.score - a.score);

  const selected: { x: number; z: number }[] = [{ x: candidates[0].x, z: candidates[0].z }];

  for (let i = 1; i < count; i++) {
    let bestIdx = -1;
    let bestMinDist = 0;

    for (let ci = 0; ci < candidates.length; ci++) {
      const c = candidates[ci];
      let minDist = Infinity;
      for (const s of selected) {
        const d = Math.sqrt((c.x - s.x) ** 2 + (c.z - s.z) ** 2);
        if (d < minDist) minDist = d;
      }
      // Weight by score + distance
      const weighted = minDist * (1 + c.score * 0.01);
      if (weighted > bestMinDist) {
        bestMinDist = weighted;
        bestIdx = ci;
      }
    }

    if (bestIdx >= 0) {
      selected.push({ x: candidates[bestIdx].x, z: candidates[bestIdx].z });
    }
  }

  return selected;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function findGroundLevel(grid: ClassifiedGrid): number {
  const { bounds } = grid;
  const yHistogram = new Map<number, number>();

  // Sample every 5th column for speed
  for (let x = bounds.xMin; x <= bounds.xMax; x += 5) {
    for (let z = bounds.zMin; z <= bounds.zMax; z += 5) {
      const surfY = findSurfaceY(grid, x, z, bounds);
      if (surfY !== null) {
        yHistogram.set(surfY, (yHistogram.get(surfY) ?? 0) + 1);
      }
    }
  }

  let maxCount = 0;
  let groundY = bounds.yMin;
  for (const [y, count] of yHistogram) {
    if (count > maxCount) {
      maxCount = count;
      groundY = y;
    }
  }

  return groundY;
}

function findSurfaceY(
  grid: ClassifiedGrid,
  x: number, z: number,
  bounds: ClassifiedGrid['bounds'],
): number | null {
  for (let y = bounds.yMax; y >= bounds.yMin; y--) {
    const mat = getVoxel(grid, x, y, z);
    if (mat !== MAT_AIR && !WATER_MATERIALS.has(mat)) {
      return y;
    }
  }
  return null;
}

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
