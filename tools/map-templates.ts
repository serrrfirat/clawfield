/**
 * map-templates.ts
 *
 * Terrain template library for procedural map generation.
 * Each template generates terrain voxels for a given bounds using seeded noise.
 * No external dependencies -- uses a self-contained simplex-style noise implementation.
 *
 * Exported templates: urban, desert, forest, coastal, industrial
 *
 * Usage:
 *   import { generateTerrain, TerrainConfig } from './map-templates';
 *   const result = generateTerrain(config, setVoxelFn);
 */

// ---------------------------------------------------------------------------
// Material indices (matching packages/shared/src/constants.ts)
// ---------------------------------------------------------------------------

const MAT_GRASS = 1;
const MAT_DIRT = 2;
const MAT_STONE = 3;
const MAT_WATER = 6;
const MAT_SAND_LIGHT = 7;
const MAT_SAND_DARK = 8;
const MAT_GRASS_DARK = 9;
const MAT_STONE_DARK = 10;
const MAT_CONCRETE = 11;
const MAT_CONCRETE_DARK = 12;
const MAT_WOOD = 13;
const MAT_WOOD_DARK = 14;
const MAT_BRICK = 15;
const MAT_WATER_DEEP = 17;
const MAT_ROAD = 18;
const MAT_METAL = 20;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TerrainTemplate = 'urban' | 'desert' | 'forest' | 'coastal' | 'industrial';

export interface TerrainConfig {
  template: TerrainTemplate;
  bounds: { xMin: number; xMax: number; yMin: number; yMax: number; zMin: number; zMax: number };
  seed: number;
  waterLevel?: number;
  roadDensity?: number;     // 0-1, how many roads
  buildingDensity?: number; // 0-1, how dense buildings are
}

export interface TerrainResult {
  /** Set a voxel: setVoxel(x, y, z, materialIndex) */
  setVoxel: (x: number, y: number, z: number, mat: number) => void;
  /** Road center positions for building placement */
  roads: { x: number; z: number; direction: 'x' | 'z' }[];
  /** Suggested building placement zones (flat areas near roads) */
  buildingZones: { x: number; z: number; width: number; depth: number }[];
  /** Heightmap: getHeight(x, z) returns ground level Y */
  getHeight: (x: number, z: number) => number;
}

// ---------------------------------------------------------------------------
// Seeded PRNG (xoshiro128**)
// ---------------------------------------------------------------------------

function createRng(seed: number) {
  // Initialize state from seed via splitmix32
  let s = seed | 0;
  function splitmix32(): number {
    s = (s + 0x9e3779b9) | 0;
    let t = s ^ (s >>> 16);
    t = Math.imul(t, 0x21f0aaad);
    t = t ^ (t >>> 15);
    t = Math.imul(t, 0x735a2d97);
    t = t ^ (t >>> 15);
    return t >>> 0;
  }

  let a = splitmix32();
  let b = splitmix32();
  let c = splitmix32();
  let d = splitmix32();

  function rotl(x: number, k: number): number {
    return ((x << k) | (x >>> (32 - k))) >>> 0;
  }

  /** Returns a float in [0, 1) */
  function next(): number {
    const result = (Math.imul(rotl(Math.imul(b, 5), 7), 9)) >>> 0;
    const t = (b << 9) >>> 0;
    c = (c ^ a) >>> 0;
    d = (d ^ b) >>> 0;
    b = (b ^ c) >>> 0;
    a = (a ^ d) >>> 0;
    c = (c ^ t) >>> 0;
    d = rotl(d, 11);
    return result / 4294967296;
  }

  /** Returns an integer in [min, max] inclusive */
  function nextInt(min: number, max: number): number {
    return min + Math.floor(next() * (max - min + 1));
  }

  /** Returns a float in [min, max) */
  function nextFloat(min: number, max: number): number {
    return min + next() * (max - min);
  }

  return { next, nextInt, nextFloat };
}

// ---------------------------------------------------------------------------
// Seeded 2D value noise (no external deps)
// ---------------------------------------------------------------------------

/**
 * Creates a seeded 2D noise function using value noise with smooth interpolation.
 * Returns values in approximately [-1, 1].
 */
