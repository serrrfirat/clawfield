/**
 * color-classifier.ts — Map RGB colors from voxels to game material IDs.
 *
 * Two passes:
 * 1. Semantic pass (palette 1-20): Rules based on color + spatial context
 * 2. Clustering pass (palette 33-255): k-means on remaining colors
 */

import type { VoxelGrid, ClassifiedGrid, RGB } from './types.js';

// Material constants (from packages/shared/src/constants.ts)
const MAT_AIR = 0;
const MAT_GRASS = 1;
const MAT_DIRT = 2;
const MAT_STONE = 3;
const MAT_WALL = 4;
const MAT_ROOF = 5;
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
const MAT_ROOF_TILE = 16;
const MAT_WATER_DEEP = 17;
const MAT_ROAD = 18;
const MAT_WINDOW = 19;
const MAT_METAL = 20;

const CHUNK_SIZE = 16;
const TERRAIN_PALETTE_MAX = 32;
const CLUSTER_PALETTE_START = 33;
const PALETTE_SIZE = 256;

// Default palette colors for material IDs (from constants.ts MATERIAL_COLORS)
const MATERIAL_PALETTE: Record<number, RGB> = {
  [MAT_GRASS]:         { r: 0x4a, g: 0x8c, b: 0x3f },
  [MAT_DIRT]:          { r: 0x7a, g: 0x5c, b: 0x3a },
  [MAT_STONE]:         { r: 0x88, g: 0x88, b: 0x88 },
  [MAT_WALL]:          { r: 0xa0, g: 0xa0, b: 0xa0 },
  [MAT_ROOF]:          { r: 0x55, g: 0x55, b: 0x55 },
  [MAT_WATER]:         { r: 0x23, g: 0x89, b: 0xda },
  [MAT_SAND_LIGHT]:    { r: 0xd4, g: 0xb8, b: 0x96 },
  [MAT_SAND_DARK]:     { r: 0xc4, g: 0xa6, b: 0x7a },
  [MAT_GRASS_DARK]:    { r: 0x4a, g: 0x7a, b: 0x33 },
  [MAT_STONE_DARK]:    { r: 0x66, g: 0x66, b: 0x66 },
  [MAT_CONCRETE]:      { r: 0xa0, g: 0xa0, b: 0xa0 },
  [MAT_CONCRETE_DARK]: { r: 0x80, g: 0x80, b: 0x80 },
  [MAT_WOOD]:          { r: 0x8b, g: 0x69, b: 0x14 },
  [MAT_WOOD_DARK]:     { r: 0x6b, g: 0x4f, b: 0x10 },
  [MAT_BRICK]:         { r: 0xa0, g: 0x52, b: 0x28 },
  [MAT_ROOF_TILE]:     { r: 0x8b, g: 0x45, b: 0x13 },
  [MAT_WATER_DEEP]:    { r: 0x1a, g: 0x4c, b: 0x80 },
  [MAT_ROAD]:          { r: 0x55, g: 0x55, b: 0x55 },
  [MAT_WINDOW]:        { r: 0x87, g: 0xce, b: 0xeb },
  [MAT_METAL]:         { r: 0x70, g: 0x80, b: 0x90 },
};

/**
 * Classify voxel colors into material IDs and build the palette.
 *
 * @param rawPalette  If true, skip semantic material rules and use pure k-means
 *                    clustering across all 255 palette slots. Best for photogrammetry
 *                    data where the actual RGB colors should be preserved.
 */
