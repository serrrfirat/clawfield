/**
 * map-compose.ts
 *
 * Reads a .mapdef.json file + component registry, generates procedural
 * terrain, places components, merges palettes, and outputs a CLWF .map
 * binary + palette + metadata.
 *
 * Usage:
 *   npx tsx tools/map-compose.ts <mapdef.json>
 *
 * Example:
 *   npx tsx tools/map-compose.ts assets/maps/shoreline.mapdef.json
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CHUNK_SIZE = 16;
const CHUNK_VOXEL_COUNT = CHUNK_SIZE ** 3;
const MAGIC = 'CLWF';
const VERSION = 1;
const PALETTE_SIZE = 256;
const HEADER_SIZE = 4 + 1 + 4 + 2 + PALETTE_SIZE * 3;
const CHUNK_RECORD_SIZE = 6 + CHUNK_VOXEL_COUNT;

// Terrain palette occupies indices 1-32, components get 33-255
const TERRAIN_PALETTE_MAX = 32;
const COMPONENT_PALETTE_START = 33;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface RGB { r: number; g: number; b: number }

interface MapdefBounds {
  xMin: number; xMax: number;
  yMin: number; yMax: number;
  zMin: number; zMax: number;
}

interface TerrainConfig {
  generator: string;
  waterLevel: number;
  seed?: number;
}

interface Placement {
  componentId: string;
  position: { x: number; y: number; z: number };
  rotation: number; // 0, 90, 180, 270
  terrainCarve?: boolean;
}

interface Mapdef {
  name: string;
  bounds: MapdefBounds;
  terrain: TerrainConfig;
  terrainPalette: Record<string, { index: number; r: number; g: number; b: number }>;
  placements: Placement[];
  metadata: {
    spawnPoints?: Record<string, { x: number; y: number; z: number }[]>;
    capturePoints?: { id: string; position: { x: number; y: number; z: number }; initialOwner: number }[];
    objectives?: { id: string; type: string; position: { x: number; y: number; z: number } }[];
  };
}

interface ComponentFile {
  name: string;
  version: number;
  bounds: { sizeX: number; sizeY: number; sizeZ: number };
  origin: { x: number; y: number; z: number };
  palette: { r: number; g: number; b: number }[];
  usedColors: number[];
  voxels: { x: number; y: number; z: number; c: number }[];
}

interface RegistryEntry {
  id: string;
  componentPath: string;
}

interface Registry {
  version: number;
  components: RegistryEntry[];
}

// ---------------------------------------------------------------------------
// Chunk map
// ---------------------------------------------------------------------------

const chunks = new Map<string, Uint8Array>();

function localIndex(lx: number, ly: number, lz: number): number {
  return lx + ly * CHUNK_SIZE + lz * CHUNK_SIZE * CHUNK_SIZE;
}

function setVoxel(wx: number, wy: number, wz: number, value: number): void {
  const cx = Math.floor(wx / CHUNK_SIZE);
  const cy = Math.floor(wy / CHUNK_SIZE);
  const cz = Math.floor(wz / CHUNK_SIZE);
  const key = `${cx},${cy},${cz}`;
  const lx = ((wx % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
  const ly = ((wy % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
  const lz = ((wz % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
  let chunk = chunks.get(key);
  if (!chunk) {
    chunk = new Uint8Array(CHUNK_VOXEL_COUNT);
    chunks.set(key, chunk);
  }
  chunk[localIndex(lx, ly, lz)] = value;
}

function getVoxel(wx: number, wy: number, wz: number): number {
  const cx = Math.floor(wx / CHUNK_SIZE);
  const cy = Math.floor(wy / CHUNK_SIZE);
  const cz = Math.floor(wz / CHUNK_SIZE);
  const key = `${cx},${cy},${cz}`;
  const lx = ((wx % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
  const ly = ((wy % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
  const lz = ((wz % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
  const chunk = chunks.get(key);
  if (!chunk) return 0;
  return chunk[localIndex(lx, ly, lz)];
}

function fillBox(
  x1: number, y1: number, z1: number,
  x2: number, y2: number, z2: number,
  value: number
): void {
  const minX = Math.min(x1, x2), maxX = Math.max(x1, x2);
  const minY = Math.min(y1, y2), maxY = Math.max(y1, y2);
  const minZ = Math.min(z1, z2), maxZ = Math.max(z1, z2);
  for (let x = minX; x <= maxX; x++) {
    for (let z = minZ; z <= maxZ; z++) {
      for (let y = minY; y <= maxY; y++) {
        setVoxel(x, y, z, value);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Palette management
// ---------------------------------------------------------------------------

const unifiedPalette: RGB[] = new Array(PALETTE_SIZE);
let nextFreeIndex = COMPONENT_PALETTE_START;

function initPalette(): void {
  for (let i = 0; i < PALETTE_SIZE; i++) {
    unifiedPalette[i] = { r: 0, g: 0, b: 0 };
  }
}

function setTerrainPalette(terrainPalette: Record<string, { index: number; r: number; g: number; b: number }>): void {
  for (const [, entry] of Object.entries(terrainPalette)) {
    if (entry.index >= 1 && entry.index <= TERRAIN_PALETTE_MAX) {
      unifiedPalette[entry.index] = { r: entry.r, g: entry.g, b: entry.b };
    }
  }
}

function colorDistance(a: RGB, b: RGB): number {
  const dr = a.r - b.r;
  const dg = a.g - b.g;
  const db = a.b - b.b;
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

function findOrAllocateColor(color: RGB): number {
  // Search existing unified palette for close match
  for (let i = 1; i < nextFreeIndex; i++) {
    if (colorDistance(unifiedPalette[i], color) <= 4) {
      return i;
    }
  }

  // Allocate new index
  if (nextFreeIndex < PALETTE_SIZE) {
    const idx = nextFreeIndex;
    unifiedPalette[idx] = { ...color };
    nextFreeIndex++;
    return idx;
  }

  // Overflow: find nearest existing color
  let bestIdx = 1;
  let bestDist = Infinity;
  for (let i = 1; i < PALETTE_SIZE; i++) {
    const d = colorDistance(unifiedPalette[i], color);
    if (d < bestDist) {
      bestDist = d;
      bestIdx = i;
    }
  }
  return bestIdx;
}

function buildRemapTable(componentPalette: RGB[]): Uint8Array {
  const remap = new Uint8Array(256);
  remap[0] = 0; // air stays air
  for (let i = 1; i < componentPalette.length && i < 256; i++) {
    const c = componentPalette[i];
    // Skip black/empty colors (unused palette entries)
    if (c.r === 0 && c.g === 0 && c.b === 0) {
      remap[i] = 0;
      continue;
    }
    remap[i] = findOrAllocateColor(c);
  }
  return remap;
}

// ---------------------------------------------------------------------------
// Terrain generation (Shoreline heightmap — ported from shoreline-gen.ts)
// ---------------------------------------------------------------------------

function heightAtShoreline(x: number, z: number, bounds: MapdefBounds): number {
  const normalized = (x - bounds.xMin) / (bounds.xMax - bounds.xMin);
  let h = 2 + normalized * 6;

  if (x < -50) {
    const beachFactor = (-50 - x) / 80;
    h = h * (1 - beachFactor) + (-2) * beachFactor;
  }

  const zEdgeDist = Math.min(Math.abs(z - bounds.zMin), Math.abs(z - bounds.zMax));
  if (zEdgeDist < 15) {
    const edgeFactor = 1 - zEdgeDist / 15;
    h -= edgeFactor * (h + 2);
  }

  const dxN = (x - 60) / 40;
  const dzN = (z - (-70)) / 35;
  const distN = dxN * dxN + dzN * dzN;
  if (distN < 1) {
    h += (1 - distN) * 6;
  }

  const dxS = (x - 58) / 35;
  const dzS = (z - 60) / 30;
  const distS = dxS * dxS + dzS * dzS;
  if (distS < 1) {
    h += (1 - distS) * 5;
  }

  h += Math.sin(x / 20) * Math.cos(z / 15) * 1.5;
  h += Math.sin(x / 11 + 0.5) * Math.cos(z / 9 + 0.3) * 0.7;

  return Math.round(h);
}

function heightAtGeneric(x: number, z: number, bounds: MapdefBounds, seed: number): number {
  // Base height: gentle rolling hills centered around y=3, amplitude ~2
  let h = 3;

  // Seed-based sine offsets for variety
  const s = seed * 0.1;
  h += Math.sin(x / 25 + s) * Math.cos(z / 20 + s * 0.7) * 1.5;
  h += Math.sin(x / 13 + s * 1.3) * Math.cos(z / 11 + s * 0.4) * 0.8;
  h += Math.sin(x / 40 + s * 0.5) * Math.cos(z / 35 + s * 1.1) * 0.5;

  // Gentle edge drop-off at map borders (cosmetic, still stays positive)
  const xRange = bounds.xMax - bounds.xMin;
  const zRange = bounds.zMax - bounds.zMin;
  const xEdgeDist = Math.min(Math.abs(x - bounds.xMin), Math.abs(x - bounds.xMax));
  const zEdgeDist = Math.min(Math.abs(z - bounds.zMin), Math.abs(z - bounds.zMax));
  const edgeDist = Math.min(xEdgeDist / (xRange * 0.1), zEdgeDist / (zRange * 0.1), 1);
  if (edgeDist < 1) {
    h = h * edgeDist + 1 * (1 - edgeDist);
  }

  // Clamp to ensure all heights stay well above 0 (no accidental water)
  h = Math.max(1, h);

  return Math.round(h);
}

// Current map context — set during main() to gate Shoreline vs generic behavior
let currentMapName = '';
let currentSeed = 0;

function heightAt(x: number, z: number, bounds: MapdefBounds): number {
  if (currentMapName === 'Shoreline') {
    return heightAtShoreline(x, z, bounds);
  }
  return heightAtGeneric(x, z, bounds, currentSeed);
}

function generateTerrain(
  bounds: MapdefBounds,
  terrainPalette: Record<string, { index: number; r: number; g: number; b: number }>,
  waterLevel: number,
): void {
  console.log('  Generating terrain...');

  // Build palette index lookup
  const P: Record<string, number> = {};
  for (const [name, entry] of Object.entries(terrainPalette)) {
    P[name] = entry.index;
  }

  // Detect desert: no water means arid/desert map
  const isDesert = waterLevel < 0;

  for (let x = bounds.xMin; x <= bounds.xMax; x++) {
    for (let z = bounds.zMin; z <= bounds.zMax; z++) {
      const surfaceY = heightAt(x, z, bounds);
      const minY = Math.max(bounds.yMin, -4);
      const maxY = Math.max(surfaceY, waterLevel);

      for (let y = minY; y <= maxY; y++) {
        let mat: number;

        // Water
        if (surfaceY <= waterLevel && y <= waterLevel && y > surfaceY) {
          mat = y === waterLevel ? (P.water ?? P.WATER ?? 6) : (P.waterDeep ?? P.WATER_DEEP ?? 17);
        }
        // Beach sand (Shoreline-specific, skip for desert)
        else if (!isDesert && x < -40 && surfaceY <= 2 && y <= surfaceY) {
          mat = y === surfaceY
            ? (P.sandLight ?? P.SAND_LIGHT ?? 7)
            : (y === surfaceY - 1
              ? (P.sandDark ?? P.SAND_DARK ?? 8)
              : (P.dirt ?? P.DIRT ?? 2));
        }
        // Surface
        else if (y === surfaceY) {
          if (isDesert) {
            mat = (x + z) % 3 === 0 ? (P.sandDark ?? P.SAND_DARK ?? 8) : (P.sandLight ?? P.SAND_LIGHT ?? 7);
          } else if (surfaceY <= 2) {
            mat = P.grass ?? P.GRASS ?? 1;
          } else if (surfaceY <= 5) {
            mat = (x + z) % 3 === 0 ? (P.grassDark ?? P.GRASS_DARK ?? 9) : (P.grass ?? P.GRASS ?? 1);
          } else {
            mat = (x + z) % 2 === 0 ? (P.stone ?? P.STONE ?? 3) : (P.grassDark ?? P.GRASS_DARK ?? 9);
          }
        }
        // Sub-surface
        else if (y >= surfaceY - 2) {
          mat = isDesert ? (P.sandDark ?? P.SAND_DARK ?? 8) : (P.dirt ?? P.DIRT ?? 2);
        } else {
          mat = P.stoneDark ?? P.STONE_DARK ?? 10;
        }

        setVoxel(x, y, z, mat);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Structure generation (ported from shoreline-gen.ts)
// ---------------------------------------------------------------------------

function generateRoads(bounds: MapdefBounds, P: Record<string, number>): void {
  console.log('  Generating roads...');
  for (let x = -60; x <= 80; x++) {
    for (let zOff = -2; zOff <= 2; zOff++) {
      const z = 0 + zOff;
      const surfaceY = heightAt(x, z, bounds);
      setVoxel(x, surfaceY, z, P.road ?? P.ROAD ?? 18);
      for (let y = surfaceY + 1; y <= surfaceY + 4; y++) {
        setVoxel(x, y, z, 0);
      }
    }
  }

  for (let z = 10; z <= 55; z++) {
    for (let xOff = -1; xOff <= 1; xOff++) {
      const x = 50 + xOff;
      const surfaceY = heightAt(x, z, bounds);
      setVoxel(x, surfaceY, z, P.road ?? P.ROAD ?? 18);
      for (let y = surfaceY + 1; y <= surfaceY + 4; y++) {
        setVoxel(x, y, z, 0);
      }
    }
  }
}

interface BuildingSpec {
  x: number; z: number; w: number; d: number; h: number;
  stories: number; material: number; roofMaterial: number;
  hasDoors: boolean; hasWindows: boolean; hasBalcony?: boolean;
}

function makeBuilding(spec: BuildingSpec, bounds: MapdefBounds, P: Record<string, number>): void {
  const baseY = heightAt(spec.x + Math.floor(spec.w / 2), spec.z + Math.floor(spec.d / 2), bounds);

  for (let story = 0; story < spec.stories; story++) {
    const floorY = baseY + story * spec.h;
    fillBox(spec.x, floorY, spec.z, spec.x + spec.w - 1, floorY, spec.z + spec.d - 1, spec.material);

    for (let y = floorY + 1; y <= floorY + spec.h - 1; y++) {
      for (let x = spec.x; x < spec.x + spec.w; x++) {
        setVoxel(x, y, spec.z, spec.material);
        setVoxel(x, y, spec.z + spec.d - 1, spec.material);
      }
      for (let z = spec.z; z < spec.z + spec.d; z++) {
        setVoxel(spec.x, y, z, spec.material);
        setVoxel(spec.x + spec.w - 1, y, z, spec.material);
      }
    }

    if (spec.hasWindows) {
      const windowColor = P.window ?? P.WINDOW ?? 19;
      for (let wy = floorY + 2; wy <= floorY + 3; wy++) {
        for (let x = spec.x + 2; x < spec.x + spec.w - 1; x += 3) {
          setVoxel(x, wy, spec.z, windowColor);
          setVoxel(x, wy, spec.z + spec.d - 1, windowColor);
        }
        for (let z = spec.z + 2; z < spec.z + spec.d - 1; z += 3) {
          setVoxel(spec.x, wy, z, windowColor);
          setVoxel(spec.x + spec.w - 1, wy, z, windowColor);
        }
      }
    }

    if (spec.hasDoors && story === 0) {
      const doorX = spec.x + Math.floor(spec.w / 2);
      for (let dy = 1; dy <= 2; dy++) {
        setVoxel(doorX, floorY + dy, spec.z, 0);
        setVoxel(doorX + 1, floorY + dy, spec.z, 0);
      }
      for (let dy = 1; dy <= 2; dy++) {
        setVoxel(doorX, floorY + dy, spec.z + spec.d - 1, 0);
      }
    }
  }

  const roofY = baseY + spec.stories * spec.h;
  fillBox(spec.x - 1, roofY, spec.z - 1, spec.x + spec.w, roofY, spec.z + spec.d, spec.roofMaterial);

  if (spec.hasBalcony && spec.stories >= 2) {
    const woodColor = P.wood ?? P.WOOD ?? 13;
    const woodDark = P.woodDark ?? P.WOOD_DARK ?? 14;
    const balconyY = baseY + spec.h;
    fillBox(spec.x, balconyY, spec.z - 2, spec.x + spec.w - 1, balconyY, spec.z - 1, woodColor);
    for (let x = spec.x; x < spec.x + spec.w; x++) {
      setVoxel(x, balconyY + 1, spec.z - 2, woodDark);
    }
    for (let z = spec.z - 2; z <= spec.z - 1; z++) {
      setVoxel(spec.x, balconyY + 1, z, woodDark);
      setVoxel(spec.x + spec.w - 1, balconyY + 1, z, woodDark);
    }
  }
}

function generateBuildings(bounds: MapdefBounds, P: Record<string, number>): void {
  console.log('  Generating buildings...');

  makeBuilding({ x: -60, z: -16, w: 14, d: 8, h: 6, stories: 1, material: P.concrete ?? P.CONCRETE ?? 11, roofMaterial: P.metal ?? P.METAL ?? 20, hasDoors: true, hasWindows: false }, bounds, P);
  makeBuilding({ x: -46, z: 4, w: 10, d: 8, h: 5, stories: 1, material: P.concreteDark ?? P.CONCRETE_DARK ?? 12, roofMaterial: P.metal ?? P.METAL ?? 20, hasDoors: true, hasWindows: false }, bounds, P);

  const dockBaseY = heightAt(-65, 0, bounds);
  fillBox(-70, dockBaseY, -2, -62, dockBaseY, 2, P.stone ?? P.STONE ?? 3);
  fillBox(-80, dockBaseY - 1, -1, -70, dockBaseY, 1, P.stone ?? P.STONE ?? 3);

  makeBuilding({ x: -2, z: -20, w: 8, d: 10, h: 4, stories: 3, material: P.brick ?? P.BRICK ?? 15, roofMaterial: P.roofTile ?? P.ROOF_TILE ?? 16, hasDoors: true, hasWindows: true }, bounds, P);
  makeBuilding({ x: 10, z: 2, w: 10, d: 8, h: 5, stories: 2, material: P.concrete ?? P.CONCRETE ?? 11, roofMaterial: P.roofTile ?? P.ROOF_TILE ?? 16, hasDoors: true, hasWindows: true, hasBalcony: true }, bounds, P);
  makeBuilding({ x: -8, z: 12, w: 6, d: 6, h: 4, stories: 1, material: P.wood ?? P.WOOD ?? 13, roofMaterial: P.woodDark ?? P.WOOD_DARK ?? 14, hasDoors: true, hasWindows: true }, bounds, P);
  makeBuilding({ x: 22, z: -12, w: 7, d: 7, h: 4, stories: 2, material: P.brick ?? P.BRICK ?? 15, roofMaterial: P.roofTile ?? P.ROOF_TILE ?? 16, hasDoors: true, hasWindows: true }, bounds, P);
  makeBuilding({ x: -12, z: -6, w: 8, d: 6, h: 4, stories: 2, material: P.concreteDark ?? P.CONCRETE_DARK ?? 12, roofMaterial: P.metal ?? P.METAL ?? 20, hasDoors: true, hasWindows: true }, bounds, P);
}

function generateFort(bounds: MapdefBounds, P: Record<string, number>): void {
  console.log('  Generating hilltop fort...');
  const fortX = 50, fortZ = 52, fortW = 16, fortD = 16;
  const baseY = heightAt(fortX + 8, fortZ + 8, bounds);
  const stoneColor = P.stone ?? P.STONE ?? 3;
  const stoneDark = P.stoneDark ?? P.STONE_DARK ?? 10;
  const grassColor = P.grass ?? P.GRASS ?? 1;
  const dirtColor = P.dirt ?? P.DIRT ?? 2;
  const woodColor = P.wood ?? P.WOOD ?? 13;

  for (let x = fortX - 2; x <= fortX + fortW + 2; x++) {
    for (let z = fortZ - 2; z <= fortZ + fortD + 2; z++) {
      const surfY = heightAt(x, z, bounds);
      for (let y = surfY + 1; y <= baseY; y++) setVoxel(x, y, z, dirtColor);
      setVoxel(x, baseY, z, grassColor);
      for (let y = baseY + 1; y <= baseY + 15; y++) setVoxel(x, y, z, 0);
    }
  }

  const wallH = 4;
  for (let y = baseY + 1; y <= baseY + wallH; y++) {
    for (let x = fortX; x < fortX + fortW; x++) {
      setVoxel(x, y, fortZ, stoneColor);
      setVoxel(x, y, fortZ + fortD - 1, stoneColor);
    }
    for (let z = fortZ; z < fortZ + fortD; z++) {
      setVoxel(fortX, y, z, stoneColor);
      setVoxel(fortX + fortW - 1, y, z, stoneColor);
    }
  }

  for (let x = fortX; x < fortX + fortW; x += 2) {
    setVoxel(x, baseY + wallH + 1, fortZ, stoneColor);
    setVoxel(x, baseY + wallH + 1, fortZ + fortD - 1, stoneColor);
  }
  for (let z = fortZ; z < fortZ + fortD; z += 2) {
    setVoxel(fortX, baseY + wallH + 1, z, stoneColor);
    setVoxel(fortX + fortW - 1, baseY + wallH + 1, z, stoneColor);
  }

  for (let dy = 1; dy <= 3; dy++) {
    setVoxel(fortX + 7, baseY + dy, fortZ, 0);
    setVoxel(fortX + 8, baseY + dy, fortZ, 0);
    setVoxel(fortX, baseY + dy, fortZ + 7, 0);
    setVoxel(fortX, baseY + dy, fortZ + 8, 0);
  }

  const towerX = fortX + fortW - 5, towerZ = fortZ + fortD - 5, towerH = 10;
  for (let y = baseY + 1; y <= baseY + towerH; y++) {
    for (let x = towerX; x < towerX + 4; x++) {
      setVoxel(x, y, towerZ, stoneDark);
      setVoxel(x, y, towerZ + 3, stoneDark);
    }
    for (let z = towerZ; z < towerZ + 4; z++) {
      setVoxel(towerX, y, z, stoneDark);
      setVoxel(towerX + 3, y, z, stoneDark);
    }
  }

  for (let level = 3; level <= towerH; level += 3) {
    fillBox(towerX + 1, baseY + level, towerZ + 1, towerX + 2, baseY + level, towerZ + 2, woodColor);
    setVoxel(towerX + 1, baseY + level, towerZ + 1, 0);
  }

  fillBox(towerX - 1, baseY + towerH + 1, towerZ - 1, towerX + 4, baseY + towerH + 1, towerZ + 4, stoneColor);
}

function generateBridge(bounds: MapdefBounds, P: Record<string, number>): void {
  console.log('  Generating bridge...');
  const bridgeX = 48, bridgeW = 4, bridgeY = 10, zStart = 25, zEnd = 50;
  const stoneColor = P.stone ?? P.STONE ?? 3;
  const stoneDark = P.stoneDark ?? P.STONE_DARK ?? 10;

  for (let z = zStart; z <= zEnd; z++) {
    for (let x = bridgeX; x < bridgeX + bridgeW; x++) setVoxel(x, bridgeY, z, stoneColor);
  }
  for (let z = zStart; z <= zEnd; z++) {
    setVoxel(bridgeX, bridgeY + 1, z, stoneDark);
    setVoxel(bridgeX + bridgeW - 1, bridgeY + 1, z, stoneDark);
  }
  for (let z = zStart; z <= zEnd; z += 8) {
    for (let x = bridgeX; x < bridgeX + bridgeW; x += (bridgeW - 1)) {
      const groundY = heightAt(x, z, bounds);
      for (let y = groundY + 1; y < bridgeY; y++) setVoxel(x, y, z, stoneDark);
    }
  }
  for (let z = zStart + 4; z <= zEnd; z += 8) {
    const archCenterY = bridgeY - 2;
    for (let x = bridgeX; x < bridgeX + bridgeW; x++) {
      setVoxel(x, archCenterY, z, stoneDark);
      setVoxel(x, archCenterY, z - 1, stoneDark);
      setVoxel(x, archCenterY, z + 1, stoneDark);
    }
  }

  const groundSouth = heightAt(bridgeX + 2, zStart, bounds);
  for (let step = 0; step <= bridgeY - groundSouth; step++) {
    const z = zStart - step, y = bridgeY - step;
    for (let x = bridgeX; x < bridgeX + bridgeW; x++) {
      setVoxel(x, y, z, stoneColor);
      for (let cy = y + 1; cy <= y + 3; cy++) setVoxel(x, cy, z, 0);
    }
  }

  const groundNorth = heightAt(bridgeX + 2, zEnd, bounds);
  for (let step = 0; step <= bridgeY - groundNorth; step++) {
    const z = zEnd + step, y = bridgeY - step;
    for (let x = bridgeX; x < bridgeX + bridgeW; x++) {
      setVoxel(x, y, z, stoneColor);
      for (let cy = y + 1; cy <= y + 3; cy++) setVoxel(x, cy, z, 0);
    }
  }
}

function generateTunnel(bounds: MapdefBounds, P: Record<string, number>): void {
  console.log('  Generating tunnel...');
  const tunnelW = 4, tunnelH = 3, tunnelY = -2, zCenter = 0;
  const xStart = 35, xEnd = 75;
  const stoneDark = P.stoneDark ?? P.STONE_DARK ?? 10;
  const stoneColor = P.stone ?? P.STONE ?? 3;

  for (let x = xStart; x <= xEnd; x++) {
    for (let zOff = 0; zOff < tunnelW; zOff++) {
      const z = zCenter + zOff - Math.floor(tunnelW / 2);
      for (let y = tunnelY; y < tunnelY + tunnelH; y++) setVoxel(x, y, z, 0);
      setVoxel(x, tunnelY - 1, z, stoneDark);
      setVoxel(x, tunnelY + tunnelH, z, stoneDark);
    }
  }

  for (let x = xStart; x <= xEnd; x++) {
    for (let y = tunnelY - 1; y <= tunnelY + tunnelH; y++) {
      setVoxel(x, y, zCenter - Math.floor(tunnelW / 2) - 1, stoneDark);
      setVoxel(x, y, zCenter + Math.floor(tunnelW / 2), stoneDark);
    }
  }

  for (let step = 0; step < 4; step++) {
    const x = xStart - step - 1, y = tunnelY + step;
    for (let zOff = 0; zOff < tunnelW; zOff++) {
      const z = zCenter + zOff - Math.floor(tunnelW / 2);
      setVoxel(x, y, z, stoneColor);
      for (let cy = y + 1; cy <= y + 3; cy++) setVoxel(x, cy, z, 0);
    }
  }
  for (let step = 0; step < 4; step++) {
    const x = xEnd + step + 1, y = tunnelY + step;
    for (let zOff = 0; zOff < tunnelW; zOff++) {
      const z = zCenter + zOff - Math.floor(tunnelW / 2);
      setVoxel(x, y, z, stoneColor);
      for (let cy = y + 1; cy <= y + 3; cy++) setVoxel(x, cy, z, 0);
    }
  }
}

function generateCover(bounds: MapdefBounds, P: Record<string, number>): void {
  console.log('  Generating cover elements...');
  const sandDark = P.sandDark ?? P.SAND_DARK ?? 8;
  const woodDark = P.woodDark ?? P.WOOD_DARK ?? 14;
  const stoneColor = P.stone ?? P.STONE ?? 3;

  const sandbagPositions: [number, number, number, number][] = [
    [-30, -5, 4, 1], [-30, 5, 4, 1], [-15, -3, 1, 3],
    [30, -8, 3, 1], [30, 8, 3, 1], [-70, -10, 3, 1],
    [-70, 10, 3, 1], [40, 15, 1, 3], [0, -30, 3, 1], [0, 30, 3, 1],
  ];
  for (const [sx, sz, lenX, lenZ] of sandbagPositions) {
    for (let x = sx; x < sx + lenX; x++) {
      for (let z = sz; z < sz + lenZ; z++) {
        const surfaceY = heightAt(x, z, bounds);
        setVoxel(x, surfaceY + 1, z, sandDark);
        setVoxel(x, surfaceY + 2, z, sandDark);
      }
    }
  }

  const cratePositions: [number, number][] = [
    [-50, -8], [-50, 8], [-38, 0], [5, -8], [5, 18], [20, -5], [55, 48], [60, 55],
  ];
  for (const [cx, cz] of cratePositions) {
    const surfaceY = heightAt(cx, cz, bounds);
    fillBox(cx, surfaceY + 1, cz, cx + 1, surfaceY + 2, cz + 1, woodDark);
  }

  const wallSegments: [number, number, number, number, number][] = [
    [-20, -15, 1, 0, 8], [-20, 15, 1, 0, 8], [35, -20, 0, 1, 6], [35, 20, 0, 1, 6],
  ];
  for (const [wx, wz, dx, dz, len] of wallSegments) {
    for (let i = 0; i < len; i++) {
      const x = wx + dx * i, z = wz + dz * i;
      const surfaceY = heightAt(x, z, bounds);
      setVoxel(x, surfaceY + 1, z, stoneColor);
    }
  }
}

function generateWater(bounds: MapdefBounds, P: Record<string, number>, waterLevel: number): void {
  console.log('  Generating water...');
  const waterColor = P.water ?? P.WATER ?? 6;
  const waterDeep = P.waterDeep ?? P.WATER_DEEP ?? 17;

  for (let x = bounds.xMin; x <= bounds.xMax; x++) {
    for (let z = bounds.zMin; z <= bounds.zMax; z++) {
      const surfaceY = heightAt(x, z, bounds);
      if (surfaceY < waterLevel) {
        for (let y = surfaceY + 1; y <= waterLevel; y++) {
          if (getVoxel(x, y, z) === 0) {
            setVoxel(x, y, z, y === waterLevel ? waterColor : waterDeep);
          }
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Component placement
// ---------------------------------------------------------------------------

function rotateVoxel90Y(
  x: number, y: number, z: number,
  sizeX: number, sizeZ: number,
  degrees: number,
): { x: number; y: number; z: number } {
  const steps = ((degrees % 360) + 360) % 360 / 90;
  let rx = x, rz = z;
  let curSizeX = sizeX, curSizeZ = sizeZ;

  for (let s = 0; s < steps; s++) {
    // 90° CW around Y: (x, z) → (sizeZ - 1 - z, x)
    const newX = curSizeZ - 1 - rz;
    const newZ = rx;
    rx = newX;
    rz = newZ;
    // Swap sizes
    const tmp = curSizeX;
    curSizeX = curSizeZ;
    curSizeZ = tmp;
  }

  return { x: rx, y, z: rz };
}

function rotatedSize(sizeX: number, sizeZ: number, degrees: number): { sizeX: number; sizeZ: number } {
  const steps = ((degrees % 360) + 360) % 360 / 90;
  return steps % 2 === 0
    ? { sizeX, sizeZ }
    : { sizeX: sizeZ, sizeZ: sizeX };
}

function rotatedOrigin(
  origin: { x: number; y: number; z: number },
  sizeX: number, sizeZ: number,
  degrees: number,
): { x: number; y: number; z: number } {
  const rotated = rotateVoxel90Y(origin.x, origin.y, origin.z, sizeX, sizeZ, degrees);
  return rotated;
}

function placeComponent(
  component: ComponentFile,
  placement: Placement,
  remap: Uint8Array,
  bounds: MapdefBounds,
): void {
  const { sizeX: rotSizeX, sizeZ: rotSizeZ } = rotatedSize(
    component.bounds.sizeX, component.bounds.sizeZ, placement.rotation
  );
  const rotOrigin = rotatedOrigin(
    component.origin,
    component.bounds.sizeX, component.bounds.sizeZ,
    placement.rotation,
  );

  const offsetX = placement.position.x - rotOrigin.x;
  const offsetY = placement.position.y - rotOrigin.y;
  const offsetZ = placement.position.z - rotOrigin.z;

  // Terrain carve: clear terrain voxels in component footprint
  if (placement.terrainCarve) {
    for (let x = offsetX; x < offsetX + rotSizeX; x++) {
      for (let z = offsetZ; z < offsetZ + rotSizeZ; z++) {
        for (let y = offsetY; y < offsetY + component.bounds.sizeY; y++) {
          const current = getVoxel(x, y, z);
          if (current > 0 && current <= TERRAIN_PALETTE_MAX) {
            setVoxel(x, y, z, 0);
          }
        }
      }
    }
  }

  // Place voxels
  for (const v of component.voxels) {
    const rot = rotateVoxel90Y(v.x, v.y, v.z, component.bounds.sizeX, component.bounds.sizeZ, placement.rotation);
    const wx = offsetX + rot.x;
    const wy = offsetY + rot.y;
    const wz = offsetZ + rot.z;

    // Bounds check
    if (wx < bounds.xMin || wx > bounds.xMax) continue;
    if (wy < bounds.yMin || wy > bounds.yMax) continue;
    if (wz < bounds.zMin || wz > bounds.zMax) continue;

    const remappedColor = remap[v.c];
    if (remappedColor > 0) {
      setVoxel(wx, wy, wz, remappedColor);
    }
  }
}

// ---------------------------------------------------------------------------
// Binary writer
// ---------------------------------------------------------------------------

function writeCLWF(outputPath: string): void {
  const chunkEntries = Array.from(chunks.entries());
  const nonEmpty = chunkEntries.filter(([, data]) => {
    for (let i = 0; i < data.length; i++) {
      if (data[i] !== 0) return true;
    }
    return false;
  });

  console.log(`  Writing ${nonEmpty.length} non-empty chunks...`);

  const totalSize = HEADER_SIZE + nonEmpty.length * CHUNK_RECORD_SIZE;
  const buffer = Buffer.alloc(totalSize);
  let offset = 0;

  buffer.write(MAGIC, offset, 4, 'ascii');
  offset += 4;
  buffer.writeUInt8(VERSION, offset);
  offset += 1;
  buffer.writeUInt32LE(nonEmpty.length, offset);
  offset += 4;
  buffer.writeUInt16LE(PALETTE_SIZE, offset);
  offset += 2;

  for (let i = 0; i < PALETTE_SIZE; i++) {
    const c = unifiedPalette[i];
    buffer.writeUInt8(c.r, offset); offset += 1;
    buffer.writeUInt8(c.g, offset); offset += 1;
    buffer.writeUInt8(c.b, offset); offset += 1;
  }

  for (const [key, data] of nonEmpty) {
    const [cx, cy, cz] = key.split(',').map(Number);
    buffer.writeInt16LE(cx, offset); offset += 2;
    buffer.writeInt16LE(cy, offset); offset += 2;
    buffer.writeInt16LE(cz, offset); offset += 2;
    for (let i = 0; i < CHUNK_VOXEL_COUNT; i++) {
      buffer.writeUInt8(data[i], offset);
      offset += 1;
    }
  }

  fs.writeFileSync(outputPath, buffer);
  console.log(`  Binary map: ${(totalSize / 1024 / 1024).toFixed(2)} MB`);
}

// ---------------------------------------------------------------------------
// Metadata
// ---------------------------------------------------------------------------

function surfaceAt(x: number, z: number, bounds: MapdefBounds): number {
  for (let y = bounds.yMax; y >= bounds.yMin; y--) {
    if (getVoxel(x, y, z) > 0) return y;
  }
  return bounds.yMin;
}

function writeMeta(mapdef: Mapdef, outputPath: string, bounds: MapdefBounds): void {
  const meta: Record<string, unknown> = {
    name: mapdef.name,
    description: `Generated from ${mapdef.name} mapdef`,
  };

  // Auto-detect water indices from terrain palette names containing "WATER"
  const waterIndices: number[] = [];
  for (const [name, entry] of Object.entries(mapdef.terrainPalette)) {
    if (name.toUpperCase().includes('WATER')) {
      waterIndices.push(entry.index);
    }
  }
  if (waterIndices.length > 0) {
    meta.waterIndices = waterIndices.sort((a, b) => a - b);
  }

  if (mapdef.metadata.spawnPoints) {
    const spawnPoints: Record<string, { x: number; y: number; z: number }[]> = {};
    for (const [team, points] of Object.entries(mapdef.metadata.spawnPoints)) {
      spawnPoints[team] = points.map((p) => {
        const surf = surfaceAt(p.x, p.z, bounds);
        return { x: p.x, y: surf + 1, z: p.z };
      });
    }
    meta.spawn_points = spawnPoints;
  }

  if (mapdef.metadata.capturePoints) {
    meta.capture_points = mapdef.metadata.capturePoints.map((cp) => {
      const surf = surfaceAt(cp.position.x, cp.position.z, bounds);
      return {
        id: cp.id,
        position: { x: cp.position.x, y: surf + 1, z: cp.position.z },
        initialOwner: cp.initialOwner,
      };
    });
  }

  if (mapdef.metadata.objectives) {
    meta.objectives = mapdef.metadata.objectives.map((obj) => {
      const surf = surfaceAt(obj.position.x, obj.position.z, bounds);
      return {
        id: obj.id,
        type: obj.type,
        position: { x: obj.position.x, y: surf + 1, z: obj.position.z },
      };
    });
  }

  fs.writeFileSync(outputPath, JSON.stringify(meta, null, 2) + '\n');
  console.log(`  Meta: ${outputPath}`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main(): void {
  const args = process.argv.slice(2);

  if (args.length < 1) {
    console.error('Usage: npx tsx tools/map-compose.ts <mapdef.json>');
    process.exit(1);
  }

  const mapdefPath = path.resolve(args[0]);
  if (!fs.existsSync(mapdefPath)) {
    console.error(`Error: mapdef not found: ${mapdefPath}`);
    process.exit(1);
  }

  const projectRoot = path.resolve(path.dirname(mapdefPath), '../..');

  console.log('=== Clawfield Map Composer ===\n');

  // 1. Read mapdef
  const mapdef: Mapdef = JSON.parse(fs.readFileSync(mapdefPath, 'utf-8'));
  console.log(`  Map: ${mapdef.name}`);
  console.log(`  Bounds: X[${mapdef.bounds.xMin}..${mapdef.bounds.xMax}] Z[${mapdef.bounds.zMin}..${mapdef.bounds.zMax}] Y[${mapdef.bounds.yMin}..${mapdef.bounds.yMax}]`);

  // 2. Initialize palette
  initPalette();
  setTerrainPalette(mapdef.terrainPalette);
  nextFreeIndex = COMPONENT_PALETTE_START;

  // Build palette index lookup for terrain generators
  const P: Record<string, number> = {};
  for (const [name, entry] of Object.entries(mapdef.terrainPalette)) {
    P[name] = entry.index;
  }

  const startTime = performance.now();

  // 3. Generate terrain
  currentMapName = mapdef.name;
  currentSeed = mapdef.terrain.seed ?? 0;
  generateTerrain(mapdef.bounds, mapdef.terrainPalette, mapdef.terrain.waterLevel);

  if (mapdef.name === 'Shoreline') {
    generateRoads(mapdef.bounds, P);
    generateBuildings(mapdef.bounds, P);
    generateFort(mapdef.bounds, P);
    generateBridge(mapdef.bounds, P);
    generateTunnel(mapdef.bounds, P);
    generateCover(mapdef.bounds, P);
  }

  generateWater(mapdef.bounds, P, mapdef.terrain.waterLevel);

  const terrainMs = performance.now() - startTime;
  console.log(`  Terrain generation: ${(terrainMs / 1000).toFixed(2)}s`);

  // 4. Load registry + place components
  if (mapdef.placements.length > 0) {
    const registryPath = path.join(projectRoot, 'assets', 'components', 'registry.json');
    if (!fs.existsSync(registryPath)) {
      console.error(`Error: registry not found: ${registryPath}. Run registry-build.ts first.`);
      process.exit(1);
    }

    const registry: Registry = JSON.parse(fs.readFileSync(registryPath, 'utf-8'));
    const registryMap = new Map(registry.components.map((c) => [c.id, c]));

    // Cache loaded components
    const componentCache = new Map<string, { component: ComponentFile; remap: Uint8Array }>();

    console.log(`\n  Placing ${mapdef.placements.length} components...`);

    for (let i = 0; i < mapdef.placements.length; i++) {
      const placement = mapdef.placements[i];
      const entry = registryMap.get(placement.componentId);
      if (!entry) {
        console.warn(`  Warning: component "${placement.componentId}" not in registry, skipping`);
        continue;
      }

      let cached = componentCache.get(placement.componentId);
      if (!cached) {
        const compPath = path.join(projectRoot, entry.componentPath);
        if (!fs.existsSync(compPath)) {
          console.warn(`  Warning: component file not found: ${compPath}, skipping`);
          continue;
        }
        const component: ComponentFile = JSON.parse(fs.readFileSync(compPath, 'utf-8'));
        const remap = buildRemapTable(component.palette);
        cached = { component, remap };
        componentCache.set(placement.componentId, cached);
      }

      placeComponent(cached.component, placement, cached.remap, mapdef.bounds);
    }

    console.log(`  Palette usage: ${nextFreeIndex}/${PALETTE_SIZE} indices used`);
  }

  const totalGenMs = performance.now() - startTime;
  console.log(`\n  Total generation: ${(totalGenMs / 1000).toFixed(2)}s`);

  // 5. Write outputs
  const mapdefBasename = path.basename(mapdefPath, '.mapdef.json');
  const outputDir = path.dirname(mapdefPath);
  const mapPath = path.join(outputDir, `${mapdefBasename}.map`);
  const palettePath = path.join(outputDir, `${mapdefBasename}.palette.json`);
  const metaPath = path.join(outputDir, `${mapdefBasename}.meta.json`);

  console.log('\nWriting files...');
  writeCLWF(mapPath);

  fs.writeFileSync(palettePath, JSON.stringify(unifiedPalette, null, 2));
  console.log(`  Palette: ${palettePath}`);

  writeMeta(mapdef, metaPath, mapdef.bounds);

  const totalMs = performance.now() - startTime;
  console.log(`\n=== Done in ${(totalMs / 1000).toFixed(2)}s ===`);
  console.log(`  ${mapPath}`);
  console.log(`  ${palettePath}`);
  console.log(`  ${metaPath}`);
}

main();