function createNoise2D(seed: number) {
  // Build a permutation table seeded deterministically
  const SIZE = 256;
  const perm = new Uint8Array(SIZE * 2);
  const gradX = new Float32Array(SIZE);
  const gradZ = new Float32Array(SIZE);

  const rng = createRng(seed);

  // Fill permutation
  const indices: number[] = [];
  for (let i = 0; i < SIZE; i++) indices.push(i);
  // Fisher-Yates shuffle
  for (let i = SIZE - 1; i > 0; i--) {
    const j = rng.nextInt(0, i);
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }
  for (let i = 0; i < SIZE; i++) {
    perm[i] = indices[i];
    perm[i + SIZE] = indices[i];
  }

  // Fill gradient vectors (unit circle samples)
  for (let i = 0; i < SIZE; i++) {
    const angle = rng.nextFloat(0, Math.PI * 2);
    gradX[i] = Math.cos(angle);
    gradZ[i] = Math.sin(angle);
  }

  function fade(t: number): number {
    return t * t * t * (t * (t * 6 - 15) + 10);
  }

  function lerp(a: number, b: number, t: number): number {
    return a + t * (b - a);
  }

  function dotGrad(hash: number, dx: number, dz: number): number {
    const h = hash & 255;
    return gradX[h] * dx + gradZ[h] * dz;
  }

  /**
   * Sample noise at (x, z). Returns a value roughly in [-1, 1].
   */
  function noise(x: number, z: number): number {
    const X = Math.floor(x) & 255;
    const Z = Math.floor(z) & 255;
    const xf = x - Math.floor(x);
    const zf = z - Math.floor(z);
    const u = fade(xf);
    const v = fade(zf);

    const aa = perm[perm[X] + Z];
    const ab = perm[perm[X] + Z + 1];
    const ba = perm[perm[X + 1] + Z];
    const bb = perm[perm[X + 1] + Z + 1];

    const x1 = lerp(dotGrad(aa, xf, zf), dotGrad(ba, xf - 1, zf), u);
    const x2 = lerp(dotGrad(ab, xf, zf - 1), dotGrad(bb, xf - 1, zf - 1), u);

    return lerp(x1, x2, v);
  }

  /**
   * Fractal brownian motion: multiple octaves of noise layered.
   */
  function fbm(x: number, z: number, octaves: number, lacunarity = 2.0, gain = 0.5): number {
    let sum = 0;
    let amp = 1;
    let freq = 1;
    let maxAmp = 0;
    for (let i = 0; i < octaves; i++) {
      sum += noise(x * freq, z * freq) * amp;
      maxAmp += amp;
      amp *= gain;
      freq *= lacunarity;
    }
    return sum / maxAmp;
  }

  return { noise, fbm };
}

// ---------------------------------------------------------------------------
// Heightmap cache helper
// ---------------------------------------------------------------------------

function createHeightmap(
  bounds: TerrainConfig['bounds'],
  heightFn: (x: number, z: number) => number,
): { get: (x: number, z: number) => number; cache: Map<string, number> } {
  const cache = new Map<string, number>();

  function get(x: number, z: number): number {
    const key = `${x},${z}`;
    let h = cache.get(key);
    if (h !== undefined) return h;
    h = heightFn(x, z);
    cache.set(key, h);
    return h;
  }

  return { get, cache };
}

// ---------------------------------------------------------------------------
// URBAN template
// ---------------------------------------------------------------------------

function generateUrban(
  config: TerrainConfig,
  setVoxel: (x: number, y: number, z: number, mat: number) => void,
): TerrainResult {
  const { bounds, seed } = config;
  const roadDensity = config.roadDensity ?? 0.5;
  const buildingDensity = config.buildingDensity ?? 0.5;
  const noise = createNoise2D(seed);
  const rng = createRng(seed + 7);

  // Base height: mostly flat with very slight undulation (+/- 2 voxels)
  const baseY = Math.floor((bounds.yMax - bounds.yMin) * 0.15) + bounds.yMin;

  const heightmap = createHeightmap(bounds, (x, z) => {
    const variation = noise.fbm(x / 60, z / 60, 2) * 2;
    return Math.round(baseY + variation);
  });

  // Determine road spacing from density: denser = closer roads
  const roadSpacing = Math.round(30 - roadDensity * 12); // 18-30 range
  const halfRoadWidth = 2; // road is 5 voxels wide (center +/- 2)
  const sidewalkWidth = 1;

  // Collect road lines
  const roads: TerrainResult['roads'] = [];
  const buildingZones: TerrainResult['buildingZones'] = [];

  // Roads along X axis (running east-west)
  const xRoadPositions: number[] = [];
  {
    const firstZ = bounds.zMin + Math.round(roadSpacing * 0.6);
    for (let z = firstZ; z <= bounds.zMax - roadSpacing * 0.4; z += roadSpacing) {
      xRoadPositions.push(z);
      roads.push({ x: Math.round((bounds.xMin + bounds.xMax) / 2), z, direction: 'x' });
    }
  }

  // Roads along Z axis (running north-south)
  const zRoadPositions: number[] = [];
  {
    const firstX = bounds.xMin + Math.round(roadSpacing * 0.6);
    for (let x = firstX; x <= bounds.xMax - roadSpacing * 0.4; x += roadSpacing) {
      zRoadPositions.push(x);
      roads.push({ x, z: Math.round((bounds.zMin + bounds.zMax) / 2), direction: 'z' });
    }
  }

  // Precompute road and sidewalk lookup sets for fast access
  const isRoad = (x: number, z: number): boolean => {
    for (const rz of xRoadPositions) {
      if (Math.abs(z - rz) <= halfRoadWidth) return true;
    }
    for (const rx of zRoadPositions) {
      if (Math.abs(x - rx) <= halfRoadWidth) return true;
    }
    return false;
  };

  const isSidewalk = (x: number, z: number): boolean => {
    if (isRoad(x, z)) return false;
    for (const rz of xRoadPositions) {
      if (Math.abs(z - rz) <= halfRoadWidth + sidewalkWidth) return true;
    }
    for (const rx of zRoadPositions) {
      if (Math.abs(x - rx) <= halfRoadWidth + sidewalkWidth) return true;
    }
    return false;
  };

  // Build terrain
  for (let x = bounds.xMin; x <= bounds.xMax; x++) {
    for (let z = bounds.zMin; z <= bounds.zMax; z++) {
      const surfaceY = heightmap.get(x, z);
      const minY = bounds.yMin;

      for (let y = minY; y <= surfaceY; y++) {
        let mat: number;

        if (y === surfaceY) {
          if (isRoad(x, z)) {
            mat = MAT_ROAD;
          } else if (isSidewalk(x, z)) {
            mat = MAT_CONCRETE;
          } else {
            // Grass patches with occasional dirt
            mat = rng.next() < 0.15 ? MAT_DIRT : MAT_GRASS;
          }
        } else if (y >= surfaceY - 2) {
          mat = MAT_DIRT;
        } else {
          mat = MAT_STONE_DARK;
        }

        setVoxel(x, y, z, mat);
      }
    }
  }

  // Compute building zones: rectangular areas between road intersections
  for (let ri = 0; ri < zRoadPositions.length - 1; ri++) {
    for (let ci = 0; ci < xRoadPositions.length - 1; ci++) {
      const x1 = zRoadPositions[ri] + halfRoadWidth + sidewalkWidth + 1;
      const x2 = zRoadPositions[ri + 1] - halfRoadWidth - sidewalkWidth - 1;
      const z1 = xRoadPositions[ci] + halfRoadWidth + sidewalkWidth + 1;
      const z2 = xRoadPositions[ci + 1] - halfRoadWidth - sidewalkWidth - 1;

      const w = x2 - x1;
      const d = z2 - z1;

      if (w >= 6 && d >= 6 && rng.next() < buildingDensity) {
        // Shrink zone slightly with random padding for variety
        const pad = rng.nextInt(1, 3);
        buildingZones.push({
          x: x1 + pad,
          z: z1 + pad,
          width: Math.max(4, w - pad * 2),
          depth: Math.max(4, d - pad * 2),
        });
      }
    }
  }

  return {
    setVoxel,
    roads,
    buildingZones,
    getHeight: (x, z) => heightmap.get(x, z),
  };
}