export function classifyColors(voxelGrid: VoxelGrid, rawPalette = false): ClassifiedGrid {
  console.log(`Classifying colors${rawPalette ? ' (raw palette mode)' : ''}...`);

  const palette: RGB[] = new Array(PALETTE_SIZE).fill(null).map(() => ({ r: 0, g: 0, b: 0 }));
  const classifiedChunks = new Map<string, Uint8Array>();

  for (const [chunkKey, chunkData] of voxelGrid.chunks) {
    classifiedChunks.set(chunkKey, new Uint8Array(chunkData.length));
  }

  if (rawPalette) {
    // Pure k-means mode: use slots 1-255 for clustering, no semantic rules
    return classifyRawPalette(voxelGrid, palette, classifiedChunks);
  }

  // --- Semantic + cluster mode (original behavior) ---

  // Fill terrain palette (1-20) with known material colors
  for (const [matId, color] of Object.entries(MATERIAL_PALETTE)) {
    palette[Number(matId)] = { ...color };
  }

  const uniqueColors: Map<string, { color: RGB; count: number }> = new Map();
  const unclassifiedVoxels: { key: string; wx: number; wy: number; wz: number; color: RGB }[] = [];

  const ySurface = findGroundLevel(voxelGrid);
  console.log(`  Estimated ground level: Y=${ySurface}`);

  let classifiedCount = 0;
  let unclassifiedCount = 0;

  for (const [posKey, color] of voxelGrid.colorMap) {
    const [wx, wy, wz] = posKey.split(',').map(Number);
    const matId = classifyVoxel(color, wx, wy, wz, ySurface, voxelGrid);

    if (matId > 0) {
      setChunkVoxel(classifiedChunks, wx, wy, wz, matId);
      classifiedCount++;
    } else {
      const colorKey = `${color.r >> 3},${color.g >> 3},${color.b >> 3}`;
      const existing = uniqueColors.get(colorKey);
      if (existing) {
        existing.count++;
      } else {
        uniqueColors.set(colorKey, { color: { ...color }, count: 1 });
      }
      unclassifiedVoxels.push({ key: posKey, wx, wy, wz, color });
      unclassifiedCount++;
    }
  }

  console.log(`  Semantic pass: ${classifiedCount} classified, ${unclassifiedCount} remaining`);

  if (unclassifiedVoxels.length > 0) {
    const maxClusters = PALETTE_SIZE - CLUSTER_PALETTE_START;
    const clusterCount = Math.min(maxClusters, uniqueColors.size, 200);

    const clusterColors = kMeansClusters(
      Array.from(uniqueColors.values()).map(v => v.color),
      clusterCount,
    );

    for (let i = 0; i < clusterColors.length; i++) {
      palette[CLUSTER_PALETTE_START + i] = clusterColors[i];
    }

    for (const voxel of unclassifiedVoxels) {
      let bestIdx = CLUSTER_PALETTE_START;
      let bestDist = Infinity;
      for (let i = 0; i < clusterColors.length; i++) {
        const dist = colorDistance(voxel.color, clusterColors[i]);
        if (dist < bestDist) {
          bestDist = dist;
          bestIdx = CLUSTER_PALETTE_START + i;
        }
      }
      setChunkVoxel(classifiedChunks, voxel.wx, voxel.wy, voxel.wz, bestIdx);
    }

    console.log(`  Cluster pass: ${clusterColors.length} clusters for ${unclassifiedVoxels.length} voxels`);
  }

  // Ensure uncolored solids get a material
  for (const [chunkKey, origData] of voxelGrid.chunks) {
    const classData = classifiedChunks.get(chunkKey);
    if (!classData) continue;
    for (let i = 0; i < origData.length; i++) {
      if (origData[i] > 0 && classData[i] === 0) {
        classData[i] = MAT_CONCRETE;
      }
    }
  }

  return {
    chunks: classifiedChunks,
    palette,
    bounds: voxelGrid.bounds,
  };
}

/**
 * Raw palette mode: skip semantic rules, use all 255 palette slots for k-means.
 * Preserves actual photogrammetry colors from the source data.
 */