// ---------------------------------------------------------------------------
// DESERT template
// ---------------------------------------------------------------------------

function generateDesert(
  config: TerrainConfig,
  setVoxel: (x: number, y: number, z: number, mat: number) => void,
): TerrainResult {
  const { bounds, seed } = config;
  const buildingDensity = config.buildingDensity ?? 0.3;
  const noise = createNoise2D(seed);
  const noise2 = createNoise2D(seed + 42);
  const rng = createRng(seed + 13);

  const baseY = Math.floor((bounds.yMax - bounds.yMin) * 0.2) + bounds.yMin;

  const heightmap = createHeightmap(bounds, (x, z) => {
    // Rolling dunes: large-scale gentle hills
    const dunes = noise.fbm(x / 80, z / 80, 3, 2.0, 0.45) * 6;
    // Smaller ripples
    const ripples = noise2.fbm(x / 15, z / 15, 2, 2.0, 0.5) * 1.5;
    // Occasional mesa / plateau
    const mesa = noise.fbm(x / 120, z / 120, 2, 2.0, 0.4);
    const mesaBoost = mesa > 0.3 ? (mesa - 0.3) * 12 : 0;

    return Math.round(baseY + dunes + ripples + mesaBoost);
  });

  // Dry riverbed: a winding channel through the map
  const riverbedCenterZ = (x: number): number => {
    return Math.round(noise.noise(x / 100, seed * 0.01) * (bounds.zMax - bounds.zMin) * 0.3);
  };
  const riverbedWidth = 6;

  const roads: TerrainResult['roads'] = [];
  const buildingZones: TerrainResult['buildingZones'] = [];

  // Build terrain
  for (let x = bounds.xMin; x <= bounds.xMax; x++) {
    for (let z = bounds.zMin; z <= bounds.zMax; z++) {
      let surfaceY = heightmap.get(x, z);

      // Carve dry riverbed
      const rbCenter = riverbedCenterZ(x);
      const distFromRiverbed = Math.abs(z - rbCenter);
      if (distFromRiverbed < riverbedWidth) {
        const depth = Math.round((1 - distFromRiverbed / riverbedWidth) * 3);
        surfaceY = surfaceY - depth;
      }

      const minY = bounds.yMin;

      for (let y = minY; y <= surfaceY; y++) {
        let mat: number;

        if (y === surfaceY) {
          if (distFromRiverbed < riverbedWidth * 0.5) {
            // Dry riverbed floor: darker sand / cracked earth
            mat = MAT_SAND_DARK;
          } else {
            // Sand surface with color variation
            mat = rng.next() < 0.6 ? MAT_SAND_LIGHT : MAT_SAND_DARK;
          }
        } else if (y >= surfaceY - 2) {
          mat = MAT_SAND_DARK;
        } else {
          mat = MAT_STONE_DARK;
        }

        setVoxel(x, y, z, mat);
      }
    }
  }

  // Scatter rock formations
  const numRocks = Math.round(15 + rng.next() * 20);
  for (let i = 0; i < numRocks; i++) {
    const rx = rng.nextInt(bounds.xMin + 10, bounds.xMax - 10);
    const rz = rng.nextInt(bounds.zMin + 10, bounds.zMax - 10);
    const baseH = heightmap.get(rx, rz);
    const rockH = rng.nextInt(2, 5);
    const rockR = rng.nextInt(1, 3);

    for (let dx = -rockR; dx <= rockR; dx++) {
      for (let dz = -rockR; dz <= rockR; dz++) {
        if (dx * dx + dz * dz > rockR * rockR + 1) continue;
        const colH = rockH - Math.floor(Math.sqrt(dx * dx + dz * dz));
        if (colH <= 0) continue;
        for (let dy = 0; dy < colH; dy++) {
          const mat = rng.next() < 0.5 ? MAT_STONE : MAT_STONE_DARK;
          setVoxel(rx + dx, baseH + 1 + dy, rz + dz, mat);
        }
      }
    }
  }

  // Flat building zones: find relatively flat areas
  const zoneCandidateSpacing = 40;
  for (let x = bounds.xMin + 20; x < bounds.xMax - 20; x += zoneCandidateSpacing) {
    for (let z = bounds.zMin + 20; z < bounds.zMax - 20; z += zoneCandidateSpacing) {
      // Check flatness: sample corners
      const h00 = heightmap.get(x, z);
      const h10 = heightmap.get(x + 12, z);
      const h01 = heightmap.get(x, z + 12);
      const h11 = heightmap.get(x + 12, z + 12);
      const maxDiff = Math.max(
        Math.abs(h00 - h10), Math.abs(h00 - h01),
        Math.abs(h00 - h11), Math.abs(h10 - h11),
      );

      if (maxDiff <= 2 && rng.next() < buildingDensity) {
        buildingZones.push({ x, z, width: 12, depth: 12 });
      }
    }
  }

  return {
    setVoxel,
    roads,
    buildingZones,
    getHeight: (x, z) => heightmap.get(x, z),
  };
}

// ---------------------------------------------------------------------------
// FOREST template
// ---------------------------------------------------------------------------

function generateForest(
  config: TerrainConfig,
  setVoxel: (x: number, y: number, z: number, mat: number) => void,
): TerrainResult {
  const { bounds, seed } = config;
  const waterLevel = config.waterLevel ?? -1;
  const buildingDensity = config.buildingDensity ?? 0.3;
  const noise = createNoise2D(seed);
  const noise2 = createNoise2D(seed + 99);
  const rng = createRng(seed + 31);

  const baseY = Math.floor((bounds.yMax - bounds.yMin) * 0.25) + bounds.yMin;

  const heightmap = createHeightmap(bounds, (x, z) => {
    // Hilly terrain with more height variation than urban
    const hills = noise.fbm(x / 50, z / 50, 4, 2.0, 0.5) * 8;
    const detail = noise2.fbm(x / 12, z / 12, 2, 2.0, 0.5) * 1.5;

    // Edge drop-off
    const xRange = bounds.xMax - bounds.xMin;
    const zRange = bounds.zMax - bounds.zMin;
    const xEdge = Math.min(Math.abs(x - bounds.xMin), Math.abs(x - bounds.xMax)) / (xRange * 0.1);
    const zEdge = Math.min(Math.abs(z - bounds.zMin), Math.abs(z - bounds.zMax)) / (zRange * 0.1);
    const edgeFactor = Math.min(xEdge, zEdge, 1);

    let h = baseY + hills + detail;
    if (edgeFactor < 1) {
      h = h * edgeFactor + (baseY - 2) * (1 - edgeFactor);
    }

    return Math.round(Math.max(bounds.yMin + 1, h));
  });

  // Optional stream/river path
  const hasStream = waterLevel >= bounds.yMin;
  const streamCenterX = (z: number): number => {
    return Math.round(
      (bounds.xMin + bounds.xMax) * 0.5 +
      noise.noise(z / 70, seed * 0.03) * (bounds.xMax - bounds.xMin) * 0.2,
    );
  };
  const streamWidth = 4;

  const roads: TerrainResult['roads'] = [];
  const buildingZones: TerrainResult['buildingZones'] = [];

  // Build terrain
  for (let x = bounds.xMin; x <= bounds.xMax; x++) {
    for (let z = bounds.zMin; z <= bounds.zMax; z++) {
      let surfaceY = heightmap.get(x, z);

      // Carve stream
      if (hasStream) {
        const sc = streamCenterX(z);
        const dist = Math.abs(x - sc);
        if (dist < streamWidth) {
          const carve = Math.round((1 - dist / streamWidth) * 3);
          surfaceY = Math.min(surfaceY, waterLevel - 1 + Math.floor(dist * 0.5));
          surfaceY = surfaceY - carve;
        }
      }

      const minY = bounds.yMin;
      const maxY = Math.max(surfaceY, hasStream ? waterLevel : surfaceY);

      for (let y = minY; y <= maxY; y++) {
        let mat: number;

        // Water fill
        if (hasStream && y > surfaceY && y <= waterLevel) {
          mat = y === waterLevel ? MAT_WATER : MAT_WATER_DEEP;
        }
        // Surface
        else if (y === surfaceY) {
          if (surfaceY <= waterLevel + 1 && hasStream) {
            mat = MAT_DIRT; // muddy near water
          } else {
            mat = rng.next() < 0.7 ? MAT_GRASS : MAT_GRASS_DARK;
          }
        }
        // Sub-surface
        else if (y >= surfaceY - 2) {
          mat = MAT_DIRT;
        } else {
          mat = MAT_STONE_DARK;
        }

        setVoxel(x, y, z, mat);
      }
    }
  }

  // Place tree stumps/trunks scattered across the map
  const mapArea = (bounds.xMax - bounds.xMin) * (bounds.zMax - bounds.zMin);
  const numTrees = Math.round(mapArea * 0.003); // Dense forest coverage
  const treePlaced = new Set<string>();

  for (let i = 0; i < numTrees; i++) {
    const tx = rng.nextInt(bounds.xMin + 5, bounds.xMax - 5);
    const tz = rng.nextInt(bounds.zMin + 5, bounds.zMax - 5);
    const tKey = `${Math.floor(tx / 3)},${Math.floor(tz / 3)}`;
    if (treePlaced.has(tKey)) continue;
    treePlaced.add(tKey);

    const tBaseY = heightmap.get(tx, tz);

    // Skip trees near water
    if (hasStream && tBaseY <= waterLevel + 2) continue;

    const trunkHeight = rng.nextInt(3, 6);
    const trunkWidth = rng.next() < 0.7 ? 1 : 2;

    // Trunk
    for (let dy = 1; dy <= trunkHeight; dy++) {
      for (let dx = 0; dx < trunkWidth; dx++) {
        for (let dz = 0; dz < trunkWidth; dz++) {
          setVoxel(tx + dx, tBaseY + dy, tz + dz, dy <= 1 ? MAT_WOOD_DARK : MAT_WOOD);
        }
      }
    }

    // Simple canopy (leaves represented by dark grass voxels)
    const canopyR = rng.nextInt(2, 4);
    const canopyBase = tBaseY + trunkHeight;
    for (let dy = 0; dy <= canopyR; dy++) {
      const layerR = canopyR - Math.floor(dy * 0.7);
      for (let dx = -layerR; dx <= layerR; dx++) {
        for (let dz = -layerR; dz <= layerR; dz++) {
          if (dx * dx + dz * dz > layerR * layerR + 1) continue;
          if (rng.next() < 0.15) continue; // sparse holes for natural look
          const leafX = tx + dx + Math.floor(trunkWidth / 2);
          const leafZ = tz + dz + Math.floor(trunkWidth / 2);
          if (leafX < bounds.xMin || leafX > bounds.xMax) continue;
          if (leafZ < bounds.zMin || leafZ > bounds.zMax) continue;
          setVoxel(leafX, canopyBase + dy, leafZ, rng.next() < 0.5 ? MAT_GRASS_DARK : MAT_GRASS);
        }
      }
    }
  }

  // Clearings for buildings
  const clearingSpacing = 50;
  for (let x = bounds.xMin + 25; x < bounds.xMax - 25; x += clearingSpacing) {
    for (let z = bounds.zMin + 25; z < bounds.zMax - 25; z += clearingSpacing) {
      const h = heightmap.get(x, z);
      if (hasStream && h <= waterLevel + 3) continue;

      // Check flatness
      const h10 = heightmap.get(x + 10, z);
      const h01 = heightmap.get(x, z + 10);
      const h11 = heightmap.get(x + 10, z + 10);
      const maxDiff = Math.max(Math.abs(h - h10), Math.abs(h - h01), Math.abs(h - h11));

      if (maxDiff <= 3 && rng.next() < buildingDensity) {
        buildingZones.push({ x, z, width: 10, depth: 10 });
      }
    }
  }

  // Create a simple dirt path connecting clearings (serves as road)
  if (buildingZones.length >= 2) {
    for (let i = 0; i < buildingZones.length - 1; i++) {
      const from = buildingZones[i];
      const to = buildingZones[i + 1];
      const cx = from.x + Math.floor(from.width / 2);
      const cz = from.z + Math.floor(from.depth / 2);
      roads.push({ x: cx, z: cz, direction: Math.abs(to.x - from.x) > Math.abs(to.z - from.z) ? 'x' : 'z' });
    }
  }

  return {
    setVoxel,
    roads,
    buildingZones,
    getHeight: (x, z) => heightmap.get(x, z),
  };
}