function classifyRawPalette(
  voxelGrid: VoxelGrid,
  palette: RGB[],
  classifiedChunks: Map<string, Uint8Array>,
): ClassifiedGrid {
  // Collect all unique colors (quantized to 5-bit for clustering efficiency)
  const uniqueColors: Map<string, { color: RGB; count: number }> = new Map();

  for (const [, color] of voxelGrid.colorMap) {
    const colorKey = `${color.r >> 3},${color.g >> 3},${color.b >> 3}`;
    const existing = uniqueColors.get(colorKey);
    if (existing) {
      existing.count++;
    } else {
      uniqueColors.set(colorKey, { color: { ...color }, count: 1 });
    }
  }

  console.log(`  Unique colors (quantized): ${uniqueColors.size}`);

  // Use slots 1-255 for k-means (slot 0 = air)
  const maxClusters = PALETTE_SIZE - 1;
  const clusterCount = Math.min(maxClusters, uniqueColors.size, 255);

  const clusterColors = kMeansClusters(
    Array.from(uniqueColors.values()).map(v => v.color),
    clusterCount,
  );

  // Write cluster colors into palette starting at slot 1
  for (let i = 0; i < clusterColors.length; i++) {
    palette[1 + i] = clusterColors[i];
  }

  console.log(`  k-means: ${clusterCount} clusters`);

  // Assign every voxel to its nearest cluster
  let assigned = 0;
  for (const [posKey, color] of voxelGrid.colorMap) {
    const [wx, wy, wz] = posKey.split(',').map(Number);

    let bestIdx = 1;
    let bestDist = Infinity;
    for (let i = 0; i < clusterColors.length; i++) {
      const dist = colorDistance(color, clusterColors[i]);
      if (dist < bestDist) {
        bestDist = dist;
        bestIdx = 1 + i;
      }
    }

    setChunkVoxel(classifiedChunks, wx, wy, wz, bestIdx);
    assigned++;
  }

  // Fill uncolored solids with nearest gray cluster
  const defaultGray: RGB = { r: 160, g: 160, b: 160 };
  let defaultIdx = 1;
  let defaultDist = Infinity;
  for (let i = 0; i < clusterColors.length; i++) {
    const dist = colorDistance(defaultGray, clusterColors[i]);
    if (dist < defaultDist) {
      defaultDist = dist;
      defaultIdx = 1 + i;
    }
  }

  for (const [chunkKey, origData] of voxelGrid.chunks) {
    const classData = classifiedChunks.get(chunkKey);
    if (!classData) continue;
    for (let i = 0; i < origData.length; i++) {
      if (origData[i] > 0 && classData[i] === 0) {
        classData[i] = defaultIdx;
      }
    }
  }

  console.log(`  Assigned ${assigned} voxels to ${clusterCount} color clusters`);

  return {
    chunks: classifiedChunks,
    palette,
    bounds: voxelGrid.bounds,
  };
}

// ---------------------------------------------------------------------------
// Semantic classification rules
// ---------------------------------------------------------------------------

function classifyVoxel(
  color: RGB,
  wx: number, wy: number, wz: number,
  groundY: number,
  grid: VoxelGrid,
): number {
  const brightness = (color.r + color.g + color.b) / 3;
  const saturation = Math.max(color.r, color.g, color.b) - Math.min(color.r, color.g, color.b);
  const isAtGround = Math.abs(wy - groundY) <= 2;
  const isBelowGround = wy < groundY - 2;
  const isAboveGround = wy > groundY + 3;
  const isHighUp = wy > groundY + 20;

  // Green tones → Grass
  if (color.g > color.r * 1.3 && color.g > color.b * 1.3 && saturation > 30) {
    if (brightness < 100) return MAT_GRASS_DARK;
    return MAT_GRASS;
  }

  // Blue tones at low elevation → Water
  if (color.b > color.r * 1.4 && color.b > color.g * 1.2 && isAtGround) {
    if (brightness < 80) return MAT_WATER_DEEP;
    return MAT_WATER;
  }

  // Blue on walls → Window
  if (color.b > color.r * 1.3 && color.b > color.g * 1.1 && isAboveGround && saturation > 40) {
    return MAT_WINDOW;
  }

  // Dark gray at ground → Road
  if (isAtGround && saturation < 25 && brightness >= 40 && brightness <= 100) {
    return MAT_ROAD;
  }

  // Brown at ground → Dirt
  if (isAtGround && color.r > color.b * 1.3 && color.g < color.r && brightness < 140) {
    return MAT_DIRT;
  }

  // Warm beige at ground → Sand
  if (isAtGround && color.r > 150 && color.g > 130 && color.b < color.r * 0.8) {
    if (brightness > 180) return MAT_SAND_LIGHT;
    return MAT_SAND_DARK;
  }

  // Red/brown on walls → Brick
  if (isAboveGround && color.r > color.g * 1.4 && color.r > color.b * 1.5 && saturation > 40) {
    return MAT_BRICK;
  }

  // Brown on walls → Wood
  if (isAboveGround && color.r > color.b * 1.3 && color.g > color.b && saturation > 20 && brightness < 150) {
    if (brightness < 80) return MAT_WOOD_DARK;
    return MAT_WOOD;
  }

  // Gray at height → Concrete or Metal
  if (isAboveGround && saturation < 20) {
    if (isHighUp) return MAT_ROOF;
    if (brightness < 100) return MAT_CONCRETE_DARK;
    if (brightness < 140) return MAT_CONCRETE;
    if (color.b > color.r && color.b > color.g) return MAT_METAL;
    return MAT_WALL;
  }

  // Gray/dark at ground → Stone
  if (isAtGround && saturation < 20 && brightness > 100) {
    if (brightness < 140) return MAT_STONE_DARK;
    return MAT_STONE;
  }

  // Nothing matched → unclassified
  return 0;
}