// ---------------------------------------------------------------------------
// COASTAL template
// ---------------------------------------------------------------------------

function generateCoastal(
  config: TerrainConfig,
  setVoxel: (x: number, y: number, z: number, mat: number) => void,
): TerrainResult {
  const { bounds, seed } = config;
  const waterLevel = config.waterLevel ?? 2;
  const buildingDensity = config.buildingDensity ?? 0.4;
  const roadDensity = config.roadDensity ?? 0.4;
  const noise = createNoise2D(seed);
  const noise2 = createNoise2D(seed + 55);
  const rng = createRng(seed + 19);

  // Beach on the xMin side, hills on the xMax side
  const xRange = bounds.xMax - bounds.xMin;
  const beachEnd = bounds.xMin + Math.round(xRange * 0.3); // first 30% is beach/water
  const cliffStart = bounds.xMin + Math.round(xRange * 0.65); // last 35% has cliffs/hills

  const heightmap = createHeightmap(bounds, (x, z) => {
    // Normalized position from beach (0) to inland (1)
    const t = (x - bounds.xMin) / xRange;

    let h: number;

    if (x <= beachEnd) {
      // Beach: slopes down toward water and below
      const beachT = (x - bounds.xMin) / (beachEnd - bounds.xMin);
      h = waterLevel - 3 + beachT * 5;
      // Gentle sand ripple
      h += noise.noise(x / 10, z / 10) * 0.5;
    } else if (x >= cliffStart) {
      // Hills / cliffs inland
      const hillT = (x - cliffStart) / (bounds.xMax - cliffStart);
      const hillNoise = noise.fbm(x / 40, z / 40, 3, 2.0, 0.5) * 6;
      h = waterLevel + 4 + hillT * 8 + hillNoise;
    } else {
      // Transition zone: gently rising
      const midT = (x - beachEnd) / (cliffStart - beachEnd);
      h = waterLevel + 2 + midT * 3;
      h += noise.fbm(x / 30, z / 30, 2, 2.0, 0.5) * 2;
    }

    // Z-edge rocky outcroppings near shore
    const zEdgeDist = Math.min(Math.abs(z - bounds.zMin), Math.abs(z - bounds.zMax));
    if (zEdgeDist < 15 && x < cliffStart) {
      const rockNoise = noise2.fbm(x / 8, z / 8, 2) * 3;
      if (rockNoise > 1) {
        h += rockNoise - 1;
      }
    }

    // Edge drop-off at map borders
    const xEdge = Math.min(Math.abs(x - bounds.xMin), Math.abs(x - bounds.xMax)) / (xRange * 0.05);
    const zRange = bounds.zMax - bounds.zMin;
    const zEdge = Math.min(Math.abs(z - bounds.zMin), Math.abs(z - bounds.zMax)) / (zRange * 0.05);
    const edgeFactor = Math.min(xEdge, zEdge, 1);
    if (edgeFactor < 1) {
      h = h * edgeFactor + (waterLevel - 4) * (1 - edgeFactor);
    }

    return Math.round(h);
  });

  const roads: TerrainResult['roads'] = [];
  const buildingZones: TerrainResult['buildingZones'] = [];

  // Build terrain
  for (let x = bounds.xMin; x <= bounds.xMax; x++) {
    for (let z = bounds.zMin; z <= bounds.zMax; z++) {
      const surfaceY = heightmap.get(x, z);
      const minY = bounds.yMin;
      const maxY = Math.max(surfaceY, waterLevel);

      for (let y = minY; y <= maxY; y++) {
        let mat: number;

        // Water
        if (y > surfaceY && y <= waterLevel) {
          mat = y === waterLevel ? MAT_WATER : MAT_WATER_DEEP;
        }
        // Beach surface
        else if (y === surfaceY && x < beachEnd && surfaceY <= waterLevel + 2) {
          mat = rng.next() < 0.6 ? MAT_SAND_LIGHT : MAT_SAND_DARK;
        }
        // Rocky outcroppings
        else if (y === surfaceY && surfaceY > waterLevel + 6) {
          mat = rng.next() < 0.4 ? MAT_STONE : MAT_GRASS_DARK;
        }
        // Grass surface
        else if (y === surfaceY) {
          mat = rng.next() < 0.7 ? MAT_GRASS : MAT_GRASS_DARK;
        }
        // Sub-surface beach
        else if (y >= surfaceY - 1 && x < beachEnd) {
          mat = MAT_SAND_DARK;
        }
        // Sub-surface
        else if (y >= surfaceY - 2) {
          mat = MAT_DIRT;
        } else {
          mat = MAT_STONE_DARK;
        }

        setVoxel(x, y, z, mat);
      }
    }
  }

  // Rocky outcroppings near shore
  const numRocks = Math.round(8 + rng.next() * 12);
  for (let i = 0; i < numRocks; i++) {
    const rx = rng.nextInt(bounds.xMin, beachEnd + 10);
    const rz = rng.nextInt(bounds.zMin + 5, bounds.zMax - 5);
    const baseH = heightmap.get(rx, rz);
    if (baseH > waterLevel + 4) continue; // only near shore
    const rockH = rng.nextInt(2, 5);
    const rockR = rng.nextInt(1, 3);

    for (let dx = -rockR; dx <= rockR; dx++) {
      for (let dz = -rockR; dz <= rockR; dz++) {
        if (dx * dx + dz * dz > rockR * rockR + 1) continue;
        const colH = rockH - Math.floor(Math.sqrt(dx * dx + dz * dz));
        for (let dy = 0; dy < colH; dy++) {
          setVoxel(rx + dx, baseH + 1 + dy, rz + dz, rng.next() < 0.5 ? MAT_STONE : MAT_STONE_DARK);
        }
      }
    }
  }

  // Inland roads (parallel to shore)
  const roadZ = Math.round((bounds.zMin + bounds.zMax) / 2);
  if (roadDensity > 0.2) {
    const roadX1 = beachEnd + 10;
    const roadX2 = bounds.xMax - 10;
    roads.push({ x: Math.round((roadX1 + roadX2) / 2), z: roadZ, direction: 'x' });

    // Lay the road surface
    for (let x = roadX1; x <= roadX2; x++) {
      for (let dz = -2; dz <= 2; dz++) {
        const surfY = heightmap.get(x, roadZ + dz);
        setVoxel(x, surfY, roadZ + dz, MAT_ROAD);
      }
    }
  }

  // Building zones inland (flat areas above water)
  const zoneSpacing = 35;
  for (let x = beachEnd + 15; x < bounds.xMax - 15; x += zoneSpacing) {
    for (let z = bounds.zMin + 15; z < bounds.zMax - 15; z += zoneSpacing) {
      const h = heightmap.get(x, z);
      if (h <= waterLevel + 1) continue;

      const h10 = heightmap.get(x + 10, z);
      const h01 = heightmap.get(x, z + 10);
      const maxDiff = Math.max(Math.abs(h - h10), Math.abs(h - h01));

      if (maxDiff <= 3 && rng.next() < buildingDensity) {
        buildingZones.push({ x, z, width: 10, depth: 10 });
      }
    }
  }

  return {
    setVoxel,
    roads,
    buildingZones,
    getHeight: (x, z) => heightmap.get(x, z),
  };
}

// ---------------------------------------------------------------------------
// INDUSTRIAL template
// ---------------------------------------------------------------------------

function generateIndustrial(
  config: TerrainConfig,
  setVoxel: (x: number, y: number, z: number, mat: number) => void,
): TerrainResult {
  const { bounds, seed } = config;
  const roadDensity = config.roadDensity ?? 0.5;
  const buildingDensity = config.buildingDensity ?? 0.6;
  const noise = createNoise2D(seed);
  const rng = createRng(seed + 23);

  // Very flat concrete terrain
  const baseY = Math.floor((bounds.yMax - bounds.yMin) * 0.15) + bounds.yMin;

  const heightmap = createHeightmap(bounds, (x, z) => {
    // Nearly flat with very minor variation
    const v = noise.noise(x / 100, z / 100) * 0.5;
    return Math.round(baseY + v);
  });

  // Road grid: main arteries
  const roadSpacing = Math.round(40 - roadDensity * 15); // 25-40 range
  const mainRoadWidth = 3;

  const xRoadPositions: number[] = [];
  const zRoadPositions: number[] = [];

  {
    const firstZ = bounds.zMin + Math.round(roadSpacing * 0.5);
    for (let z = firstZ; z <= bounds.zMax - roadSpacing * 0.3; z += roadSpacing) {
      xRoadPositions.push(z);
    }
  }
  {
    const firstX = bounds.xMin + Math.round(roadSpacing * 0.5);
    for (let x = firstX; x <= bounds.xMax - roadSpacing * 0.3; x += roadSpacing) {
      zRoadPositions.push(x);
    }
  }

  const isMainRoad = (x: number, z: number): boolean => {
    for (const rz of xRoadPositions) {
      if (Math.abs(z - rz) <= mainRoadWidth) return true;
    }
    for (const rx of zRoadPositions) {
      if (Math.abs(x - rx) <= mainRoadWidth) return true;
    }
    return false;
  };

  // Train tracks: two horizontal lines
  const trackZ1 = Math.round(bounds.zMin + (bounds.zMax - bounds.zMin) * 0.25);
  const trackZ2 = Math.round(bounds.zMin + (bounds.zMax - bounds.zMin) * 0.75);

  const isTrack = (x: number, z: number): boolean => {
    return Math.abs(z - trackZ1) <= 1 || Math.abs(z - trackZ2) <= 1;
  };

  const roads: TerrainResult['roads'] = [];
  const buildingZones: TerrainResult['buildingZones'] = [];

  // Collect road metadata
  for (const rz of xRoadPositions) {
    roads.push({ x: Math.round((bounds.xMin + bounds.xMax) / 2), z: rz, direction: 'x' });
  }
  for (const rx of zRoadPositions) {
    roads.push({ x: rx, z: Math.round((bounds.zMin + bounds.zMax) / 2), direction: 'z' });
  }

  // Perimeter fence positions
  const fenceInset = 5;
  const fenceXMin = bounds.xMin + fenceInset;
  const fenceXMax = bounds.xMax - fenceInset;
  const fenceZMin = bounds.zMin + fenceInset;
  const fenceZMax = bounds.zMax - fenceInset;

  const isFence = (x: number, z: number): boolean => {
    if (x === fenceXMin || x === fenceXMax) {
      return z >= fenceZMin && z <= fenceZMax;
    }
    if (z === fenceZMin || z === fenceZMax) {
      return x >= fenceXMin && x <= fenceXMax;
    }
    return false;
  };

  // Build terrain
  for (let x = bounds.xMin; x <= bounds.xMax; x++) {
    for (let z = bounds.zMin; z <= bounds.zMax; z++) {
      const surfaceY = heightmap.get(x, z);
      const minY = bounds.yMin;

      for (let y = minY; y <= surfaceY; y++) {
        let mat: number;

        if (y === surfaceY) {
          if (isMainRoad(x, z)) {
            mat = MAT_ROAD;
          } else if (isTrack(x, z)) {
            mat = MAT_METAL;
          } else {
            // Mostly concrete with occasional dirty patches
            mat = rng.next() < 0.85 ? MAT_CONCRETE : MAT_CONCRETE_DARK;
          }
        } else if (y >= surfaceY - 1) {
          mat = MAT_CONCRETE_DARK;
        } else {
          mat = MAT_STONE_DARK;
        }

        setVoxel(x, y, z, mat);
      }
    }
  }

  // Fence posts (metal pillars along perimeter)
  for (let x = fenceXMin; x <= fenceXMax; x++) {
    for (let z of [fenceZMin, fenceZMax]) {
      if (isMainRoad(x, z)) continue; // Gate opening at roads
      const surfY = heightmap.get(x, z);
      if (x % 3 === 0) {
        // Post every 3 voxels
        setVoxel(x, surfY + 1, z, MAT_METAL);
        setVoxel(x, surfY + 2, z, MAT_METAL);
      } else {
        // Chain link (just 1 high)
        setVoxel(x, surfY + 1, z, MAT_METAL);
      }
    }
  }
  for (let z = fenceZMin; z <= fenceZMax; z++) {
    for (let x of [fenceXMin, fenceXMax]) {
      if (isMainRoad(x, z)) continue;
      const surfY = heightmap.get(x, z);
      if (z % 3 === 0) {
        setVoxel(x, surfY + 1, z, MAT_METAL);
        setVoxel(x, surfY + 2, z, MAT_METAL);
      } else {
        setVoxel(x, surfY + 1, z, MAT_METAL);
      }
    }
  }

  // Loading docks: raised concrete platforms along certain roads
  const dockHeight = 2;
  const numDocks = rng.nextInt(3, 6);
  for (let i = 0; i < numDocks; i++) {
    const rx = rng.nextInt(bounds.xMin + 20, bounds.xMax - 20);
    const rz = rng.nextInt(bounds.zMin + 20, bounds.zMax - 20);
    if (isMainRoad(rx, rz) || isTrack(rx, rz)) continue;

    const dockW = rng.nextInt(6, 12);
    const dockD = rng.nextInt(4, 8);
    const dockBaseY = heightmap.get(rx, rz);

    for (let dx = 0; dx < dockW; dx++) {
      for (let dz = 0; dz < dockD; dz++) {
        for (let dy = 1; dy <= dockHeight; dy++) {
          setVoxel(rx + dx, dockBaseY + dy, rz + dz, MAT_CONCRETE_DARK);
        }
        // Flat top
        setVoxel(rx + dx, dockBaseY + dockHeight, rz + dz, MAT_CONCRETE);
      }
    }
  }

  // Train track detail: rails (metal) on top of gravel (stone_dark)
  for (let x = bounds.xMin; x <= bounds.xMax; x++) {
    for (const tz of [trackZ1, trackZ2]) {
      const surfY = heightmap.get(x, tz);
      // Gravel bed
      for (let dz = -2; dz <= 2; dz++) {
        setVoxel(x, surfY, tz + dz, MAT_STONE_DARK);
      }
      // Rail lines
      setVoxel(x, surfY + 1, tz - 1, MAT_METAL);
      setVoxel(x, surfY + 1, tz + 1, MAT_METAL);
      // Cross-ties every 3 voxels
      if (x % 3 === 0) {
        for (let dz = -1; dz <= 1; dz++) {
          setVoxel(x, surfY + 1, tz + dz, MAT_WOOD_DARK);
        }
        // Rails on top of ties
        setVoxel(x, surfY + 1, tz - 1, MAT_METAL);
        setVoxel(x, surfY + 1, tz + 1, MAT_METAL);
      }
    }
  }

  // Building zones: large warehouse-sized plots between roads
  for (let ri = 0; ri < zRoadPositions.length - 1; ri++) {
    for (let ci = 0; ci < xRoadPositions.length - 1; ci++) {
      const x1 = zRoadPositions[ri] + mainRoadWidth + 2;
      const x2 = zRoadPositions[ri + 1] - mainRoadWidth - 2;
      const z1 = xRoadPositions[ci] + mainRoadWidth + 2;
      const z2 = xRoadPositions[ci + 1] - mainRoadWidth - 2;

      const w = x2 - x1;
      const d = z2 - z1;

      if (w >= 8 && d >= 8 && rng.next() < buildingDensity) {
        buildingZones.push({ x: x1, z: z1, width: w, depth: d });
      }
    }
  }

  return {
    setVoxel,
    roads,
    buildingZones,
    getHeight: (x, z) => heightmap.get(x, z),
  };
}

// ---------------------------------------------------------------------------
// Main exported function
// ---------------------------------------------------------------------------

export function generateTerrain(
  config: TerrainConfig,
  setVoxel: (x: number, y: number, z: number, mat: number) => void,
): TerrainResult {
  switch (config.template) {
    case 'urban':
      return generateUrban(config, setVoxel);
    case 'desert':
      return generateDesert(config, setVoxel);
    case 'forest':
      return generateForest(config, setVoxel);
    case 'coastal':
      return generateCoastal(config, setVoxel);
    case 'industrial':
      return generateIndustrial(config, setVoxel);
    default: {
      const _exhaustive: never = config.template;
      throw new Error(`Unknown terrain template: ${_exhaustive}`);
    }
  }
}