function findGroundLevel(grid: VoxelGrid): number {
  // Find the Y level with the most voxels (likely ground)
  const yHistogram = new Map<number, number>();

  for (const [posKey] of grid.colorMap) {
    const parts = posKey.split(',');
    const wy = Number(parts[1]);
    yHistogram.set(wy, (yHistogram.get(wy) ?? 0) + 1);
  }

  let maxCount = 0;
  let groundY = 0;
  for (const [y, count] of yHistogram) {
    if (count > maxCount) {
      maxCount = count;
      groundY = y;
    }
  }

  return groundY;
}

// ---------------------------------------------------------------------------
// k-means clustering
// ---------------------------------------------------------------------------

function kMeansClusters(colors: RGB[], k: number): RGB[] {
  if (colors.length <= k) return colors;

  // Initialize centroids with k-means++ seeding
  const centroids: RGB[] = [];
  centroids.push({ ...colors[Math.floor(Math.random() * colors.length)] });

  for (let i = 1; i < k; i++) {
    const distances = colors.map(c => {
      let minDist = Infinity;
      for (const cent of centroids) {
        const d = colorDistance(c, cent);
        if (d < minDist) minDist = d;
      }
      return minDist;
    });

    const totalDist = distances.reduce((sum, d) => sum + d, 0);
    let threshold = Math.random() * totalDist;
    let selectedIdx = 0;
    for (let j = 0; j < distances.length; j++) {
      threshold -= distances[j];
      if (threshold <= 0) { selectedIdx = j; break; }
    }
    centroids.push({ ...colors[selectedIdx] });
  }

  // Run k-means iterations
  const assignments = new Array(colors.length).fill(0);
  const maxIterations = 20;

  for (let iter = 0; iter < maxIterations; iter++) {
    let changed = false;

    // Assignment step
    for (let ci = 0; ci < colors.length; ci++) {
      let bestCluster = 0;
      let bestDist = Infinity;
      for (let ki = 0; ki < k; ki++) {
        const d = colorDistance(colors[ci], centroids[ki]);
        if (d < bestDist) { bestDist = d; bestCluster = ki; }
      }
      if (assignments[ci] !== bestCluster) { changed = true; assignments[ci] = bestCluster; }
    }

    if (!changed) break;

    // Update step
    for (let ki = 0; ki < k; ki++) {
      let sumR = 0, sumG = 0, sumB = 0, count = 0;
      for (let ci = 0; ci < colors.length; ci++) {
        if (assignments[ci] === ki) {
          sumR += colors[ci].r; sumG += colors[ci].g; sumB += colors[ci].b;
          count++;
        }
      }
      if (count > 0) {
        centroids[ki] = {
          r: Math.round(sumR / count),
          g: Math.round(sumG / count),
          b: Math.round(sumB / count),
        };
      }
    }
  }

  return centroids;
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function colorDistance(a: RGB, b: RGB): number {
  const dr = a.r - b.r;
  const dg = a.g - b.g;
  const db = a.b - b.b;
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

function setChunkVoxel(
  chunks: Map<string, Uint8Array>,
  wx: number, wy: number, wz: number,
  value: number,
): void {
  const cx = Math.floor(wx / CHUNK_SIZE);
  const cy = Math.floor(wy / CHUNK_SIZE);
  const cz = Math.floor(wz / CHUNK_SIZE);
  const key = `${cx},${cy},${cz}`;

  let chunk = chunks.get(key);
  if (!chunk) {
    chunk = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE * CHUNK_SIZE);
    chunks.set(key, chunk);
  }

  const lx = ((wx % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
  const ly = ((wy % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
  const lz = ((wz % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
  chunk[lx + ly * CHUNK_SIZE + lz * CHUNK_SIZE * CHUNK_SIZE] = value;
}
