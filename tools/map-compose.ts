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
  downsample?: number; // e.g. 2 = merge every 2×2×2 block into 1 voxel
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
    objects?: { objectId: string; position: { x: number; y: number; z: number }; rotation?: number }[];
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

// Vobj.json format from assets/objects/ registry
interface VobjRegistryEntry {
  id: string;
  path: string;
  category: string;
}

interface VobjRegistry {
  version: number;
  objects: VobjRegistryEntry[];
}

interface VobjFile {
  name: string;
  version: number;
  category: string;
  sizeX: number;
  sizeY: number;
  sizeZ: number;
  voxelSize: number;
  origin: { x: number; y: number; z: number };
  palette: number[];  // 256 packed RGB ints
  voxels: number[];   // flat array, index = x + z*sizeX + y*sizeX*sizeZ
}

function vobjToComponentFile(vobj: VobjFile): ComponentFile {
  // Convert packed int palette to RGB[]
  const palette: RGB[] = vobj.palette.map((val) => {
    if (val === 0) return { r: 0, g: 0, b: 0 };
    return {
      r: (val >> 16) & 0xFF,
      g: (val >> 8) & 0xFF,
      b: val & 0xFF,
    };
  });

  // Convert flat voxel array to sparse {x, y, z, c}[]
  const voxels: { x: number; y: number; z: number; c: number }[] = [];
  for (let y = 0; y < vobj.sizeY; y++) {
    for (let z = 0; z < vobj.sizeZ; z++) {
      for (let x = 0; x < vobj.sizeX; x++) {
        const idx = x + z * vobj.sizeX + y * vobj.sizeX * vobj.sizeZ;
        const c = vobj.voxels[idx];
        if (c > 0) {
          voxels.push({ x, y, z, c });
        }
      }
    }
  }

  return {
    name: vobj.name,
    version: vobj.version,
    bounds: { sizeX: vobj.sizeX, sizeY: vobj.sizeY, sizeZ: vobj.sizeZ },
    origin: { ...vobj.origin },
    palette,
    usedColors: [...new Set(voxels.map((v) => v.c))],
    voxels,
  };
}

// ---------------------------------------------------------------------------
// .vox file parser (for placing MagicaVoxel models directly)
// ---------------------------------------------------------------------------

interface VoxVoxel { x: number; y: number; z: number; colorIndex: number }

function parseVoxBinary(buf: Buffer): { voxels: VoxVoxel[]; palette: RGB[]; sizeX: number; sizeY: number; sizeZ: number } {
  let offset = 0;

  const magic = buf.toString('ascii', offset, offset + 4); offset += 4;
  if (magic !== 'VOX ') throw new Error(`Not a .vox file (magic: ${magic})`);
  offset += 4; // version

  // Read MAIN chunk header
  offset += 4; // mainId
  offset += 4; // mainContentSize
  const mainChildSize = buf.readUInt32LE(offset); offset += 4;

  let sizeX = 0, sizeY = 0, sizeZ = 0;
  const voxels: VoxVoxel[] = [];
  const palette: RGB[] = new Array(256).fill(null).map(() => ({ r: 0, g: 0, b: 0 }));
  let hasPalette = false;

  const endOffset = offset + mainChildSize;

  while (offset < endOffset && offset < buf.length - 12) {
    const chunkId = buf.toString('ascii', offset, offset + 4); offset += 4;
    const contentSize = buf.readUInt32LE(offset); offset += 4;
    const childSize = buf.readUInt32LE(offset); offset += 4;
    const contentStart = offset;

    switch (chunkId) {
      case 'SIZE':
        sizeX = buf.readUInt32LE(offset); offset += 4;
        sizeY = buf.readUInt32LE(offset); offset += 4;
        sizeZ = buf.readUInt32LE(offset); offset += 4;
        break;

      case 'XYZI': {
        const numVoxels = buf.readUInt32LE(offset); offset += 4;
        for (let i = 0; i < numVoxels; i++) {
          const x = buf.readUInt8(offset); offset += 1;
          const y = buf.readUInt8(offset); offset += 1;
          const z = buf.readUInt8(offset); offset += 1;
          const ci = buf.readUInt8(offset); offset += 1;
          voxels.push({ x, y, z, colorIndex: ci });
        }
        break;
      }

      case 'RGBA': {
        hasPalette = true;
        for (let i = 0; i < 256; i++) {
          const r = buf.readUInt8(offset); offset += 1;
          const g = buf.readUInt8(offset); offset += 1;
          const b = buf.readUInt8(offset); offset += 1;
          offset += 1; // alpha
          // RGBA chunk index 0 = palette index 1
          palette[(i + 1) % 256] = { r, g, b };
        }
        break;
      }
    }

    offset = contentStart + contentSize + childSize;
  }

  return { voxels, palette, sizeX, sizeY, sizeZ };
}

function voxFileToComponentFile(filePath: string, downsample: number = 1): ComponentFile {
  const buf = fs.readFileSync(filePath);
  const parsed = parseVoxBinary(buf);
  const filename = path.basename(filePath, '.vox');

  // MCP-generated .vox files use: X=right, Y=up, Z=forward (matches game coords)
  // No coordinate swap needed.

  let voxels: { x: number; y: number; z: number; c: number }[];

  if (downsample > 1) {
    // Downsample: merge each NxNxN block into 1 voxel using majority-vote color
    const bins = new Map<string, Map<number, number>>();
    for (const v of parsed.voxels) {
      const ox = Math.floor(v.x / downsample);
      const oy = Math.floor(v.y / downsample);
      const oz = Math.floor(v.z / downsample);
      const key = `${ox},${oy},${oz}`;
      let colorMap = bins.get(key);
      if (!colorMap) { colorMap = new Map(); bins.set(key, colorMap); }
      colorMap.set(v.colorIndex, (colorMap.get(v.colorIndex) || 0) + 1);
    }

    voxels = [];
    for (const [key, colorMap] of bins) {
      const [x, y, z] = key.split(',').map(Number);
      let bestColor = 0, bestCount = 0;
      for (const [color, count] of colorMap) {
        if (count > bestCount) { bestColor = color; bestCount = count; }
      }
      if (bestColor > 0) {
        voxels.push({ x, y, z, c: bestColor });
      }
    }
  } else {
    voxels = parsed.voxels.map((v) => ({ x: v.x, y: v.y, z: v.z, c: v.colorIndex }));
  }

  // Compute tight bounds from actual voxel extents
  let maxX = 0, maxY = 0, maxZ = 0;
  for (const v of voxels) {
    if (v.x > maxX) maxX = v.x;
    if (v.y > maxY) maxY = v.y;
    if (v.z > maxZ) maxZ = v.z;
  }
  const tightSizeX = maxX + 1;
  const tightSizeY = maxY + 1;
  const tightSizeZ = maxZ + 1;

  const srcCount = parsed.voxels.length;
  const label = downsample > 1 ? ` (${downsample}:1 downsample, ${srcCount}→${voxels.length})` : '';
  console.log(`  Loaded .vox: ${filename} — ${voxels.length} voxels, bounds ${tightSizeX}×${tightSizeY}×${tightSizeZ}${label}`);

  return {
    name: filename,
    version: 1,
    bounds: { sizeX: tightSizeX, sizeY: tightSizeY, sizeZ: tightSizeZ },
    origin: { x: Math.floor(tightSizeX / 2), y: 0, z: Math.floor(tightSizeZ / 2) },
    palette: parsed.palette,
    usedColors: [...new Set(voxels.map((v) => v.c))],
    voxels,
  };
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

// ---------------------------------------------------------------------------
// Crossroads heightmap — mostly flat urban terrain
// ---------------------------------------------------------------------------

function heightAtCrossroads(x: number, z: number, bounds: MapdefBounds): number {
  let h = 3;

  // Road corridors slightly depressed
  const inRoadX = Math.abs(x) < 5;
  const inRoadZ = Math.abs(z) < 5;
  if (inRoadX || inRoadZ) {
    h = 2;
  }

  // Gentle hills at map corners for elevation variety
  const cornerPoints = [
    { cx: bounds.xMax * 0.7, cz: bounds.zMax * 0.7 },
    { cx: bounds.xMin * 0.7, cz: bounds.zMin * 0.7 },
    { cx: bounds.xMax * 0.7, cz: bounds.zMin * 0.7 },
    { cx: bounds.xMin * 0.7, cz: bounds.zMax * 0.7 },
  ];
  for (const cp of cornerPoints) {
    const dist = Math.sqrt((x - cp.cx) ** 2 + (z - cp.cz) ** 2);
    const influence = Math.max(0, 1 - dist / 60);
    h += influence * 3;
  }

  // Slight micro-variation so terrain isn't perfectly flat
  h += Math.sin(x / 30) * Math.cos(z / 25) * 0.3;

  // Edge drop-off at borders
  const xEdge = Math.min(Math.abs(x - bounds.xMin), Math.abs(x - bounds.xMax));
  const zEdge = Math.min(Math.abs(z - bounds.zMin), Math.abs(z - bounds.zMax));
  const edgeDist = Math.min(xEdge, zEdge);
  if (edgeDist < 10) {
    h = h * (edgeDist / 10) + 1 * (1 - edgeDist / 10);
  }

  return Math.max(1, Math.round(h));
}

function heightAtOldQuarter(_x: number, _z: number, bounds: MapdefBounds): number {
  // Deliberately flat-ish urban battlefield so streets and lanes stay readable.
  // Keep only a subtle center rise to avoid perfectly planar sightlines.
  const centerLift = 0.6;
  const edgeDrop = 1.2;

  // Build a soft radial falloff toward borders.
  const nx = Math.abs((_x - (bounds.xMin + bounds.xMax) * 0.5) / ((bounds.xMax - bounds.xMin) * 0.5));
  const nz = Math.abs((_z - (bounds.zMin + bounds.zMax) * 0.5) / ((bounds.zMax - bounds.zMin) * 0.5));
  const radial = Math.min(1, Math.sqrt(nx * nx + nz * nz));

  const h = 3 + centerLift * (1 - radial) - edgeDrop * radial * 0.25;
  return Math.max(2, Math.round(h));
}

// ---------------------------------------------------------------------------
// Strike at Karkand heightmap — corrected layout (S→N attack axis)
// ---------------------------------------------------------------------------

function heightAtKarkand(x: number, z: number, bounds: MapdefBounds): number {
  // Flat desert floor at y=3
  let h = 3;

  // Suburb hill: center (50, 100), radius ~80, rises to y=6-7
  const dxSub = (x - 50) / 80;
  const dzSub = (z - 100) / 65;
  const distSub = dxSub * dxSub + dzSub * dzSub;
  if (distSub < 1) {
    h += (1 - distSub) * 4;
  }

  // Industrial zone slight rise near Factory (z > 400)
  if (z > 400) {
    const frac = (z - 400) / 100;
    h += Math.min(frac, 1) * 1.5;
  }

  // River channel: depression along (160, 83) to (207, 233)
  const rz1 = 83, rz2 = 233;
  const rx1 = 160, rx2 = 207;
  if (z >= rz1 - 8 && z <= rz2 + 8) {
    const t = Math.max(0, Math.min(1, (z - rz1) / (rz2 - rz1)));
    const riverCx = rx1 + t * (rx2 - rx1);
    const distToRiver = Math.abs(x - riverCx);
    if (distToRiver < 8) {
      const riverDepth = (1 - distToRiver / 8) * 5;
      h -= riverDepth;
    }
  }

  // Subtle micro-variation (same amplitude — texture noise doesn't scale)
  h += Math.sin(x / 35) * Math.cos(z / 28) * 0.3;
  h += Math.sin(x / 17 + 1.2) * Math.cos(z / 14 + 0.7) * 0.15;

  // Edge drop-off at ±495
  const xEdge = Math.min(Math.abs(x - bounds.xMin), Math.abs(x - bounds.xMax));
  const zEdge = Math.min(Math.abs(z - bounds.zMin), Math.abs(z - bounds.zMax));
  const edgeDist = Math.min(xEdge, zEdge);
  if (edgeDist < 8) {
    h = h * (edgeDist / 8) + 1 * (1 - edgeDist / 8);
  }

  return Math.max(1, Math.round(h));
}

// Current map context — set during main() to gate Shoreline vs generic behavior
let currentMapName = '';
let currentSeed = 0;

function heightAt(x: number, z: number, bounds: MapdefBounds): number {
  if (currentMapName === 'Shoreline') {
    return heightAtShoreline(x, z, bounds);
  }
  if (currentMapName === 'Crossroads') {
    return heightAtCrossroads(x, z, bounds);
  }
  if (currentMapName === 'Old Quarter Siege') {
    return heightAtOldQuarter(x, z, bounds);
  }
  if (currentMapName === 'Strike at Karkand') {
    return heightAtKarkand(x, z, bounds);
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

  // Detect desert: explicitly check map name, or fall back to waterLevel < 0 heuristic
  const isDesert = currentMapName === 'Strike at Karkand'
    || currentMapName === 'Crossroads'
    || currentMapName === 'Old Quarter Siege'
    || waterLevel < 0;

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

// ---------------------------------------------------------------------------
// Crossroads-specific generators
// ---------------------------------------------------------------------------

function generateCrossroadsRoads(bounds: MapdefBounds, P: Record<string, number>): void {
  console.log('  Generating crossroads roads...');
  const road = P.ROAD ?? 18;
  const sidewalk = P.SIDEWALK ?? P.CONCRETE ?? 11;
  const curb = P.CURB ?? P.CONCRETE_DARK ?? 12;
  const marking = P.ROAD_MARKING ?? P.SAND_LIGHT ?? 7;
  const concrete = P.CONCRETE ?? 11;

  // Central intersection: 13×13 flat plaza at (0,0)
  const plazaHalf = 6;
  for (let x = -plazaHalf; x <= plazaHalf; x++) {
    for (let z = -plazaHalf; z <= plazaHalf; z++) {
      const surfY = heightAt(x, z, bounds);
      setVoxel(x, surfY, z, concrete);
      // Clear above
      for (let y = surfY + 1; y <= surfY + 5; y++) setVoxel(x, y, z, 0);
    }
  }

  // Main E-W road: 7 voxels wide (z = -3..3), full map width
  for (let x = bounds.xMin + 5; x <= bounds.xMax - 5; x++) {
    for (let zOff = -3; zOff <= 3; zOff++) {
      const surfY = heightAt(x, zOff, bounds);
      setVoxel(x, surfY, zOff, road);
      // Clear above for headroom
      for (let y = surfY + 1; y <= surfY + 6; y++) setVoxel(x, y, zOff, 0);
    }
    // Sidewalks on both sides (2 voxels wide)
    for (const zSide of [-5, -4, 4, 5]) {
      const surfY = heightAt(x, zSide, bounds);
      setVoxel(x, surfY, zSide, sidewalk);
      for (let y = surfY + 1; y <= surfY + 5; y++) setVoxel(x, y, zSide, 0);
    }
    // Curb edges
    for (const zCurb of [-4, 4]) {
      const surfY = heightAt(x, zCurb, bounds);
      setVoxel(x, surfY + 1, zCurb, curb);
    }
    // Center line markings (dashed)
    if (Math.abs(x) > plazaHalf && x % 6 < 3) {
      const surfY = heightAt(x, 0, bounds);
      setVoxel(x, surfY, 0, marking);
    }
  }

  // Main N-S road: 7 voxels wide (x = -3..3), full map depth
  for (let z = bounds.zMin + 5; z <= bounds.zMax - 5; z++) {
    for (let xOff = -3; xOff <= 3; xOff++) {
      const surfY = heightAt(xOff, z, bounds);
      setVoxel(xOff, surfY, z, road);
      for (let y = surfY + 1; y <= surfY + 6; y++) setVoxel(xOff, y, z, 0);
    }
    // Sidewalks
    for (const xSide of [-5, -4, 4, 5]) {
      const surfY = heightAt(xSide, z, bounds);
      setVoxel(xSide, surfY, z, sidewalk);
      for (let y = surfY + 1; y <= surfY + 5; y++) setVoxel(xSide, y, z, 0);
    }
    // Curb edges
    for (const xCurb of [-4, 4]) {
      const surfY = heightAt(xCurb, z, bounds);
      setVoxel(xCurb, surfY + 1, z, curb);
    }
    // Center line markings (dashed)
    if (Math.abs(z) > plazaHalf && z % 6 < 3) {
      const surfY = heightAt(0, z, bounds);
      setVoxel(0, surfY, z, marking);
    }
  }

  // Side streets in each quadrant (narrower, 3 voxels wide)
  const quadrantCenters = [
    { x: Math.floor(bounds.xMax * 0.45), z: Math.floor(bounds.zMax * 0.45) },
    { x: Math.floor(bounds.xMin * 0.45), z: Math.floor(bounds.zMax * 0.45) },
    { x: Math.floor(bounds.xMin * 0.45), z: Math.floor(bounds.zMin * 0.45) },
    { x: Math.floor(bounds.xMax * 0.45), z: Math.floor(bounds.zMin * 0.45) },
  ];

  for (const qc of quadrantCenters) {
    // E-W side street through quadrant center
    const sideZ = qc.z;
    const sideXStart = qc.x > 0 ? 8 : bounds.xMin + 10;
    const sideXEnd = qc.x > 0 ? bounds.xMax - 10 : -8;
    for (let x = Math.min(sideXStart, sideXEnd); x <= Math.max(sideXStart, sideXEnd); x++) {
      for (let zOff = -1; zOff <= 1; zOff++) {
        const surfY = heightAt(x, sideZ + zOff, bounds);
        setVoxel(x, surfY, sideZ + zOff, road);
        for (let y = surfY + 1; y <= surfY + 5; y++) setVoxel(x, y, sideZ + zOff, 0);
      }
      // Sidewalks along side streets
      for (const zSide of [-2, 2]) {
        const surfY = heightAt(x, sideZ + zSide, bounds);
        setVoxel(x, surfY, sideZ + zSide, sidewalk);
        for (let y = surfY + 1; y <= surfY + 5; y++) setVoxel(x, y, sideZ + zSide, 0);
      }
    }

    // N-S side street through quadrant center
    const sideX = qc.x;
    const sideZStart = qc.z > 0 ? 8 : bounds.zMin + 10;
    const sideZEnd = qc.z > 0 ? bounds.zMax - 10 : -8;
    for (let z = Math.min(sideZStart, sideZEnd); z <= Math.max(sideZStart, sideZEnd); z++) {
      for (let xOff = -1; xOff <= 1; xOff++) {
        const surfY = heightAt(sideX + xOff, z, bounds);
        setVoxel(sideX + xOff, surfY, z, road);
        for (let y = surfY + 1; y <= surfY + 5; y++) setVoxel(sideX + xOff, y, z, 0);
      }
      for (const xSide of [-2, 2]) {
        const surfY = heightAt(sideX + xSide, z, bounds);
        setVoxel(sideX + xSide, surfY, z, sidewalk);
        for (let y = surfY + 1; y <= surfY + 5; y++) setVoxel(sideX + xSide, y, z, 0);
      }
    }
  }
}

function generateCrossroadsCover(bounds: MapdefBounds, P: Record<string, number>): void {
  console.log('  Generating crossroads cover...');
  const sandDark = P.SAND_DARK ?? 8;
  const woodDark = P.WOOD_DARK ?? 14;
  const concrete = P.CONCRETE ?? 11;
  const concreteDark = P.CONCRETE_DARK ?? 12;
  const stone = P.STONE ?? 3;

  // Sandbag positions at key sightlines around the intersection
  const sandbagPositions: [number, number, number, number][] = [
    // Near intersection
    [-10, -10, 3, 1], [10, -10, 3, 1], [-10, 10, 3, 1], [10, 10, 3, 1],
    // Mid-range positions along roads
    [-40, -6, 4, 1], [40, -6, 4, 1], [-40, 6, 4, 1], [40, 6, 4, 1],
    [-6, -40, 1, 4], [6, -40, 1, 4], [-6, 40, 1, 4], [6, 40, 1, 4],
    // Flanking positions in quadrants
    [30, 30, 3, 1], [-30, 30, 3, 1], [-30, -30, 3, 1], [30, -30, 3, 1],
  ];
  for (const [sx, sz, lenX, lenZ] of sandbagPositions) {
    for (let x = sx; x < sx + lenX; x++) {
      for (let z = sz; z < sz + lenZ; z++) {
        const surfY = heightAt(x, z, bounds);
        setVoxel(x, surfY + 1, z, sandDark);
        setVoxel(x, surfY + 2, z, sandDark);
      }
    }
  }

  // Concrete barriers at intersections and key points
  const barrierPositions: [number, number, number, number][] = [
    [-15, -2, 1, 4], [15, -2, 1, 4], [-2, -15, 4, 1], [-2, 15, 4, 1],
    // Along side streets
    [50, 50, 4, 1], [-50, 50, 4, 1], [-50, -50, 4, 1], [50, -50, 4, 1],
  ];
  for (const [bx, bz, lenX, lenZ] of barrierPositions) {
    for (let x = bx; x < bx + lenX; x++) {
      for (let z = bz; z < bz + lenZ; z++) {
        const surfY = heightAt(x, z, bounds);
        setVoxel(x, surfY + 1, z, concreteDark);
        setVoxel(x, surfY + 2, z, concreteDark);
        setVoxel(x, surfY + 3, z, concrete);
      }
    }
  }

  // Crate clusters near buildings in each quadrant
  const cratePositions: [number, number][] = [
    [20, 20], [25, 35], [-20, 20], [-35, 25],
    [-20, -20], [-25, -35], [20, -20], [35, -25],
    [60, 60], [-60, 60], [-60, -60], [60, -60],
    [45, 15], [-45, 15], [15, 45], [-15, -45],
  ];
  for (const [cx, cz] of cratePositions) {
    if (cx < bounds.xMin + 10 || cx > bounds.xMax - 10) continue;
    if (cz < bounds.zMin + 10 || cz > bounds.zMax - 10) continue;
    const surfY = heightAt(cx, cz, bounds);
    fillBox(cx, surfY + 1, cz, cx + 1, surfY + 2, cz + 1, woodDark);
  }

  // Low wall segments for flanking routes
  const wallSegments: [number, number, number, number, number][] = [
    [25, 8, 1, 0, 6], [-25, 8, 1, 0, 6],
    [25, -8, 1, 0, 6], [-25, -8, 1, 0, 6],
    [8, 25, 0, 1, 6], [-8, 25, 0, 1, 6],
    [8, -25, 0, 1, 6], [-8, -25, 0, 1, 6],
  ];
  for (const [wx, wz, dx, dz, len] of wallSegments) {
    for (let i = 0; i < len; i++) {
      const x = wx + dx * i, z = wz + dz * i;
      const surfY = heightAt(x, z, bounds);
      setVoxel(x, surfY + 1, z, stone);
    }
  }
}

function oldQuarterHash(x: number, z: number): number {
  const n = Math.imul(x * 73856093, 1) ^ Math.imul(z * 19349663, 1);
  return (n >>> 0) % 9973;
}

function generateOldQuarterRoads(bounds: MapdefBounds, P: Record<string, number>): void {
  console.log('  Generating old quarter roads...');
  const road = P.ROAD ?? 18;
  const sidewalk = P.CONCRETE ?? 11;
  const curb = P.CONCRETE_DARK ?? 12;
  const laneMark = P.SAND_LIGHT ?? 7;

  const horizontalMajors = [-80, -40, 0, 40, 80];
  const verticalMajors = [-100, -60, -20, 20, 60, 100];

  for (const zCenter of horizontalMajors) {
    for (let x = bounds.xMin + 6; x <= bounds.xMax - 6; x++) {
      for (let z = zCenter - 5; z <= zCenter + 5; z++) {
        const y = heightAt(x, z, bounds);
        setVoxel(x, y, z, road);
        for (let cy = y + 1; cy <= y + 7; cy++) setVoxel(x, cy, z, 0);
      }
      for (const z of [zCenter - 7, zCenter - 6, zCenter + 6, zCenter + 7]) {
        const y = heightAt(x, z, bounds);
        setVoxel(x, y, z, sidewalk);
      }
      for (const z of [zCenter - 6, zCenter + 6]) {
        const y = heightAt(x, z, bounds);
        setVoxel(x, y + 1, z, curb);
      }
      if (x % 12 < 7) {
        const y = heightAt(x, zCenter, bounds);
        setVoxel(x, y, zCenter, laneMark);
      }
    }
  }

  for (const xCenter of verticalMajors) {
    for (let z = bounds.zMin + 6; z <= bounds.zMax - 6; z++) {
      for (let x = xCenter - 4; x <= xCenter + 4; x++) {
        const y = heightAt(x, z, bounds);
        setVoxel(x, y, z, road);
        for (let cy = y + 1; cy <= y + 7; cy++) setVoxel(x, cy, z, 0);
      }
      for (const x of [xCenter - 6, xCenter - 5, xCenter + 5, xCenter + 6]) {
        const y = heightAt(x, z, bounds);
        setVoxel(x, y, z, sidewalk);
      }
      if (z % 10 < 6) {
        const y = heightAt(xCenter, z, bounds);
        setVoxel(xCenter, y, z, laneMark);
      }
    }
  }

  // Narrow alleys crossing blocks.
  for (const zCenter of [-100, -60, -20, 20, 60, 100]) {
    for (let x = bounds.xMin + 12; x <= bounds.xMax - 12; x++) {
      for (let z = zCenter - 1; z <= zCenter + 1; z++) {
        const y = heightAt(x, z, bounds);
        setVoxel(x, y, z, road);
        for (let cy = y + 1; cy <= y + 5; cy++) setVoxel(x, cy, z, 0);
      }
    }
  }
}

function generateOldQuarterBuildings(bounds: MapdefBounds, P: Record<string, number>): void {
  console.log('  Generating old quarter building blocks...');

  const facades = [P.BRICK ?? 15, P.CONCRETE ?? 11, P.CONCRETE_DARK ?? 12, P.WOOD ?? 13];
  const roofs = [P.ROOF_TILE ?? 16, P.METAL ?? 20, P.CONCRETE_DARK ?? 12];

  const blockX = [-140, -100, -60, -20, 20, 60, 100];
  const blockZ = [-120, -80, -40, 0, 40, 80];

  for (let bi = 0; bi < blockX.length - 1; bi++) {
    for (let bj = 0; bj < blockZ.length - 1; bj++) {
      const minX = blockX[bi] + 10;
      const maxX = blockX[bi + 1] - 10;
      const minZ = blockZ[bj] + 10;
      const maxZ = blockZ[bj + 1] - 10;

      const splitX = Math.floor((minX + maxX) * 0.5);
      const splitZ = Math.floor((minZ + maxZ) * 0.5);
      const lots: Array<[number, number, number, number]> = [
        [minX, splitX - 2, minZ, splitZ - 2],
        [splitX + 2, maxX, minZ, splitZ - 2],
        [minX, splitX - 2, splitZ + 2, maxZ],
        [splitX + 2, maxX, splitZ + 2, maxZ],
      ];

      for (const [lx1, lx2, lz1, lz2] of lots) {
        const width = Math.max(8, lx2 - lx1 + 1);
        const depth = Math.max(8, lz2 - lz1 + 1);
        const h = oldQuarterHash(lx1, lz1);
        const stories = 1 + (h % 4);
        const floorH = 4 + (h % 2);
        const facade = facades[h % facades.length];
        const roof = roofs[(h >> 2) % roofs.length];

        makeBuilding({
          x: lx1,
          z: lz1,
          w: width,
          d: depth,
          h: floorH,
          stories,
          material: facade,
          roofMaterial: roof,
          hasDoors: true,
          hasWindows: true,
          hasBalcony: stories >= 2 && (h % 3 === 0),
        }, bounds, P);

        // Deterministic shell damage on some buildings for war-torn readability.
        if (h % 4 === 0) {
          const holeX = lx1 + 1 + (h % Math.max(2, width - 3));
          const holeZ = lz1 + 1 + ((h >> 3) % Math.max(2, depth - 3));
          const baseY = heightAt(lx1 + Math.floor(width / 2), lz1 + Math.floor(depth / 2), bounds);
          fillBox(holeX, baseY + 2, holeZ, holeX + 2, baseY + 5, holeZ + 2, 0);
        }
      }
    }
  }

  // Keep central combat bowl more open for readable fights.
  fillBox(-24, -4, -24, 24, bounds.yMax, 24, 0);
}

function generateOldQuarterCover(bounds: MapdefBounds, P: Record<string, number>): void {
  console.log('  Generating old quarter cover and rubble...');
  const sandbag = P.SAND_DARK ?? 8;
  const rubble = P.STONE_DARK ?? 10;
  const crate = P.WOOD_DARK ?? 14;
  const barrier = P.CONCRETE_DARK ?? 12;

  // Roadside defensive lines at many intersections.
  for (const x of [-100, -60, -20, 20, 60, 100]) {
    for (const z of [-80, -40, 0, 40, 80]) {
      const y = heightAt(x, z, bounds);
      for (let dx = -3; dx <= 3; dx++) {
        setVoxel(x + dx, y + 1, z - 6, sandbag);
        setVoxel(x + dx, y + 1, z + 6, sandbag);
      }
      for (let dz = -2; dz <= 2; dz++) {
        setVoxel(x - 6, y + 1, z + dz, barrier);
        setVoxel(x + 6, y + 1, z + dz, barrier);
      }
    }
  }

  // Rubble mounds to break long sightlines.
  for (let x = bounds.xMin + 20; x <= bounds.xMax - 20; x += 24) {
    for (let z = bounds.zMin + 20; z <= bounds.zMax - 20; z += 24) {
      const h = oldQuarterHash(x, z);
      if (h % 5 !== 0) continue;
      const r = 2 + (h % 4);
      const baseY = heightAt(x, z, bounds);
      for (let rx = x - r; rx <= x + r; rx++) {
        for (let rz = z - r; rz <= z + r; rz++) {
          const d = Math.hypot(rx - x, rz - z);
          if (d > r) continue;
          const top = Math.max(1, Math.round((1 - d / r) * (2 + (h % 3))));
          for (let yy = 1; yy <= top; yy++) setVoxel(rx, baseY + yy, rz, rubble);
        }
      }
    }
  }

  // Crate stacks in side alleys.
  for (let x = bounds.xMin + 14; x <= bounds.xMax - 14; x += 18) {
    for (let z = bounds.zMin + 14; z <= bounds.zMax - 14; z += 18) {
      const h = oldQuarterHash(x + 3, z - 2);
      if (h % 6 !== 0) continue;
      const y = heightAt(x, z, bounds);
      fillBox(x, y + 1, z, x + 1, y + 2, z + 1, crate);
      if (h % 2 === 0) fillBox(x, y + 3, z, x, y + 3, z, crate);
    }
  }
}

function generateOldQuarterLandmarks(bounds: MapdefBounds, P: Record<string, number>): void {
  console.log('  Generating old quarter landmarks...');
  const concrete = P.CONCRETE ?? 11;
  const concreteDark = P.CONCRETE_DARK ?? 12;
  const brick = P.BRICK ?? 15;
  const roof = P.ROOF_TILE ?? 16;
  const metal = P.METAL ?? 20;
  const window = P.WINDOW ?? 19;
  const stone = P.STONE ?? 3;
  const stoneDark = P.STONE_DARK ?? 10;

  // 1) Central war-torn civic square (B sector anchor)
  const plazaY = heightAt(20, 0, bounds);
  fillBox(-8, plazaY, -18, 48, plazaY, 18, concrete);
  fillBox(-6, plazaY + 1, -16, 46, plazaY + 1, 16, concreteDark);
  // blast crater + collapsed statue base
  for (let x = 12; x <= 26; x++) {
    for (let z = -6; z <= 6; z++) {
      const d = Math.hypot(x - 19, z);
      if (d > 7) continue;
      const cut = Math.max(1, Math.round((1 - d / 7) * 3));
      for (let y = 0; y < cut; y++) setVoxel(x, plazaY - y, z, 0);
      if (d < 5) setVoxel(x, plazaY - cut, z, stoneDark);
    }
  }
  fillBox(17, plazaY + 1, -1, 21, plazaY + 2, 1, stone);
  fillBox(18, plazaY + 3, 0, 20, plazaY + 5, 0, stoneDark);

  // 2) Western citadel block (A-side identity)
  makeBuilding({
    x: -134,
    z: -18,
    w: 26,
    d: 36,
    h: 5,
    stories: 2,
    material: brick,
    roofMaterial: roof,
    hasDoors: true,
    hasWindows: true,
  }, bounds, P);
  const westBaseY = heightAt(-120, 0, bounds);
  // fortified wall + breach
  for (let z = -26; z <= 26; z++) {
    for (let y = westBaseY + 1; y <= westBaseY + 4; y++) {
      if (z >= -4 && z <= 4 && y <= westBaseY + 2) continue;
      setVoxel(-100, y, z, stoneDark);
    }
  }
  // gate ruins
  fillBox(-103, westBaseY + 1, -6, -98, westBaseY + 2, -5, stone);
  fillBox(-103, westBaseY + 1, 5, -98, westBaseY + 2, 6, stone);

  // 3) Eastern market corridor (C-side identity)
  const marketY = heightAt(108, 42, bounds);
  for (let x = 86; x <= 132; x += 8) {
    fillBox(x, marketY + 1, 30, x + 5, marketY + 1, 54, woodColor(P));
    fillBox(x, marketY + 2, 30, x + 5, marketY + 2, 30, metal);
    fillBox(x, marketY + 2, 54, x + 5, marketY + 2, 54, metal);
    setVoxel(x + 1, marketY + 3, 32, window);
    setVoxel(x + 3, marketY + 3, 52, window);
  }

  // 4) Elevated overpass (signature skyline + chokepoint)
  const overY = plazaY + 8;
  for (let z = -118; z <= 118; z++) {
    for (let x = 56; x <= 62; x++) setVoxel(x, overY, z, concreteDark);
    if (z % 10 < 6) {
      setVoxel(59, overY, z, concrete);
    }
  }
  for (let z = -110; z <= 110; z += 18) {
    const colY = heightAt(59, z, bounds);
    for (let y = colY + 1; y < overY; y++) {
      fillBox(57, y, z - 1, 61, y, z + 1, concrete);
    }
  }
  // partial collapse in center
  fillBox(56, overY, -8, 62, overY, 8, 0);
  fillBox(57, overY - 1, -6, 61, overY - 1, 6, stoneDark);

  // 5) Burned convoy (set-piece cover line)
  const convoyY = heightAt(12, -40, bounds);
  for (let i = 0; i < 5; i++) {
    const x = 6 + i * 8;
    fillBox(x, convoyY + 1, -42, x + 4, convoyY + 2, -40, metal);
    if (i % 2 === 0) {
      fillBox(x + 1, convoyY + 3, -41, x + 3, convoyY + 3, -41, stoneDark);
    }
    // wheels/track chunks
    setVoxel(x, convoyY + 1, -43, stoneDark);
    setVoxel(x + 4, convoyY + 1, -43, stoneDark);
    setVoxel(x, convoyY + 1, -39, stoneDark);
    setVoxel(x + 4, convoyY + 1, -39, stoneDark);
  }

  // Crosswalks at major hubs for visual breakup.
  for (let dx = -4; dx <= 4; dx++) {
    if (dx % 2 === 0) {
      setVoxel(20 + dx, plazaY, -20, window);
      setVoxel(20 + dx, plazaY, 20, window);
      setVoxel(-102, westBaseY, dx * 2, window);
      setVoxel(102, marketY, 20 + dx * 2, window);
    }
  }
}

function generateOldQuarterVerticality(bounds: MapdefBounds, P: Record<string, number>): void {
  console.log('  Generating old quarter vertical connectors...');

  const concrete = P.CONCRETE ?? 11;
  const concreteDark = P.CONCRETE_DARK ?? 12;
  const metal = P.METAL ?? 20;
  const stoneDark = P.STONE_DARK ?? 10;

  const plazaY = heightAt(20, 0, bounds);
  const overY = plazaY + 8;

  const buildRamp = (
    startX: number,
    startZ: number,
    dirX: number,
    dirZ: number,
    length: number,
    targetY: number,
    width: number,
  ): void => {
    const baseY = heightAt(startX, startZ, bounds) + 1;
    for (let i = 0; i <= length; i++) {
      const x = startX + dirX * i;
      const z = startZ + dirZ * i;
      const y = Math.round(baseY + (targetY - baseY) * (i / Math.max(1, length)));
      if (Math.abs(dirX) > 0) {
        fillBox(x, y, z - width, x, y, z + width, concreteDark);
      } else {
        fillBox(x - width, y, z, x + width, y, z, concreteDark);
      }
      if (i % 3 === 0) {
        if (Math.abs(dirX) > 0) {
          setVoxel(x, y + 1, z - width, metal);
          setVoxel(x, y + 1, z + width, metal);
        } else {
          setVoxel(x - width, y + 1, z, metal);
          setVoxel(x + width, y + 1, z, metal);
        }
      }
    }
  };

  // Overpass access ramps from both sides to create a vertical loop.
  buildRamp(40, -92, 1, 0, 18, overY, 2);
  buildRamp(40, 92, 1, 0, 18, overY, 2);

  const buildCatwalk = (
    x1: number,
    z1: number,
    x2: number,
    z2: number,
    width: number,
  ): void => {
    const len = Math.max(Math.abs(x2 - x1), Math.abs(z2 - z1));
    if (len === 0) return;

    const roofA = surfaceAt(x1, z1, bounds);
    const roofB = surfaceAt(x2, z2, bounds);
    const y = Math.max(roofA, roofB) + 1;
    if (y < 8) return;

    for (let i = 0; i <= len; i++) {
      const t = i / len;
      const x = Math.round(x1 + (x2 - x1) * t);
      const z = Math.round(z1 + (z2 - z1) * t);
      fillBox(x - width, y, z - width, x + width, y, z + width, concrete);
      setVoxel(x - width, y + 1, z - width, metal);
      setVoxel(x + width, y + 1, z + width, metal);
      setVoxel(x - width, y + 1, z + width, metal);
      setVoxel(x + width, y + 1, z - width, metal);
      fillBox(x - width, y + 2, z - width, x + width, y + 6, z + width, 0);
    }
  };

  // Rooftop connectors across key lanes for flank/reposition options.
  buildCatwalk(-112, -52, -88, -52, 1);
  buildCatwalk(-52, 28, -28, 28, 1);
  buildCatwalk(8, -52, 32, -52, 1);
  buildCatwalk(68, 28, 92, 28, 1);
  buildCatwalk(-12, 68, 12, 68, 1);

  // Rubble stairs to get onto selected roofs from street level.
  const stairAnchors: Array<{ x: number; z: number; dx: number; dz: number; rise: number }> = [
    { x: -96, z: -36, dx: 1, dz: 0, rise: 8 },
    { x: -36, z: 44, dx: 1, dz: 0, rise: 8 },
    { x: 24, z: -34, dx: 1, dz: 0, rise: 9 },
    { x: 84, z: 44, dx: 1, dz: 0, rise: 8 },
  ];
  for (const s of stairAnchors) {
    const baseY = heightAt(s.x, s.z, bounds) + 1;
    for (let i = 0; i < 12; i++) {
      const x = s.x + s.dx * i;
      const z = s.z + s.dz * i;
      const y = baseY + Math.floor((i / 11) * s.rise);
      fillBox(x, y, z - 1, x, y, z + 1, stoneDark);
      fillBox(x, y + 1, z - 1, x, y + 4, z + 1, 0);
    }
  }
}

function buildOldQuarterObjectPlacements(bounds: MapdefBounds): Array<{
  objectId: string;
  position: { x: number; y: number; z: number };
  rotation: number;
}> {
  const objects: Array<{ objectId: string; position: { x: number; y: number; z: number }; rotation: number }> = [];

  const addObject = (objectId: string, x: number, z: number, rotation = 0, yOffset = 0): void => {
    if (x < bounds.xMin + 8 || x > bounds.xMax - 8 || z < bounds.zMin + 8 || z > bounds.zMax - 8) return;
    const y = surfaceAt(x, z, bounds) + 1 + yOffset;
    objects.push({ objectId, position: { x, y, z }, rotation });
  };

  // Roadside lights and signs for city readability at player scale.
  for (let x = bounds.xMin + 14; x <= bounds.xMax - 14; x += 14) {
    addObject(oldQuarterHash(x, -86) % 2 === 0 ? 'street_light_1' : 'street_light_2', x, -86, 0);
    addObject(oldQuarterHash(x, 86) % 2 === 0 ? 'street_light_2' : 'street_light_3', x, 86, 0);
    if (oldQuarterHash(x, 0) % 3 === 0) {
      addObject('street_sign_2', x, -10, 90);
      addObject('street_sign_3', x, 10, 270);
    }
  }

  // Intersection punctuation: traffic lights, cones, and benches.
  for (const ix of [-100, -60, -20, 20, 60, 100]) {
    for (const iz of [-80, -40, 0, 40, 80]) {
      addObject('traffic_light_1', ix - 7, iz - 7, 0);
      addObject('traffic_light_2', ix + 7, iz + 7, 180);
      if (oldQuarterHash(ix, iz) % 2 === 0) {
        addObject('traffic_cone', ix - 3, iz + 4, 0);
        addObject('traffic_cone', ix + 3, iz - 4, 0);
      }
      if (oldQuarterHash(ix + 5, iz - 5) % 4 === 0) {
        addObject('park_bench', ix - 8, iz, 90);
      }
    }
  }

  // Parked and burned vehicle lines for story + cover rhythm.
  for (let x = -132; x <= 132; x += 18) {
    const h = oldQuarterHash(x, -50);
    const car = ['sedan_1', 'sedan_2', 'sedan_3', 'suv_1'][h % 4] ?? 'sedan_1';
    addObject(car, x, -50, 90);
    if (h % 5 === 0) addObject('rubbish_pile_1', x + 3, -47, 0);
  }
  for (let z = -112; z <= 112; z += 22) {
    const h = oldQuarterHash(64, z);
    const car = ['sedan_4', 'sedan_5', 'taxi', 'police_car'][h % 4] ?? 'sedan_4';
    addObject(car, 64, z, 0);
    if (h % 3 === 0) addObject('trash_can', 67, z + 2, 0);
  }

  // Landmark embellishments.
  addObject('fountain', 18, 0, 0);
  addObject('statue_1', 22, 4, 180);
  addObject('city_bus', 102, 44, 270);
  addObject('delivery_truck', -112, -10, 90);
  addObject('shipping_container_1', 44, -78, 90);
  addObject('shipping_container_2', 48, -74, 90);

  // Market clutter on east side.
  for (let x = 84; x <= 130; x += 10) {
    addObject('planter_1', x, 28, 0);
    addObject('planter_2', x, 56, 180);
    if (oldQuarterHash(x, 40) % 2 === 0) addObject('newsbox_1', x + 1, 42, 90);
  }

  // Alley clutter for density.
  for (let x = bounds.xMin + 16; x <= bounds.xMax - 16; x += 16) {
    for (let z = bounds.zMin + 16; z <= bounds.zMax - 16; z += 16) {
      const h = oldQuarterHash(x, z);
      if (h % 7 !== 0) continue;
      const kind = h % 5;
      if (kind === 0) addObject('crate_small', x, z, 0);
      else if (kind === 1) addObject('barrel', x, z, 0);
      else if (kind === 2) addObject('rubbish_pile_2', x, z, 0);
      else if (kind === 3) addObject('dumpster_1', x, z, (h % 4) * 90);
      else addObject('mailbox_1', x, z, 0);
    }
  }

  return objects;
}

function generateOldQuarterPerimeter(bounds: MapdefBounds, P: Record<string, number>): void {
  console.log('  Generating old quarter perimeter and horizon mask...');

  const stoneDark = P.STONE_DARK ?? 10;
  const concreteDark = P.CONCRETE_DARK ?? 12;
  const brick = P.BRICK ?? 15;
  const metal = P.METAL ?? 20;

  const bermBand = 16;
  const wallBand = 2;
  const skylineInset = 5;
  const skylineInsetFar = 12;

  // 1) Raise an outskirts berm near map edges so the world fades naturally.
  for (let x = bounds.xMin; x <= bounds.xMax; x++) {
    for (let z = bounds.zMin; z <= bounds.zMax; z++) {
      const edgeDist = Math.min(
        x - bounds.xMin,
        bounds.xMax - x,
        z - bounds.zMin,
        bounds.zMax - z,
      );
      if (edgeDist > bermBand) continue;

      const baseY = heightAt(x, z, bounds);
      const hash = oldQuarterHash(x, z);
      const lift = Math.max(0, Math.floor((bermBand - edgeDist) / 3));
      const variation = hash % 3 === 0 ? 1 : 0;
      const topY = baseY + lift + variation;

      for (let y = baseY + 1; y <= topY; y++) {
        setVoxel(x, y, z, stoneDark);
      }
    }
  }

  // 2) Add a hard retaining wall right at the border to stop edge walk-offs.
  for (let x = bounds.xMin; x <= bounds.xMax; x++) {
    for (let z = bounds.zMin; z <= bounds.zMax; z++) {
      const edgeDist = Math.min(
        x - bounds.xMin,
        bounds.xMax - x,
        z - bounds.zMin,
        bounds.zMax - z,
      );
      if (edgeDist > wallBand) continue;

      const baseY = heightAt(x, z, bounds);
      const wallTop = Math.min(bounds.yMax, baseY + 11);
      for (let y = baseY + 1; y <= wallTop; y++) {
        setVoxel(x, y, z, concreteDark);
      }

      // Crenellation so the barrier reads as distant city fortification, not a plain cliff.
      if (((x + z) & 1) === 0 && wallTop < bounds.yMax) {
        setVoxel(x, wallTop + 1, z, brick);
      }
    }
  }

  // 3) Horizon silhouettes: rough towers around the edge ring to hide hard cutoff lines.
  const placeEdgeTower = (cx: number, cz: number): void => {
    const hash = oldQuarterHash(cx, cz);
    if (hash % 3 !== 0) return;

    const baseY = heightAt(cx, cz, bounds);
    const w = 2 + (hash % 2);
    const d = 2 + ((hash >> 1) % 2);
    const h = 8 + (hash % 10);
    const mat = hash % 2 === 0 ? concreteDark : stoneDark;

    fillBox(cx, baseY + 1, cz, cx + w, baseY + h, cz + d, mat);

    // Simple war damage cuts so silhouettes do not look tiled/repetitive.
    if (h > 10 && hash % 5 === 0) {
      fillBox(cx + 1, baseY + Math.floor(h * 0.6), cz + 1, cx + 1, baseY + h - 2, cz + 1, 0);
    }
  };

  for (let x = bounds.xMin + 6; x <= bounds.xMax - 6; x += 10) {
    placeEdgeTower(x, bounds.zMin + skylineInset);
    placeEdgeTower(x, bounds.zMax - skylineInset - 2);
  }
  for (let z = bounds.zMin + 6; z <= bounds.zMax - 6; z += 10) {
    placeEdgeTower(bounds.xMin + skylineInset, z);
    placeEdgeTower(bounds.xMax - skylineInset - 2, z);
  }

  // Secondary interior skyline ring for parallax depth (non-playable horizon mask).
  for (let x = bounds.xMin + 10; x <= bounds.xMax - 10; x += 14) {
    placeEdgeTower(x, bounds.zMin + skylineInsetFar);
    placeEdgeTower(x, bounds.zMax - skylineInsetFar - 2);
  }
  for (let z = bounds.zMin + 10; z <= bounds.zMax - 10; z += 14) {
    placeEdgeTower(bounds.xMin + skylineInsetFar, z);
    placeEdgeTower(bounds.xMax - skylineInsetFar - 2, z);
  }

  // 4) Broken anti-vehicle bollards near exits to reinforce edge readability.
  for (let x = bounds.xMin + 8; x <= bounds.xMax - 8; x += 12) {
    const southY = heightAt(x, bounds.zMin + 3, bounds);
    const northY = heightAt(x, bounds.zMax - 3, bounds);
    setVoxel(x, southY + 1, bounds.zMin + 3, metal);
    setVoxel(x, southY + 2, bounds.zMin + 3, metal);
    setVoxel(x, northY + 1, bounds.zMax - 3, metal);
    setVoxel(x, northY + 2, bounds.zMax - 3, metal);
  }
}

// ---------------------------------------------------------------------------
// Strike at Karkand generators — corrected layout (S→N attack axis)
// ---------------------------------------------------------------------------

function karkandHash(x: number, z: number): number {
  const n = Math.imul(x * 73856093, 1) ^ Math.imul(z * 19349663, 1);
  return (n >>> 0) % 9973;
}

function generateKarkandRoads(bounds: MapdefBounds, P: Record<string, number>): void {
  console.log('  Generating Karkand roads...');
  const road = P.ROAD ?? 18;
  const sidewalk = P.CONCRETE ?? 11;
  const railGravel = P.RAIL_GRAVEL ?? 22;
  const railSteel = P.RAIL_STEEL ?? 21;

  // Helper: lay a road segment with headroom clearing
  const layRoad = (x: number, z: number, mat: number): void => {
    if (x < bounds.xMin || x > bounds.xMax || z < bounds.zMin || z > bounds.zMax) return;
    const y = heightAt(x, z, bounds);
    setVoxel(x, y, z, mat);
    for (let cy = y + 1; cy <= y + 7; cy++) setVoxel(x, cy, z, 0);
  };

  // Main road S→N: Gas Station (-33,-417) → Hotel (-100,-167) → Square (-133,33) → (-100,200)
  // Width: 11 voxels, sidewalks: 2 wide on each side
  // Segment 1: Gas Station to Hotel
  for (let z = -417; z <= -167; z++) {
    const t = (z + 417) / 250;
    const xCenter = Math.round(-33 + t * (-100 - (-33)));
    for (let xOff = -5; xOff <= 5; xOff++) {
      layRoad(xCenter + xOff, z, road);
    }
    for (const xOff of [-7, -6, 6, 7]) {
      const rx = xCenter + xOff;
      const y = heightAt(rx, z, bounds);
      setVoxel(rx, y, z, sidewalk);
      for (let cy = y + 1; cy <= y + 5; cy++) setVoxel(rx, cy, z, 0);
    }
  }
  // Segment 2: Hotel to Square
  for (let z = -167; z <= 33; z++) {
    const t = (z + 167) / 200;
    const xCenter = Math.round(-100 + t * (-133 - (-100)));
    for (let xOff = -5; xOff <= 5; xOff++) {
      layRoad(xCenter + xOff, z, road);
    }
    for (const xOff of [-7, -6, 6, 7]) {
      const rx = xCenter + xOff;
      const y = heightAt(rx, z, bounds);
      setVoxel(rx, y, z, sidewalk);
      for (let cy = y + 1; cy <= y + 5; cy++) setVoxel(rx, cy, z, 0);
    }
  }
  // Segment 3: Square northward — x=-100 straight, z goes 33 to 200
  for (let z = 33; z <= 200; z++) {
    for (let xOff = -5; xOff <= 5; xOff++) {
      layRoad(-100 + xOff, z, road);
    }
  }

  // Eastern approach: fork from Hotel toward Suburb and Train Wreck
  // From (-67, -133) east to (50, 100) and (133, 150). Width: 7 voxels
  for (let z = -133; z <= 150; z++) {
    const t = (z + 133) / 283;
    const xCenter = Math.round(-67 + t * (133 - (-67)));
    for (let xOff = -3; xOff <= 3; xOff++) {
      layRoad(xCenter + xOff, z, road);
    }
  }

  // Industrial road: Gatehouse (233,217) → Cement Factory (283,300) → Warehouse (100,367) → Factory (167,450)
  // Width: 7 voxels
  // Gatehouse to Cement Factory
  for (let z = 217; z <= 300; z++) {
    const t = (z - 217) / 83;
    const xCenter = Math.round(233 + t * (283 - 233));
    for (let xOff = -3; xOff <= 3; xOff++) {
      layRoad(xCenter + xOff, z, road);
    }
  }
  // Cement Factory to Warehouse
  for (let z = 300; z <= 367; z++) {
    const t = (z - 300) / 67;
    const xCenter = Math.round(283 + t * (100 - 283));
    for (let xOff = -3; xOff <= 3; xOff++) {
      layRoad(xCenter + xOff, z, road);
    }
  }
  // Warehouse to Factory
  for (let z = 367; z <= 450; z++) {
    const t = (z - 367) / 83;
    const xCenter = Math.round(100 + t * (167 - 100));
    for (let xOff = -3; xOff <= 3; xOff++) {
      layRoad(xCenter + xOff, z, road);
    }
  }

  // Railroad: z ≈ 140-167, east toward Train Wreck area
  for (let x = -200; x <= 167; x++) {
    const zCenter = 140 + Math.round(Math.sin(x / 40) * 5);
    for (let zOff = -2; zOff <= 2; zOff++) {
      layRoad(x, zCenter + zOff, railGravel);
    }
    layRoad(x, zCenter - 1, railSteel);
    layRoad(x, zCenter + 1, railSteel);
  }

  // Alley grid in urban core only (x: -300..67, z: -233..200)
  // Spacing: 60 voxels, alley width: 5 voxels
  for (let zLine = -233; zLine <= 200; zLine += 60) {
    for (let x = -300; x <= 67; x++) {
      for (let zOff = -2; zOff <= 2; zOff++) {
        layRoad(x, zLine + zOff, road);
      }
    }
  }
  for (let xLine = -300; xLine <= 67; xLine += 60) {
    for (let z = -233; z <= 200; z++) {
      for (let xOff = -2; xOff <= 2; xOff++) {
        layRoad(xLine + xOff, z, road);
      }
    }
  }
}

function generateKarkandBuildings(bounds: MapdefBounds, P: Record<string, number>): void {
  console.log('  Generating Karkand buildings...');
  const facades = [P.STUCCO ?? 25, P.STUCCO_DARK ?? 26, P.BRICK ?? 15, P.STONE ?? 3];
  const roofs = [P.ROOF_TILE ?? 16, P.CONCRETE ?? 11, P.STUCCO_DARK ?? 26];
  const metal = P.METAL ?? 20;

  // Building grid restricted to urban core: x: -300 to 67, z: -233 to 200
  const blockStartX = -300;
  const blockEndX = 67;
  const blockStartZ = -233;
  const blockEndZ = 200;
  const blockSize = 60; // matches alley spacing

  for (let bx = blockStartX; bx < blockEndX; bx += blockSize) {
    for (let bz = blockStartZ; bz < blockEndZ; bz += blockSize) {
      // Inner lot area (skip road corridors of 5 voxels)
      const lotX1 = bx + 4;
      const lotX2 = bx + blockSize - 4;
      const lotZ1 = bz + 4;
      const lotZ2 = bz + blockSize - 4;
      const lotW = lotX2 - lotX1;
      const lotD = lotZ2 - lotZ1;

      if (lotW < 6 || lotD < 6) continue;

      // Skip lots that overlap landmark areas
      const cx = (lotX1 + lotX2) / 2;
      const cz = (lotZ1 + lotZ2) / 2;
      // Skip Hotel area (-100, -167) — ±30 around center
      if (cx > -130 && cx < -70 && cz > -200 && cz < -134) continue;
      // Skip Square area (-133, 33) — ±30 around center
      if (cx > -163 && cx < -103 && cz > 3 && cz < 63) continue;
      // Skip Suburb area (50, 100) — ±30 around center
      if (cx > 20 && cx < 80 && cz > 70 && cz < 130) continue;

      const h = karkandHash(bx, bz);

      // Subdivide into 2 lots (split along longer axis)
      const splitHoriz = lotW > lotD;
      const lots: Array<[number, number, number, number]> = [];
      if (splitHoriz) {
        const mid = lotX1 + Math.floor(lotW / 2);
        lots.push([lotX1, lotZ1, mid - 1, lotZ2]);
        lots.push([mid + 1, lotZ1, lotX2, lotZ2]);
      } else {
        const mid = lotZ1 + Math.floor(lotD / 2);
        lots.push([lotX1, lotZ1, lotX2, mid - 1]);
        lots.push([lotX1, mid + 1, lotX2, lotZ2]);
      }

      for (const [lx1, lz1, lx2, lz2] of lots) {
        const w = lx2 - lx1 + 1;
        const d = lz2 - lz1 + 1;
        if (w < 5 || d < 5) continue;

        const lh = karkandHash(lx1, lz1);
        const stories = 1 + (lh % 3);
        const floorH = 4 + (lh % 2);
        const facade = facades[lh % facades.length];
        const roof = roofs[(lh >> 2) % roofs.length];

        makeBuilding({
          x: lx1,
          z: lz1,
          w: Math.min(w, 22),
          d: Math.min(d, 22),
          h: floorH,
          stories,
          material: facade,
          roofMaterial: roof,
          hasDoors: true,
          hasWindows: true,
          hasBalcony: stories >= 2 && (lh % 3 === 0),
        }, bounds, P);

        // Rooftop stairwell box on taller buildings
        if (stories >= 2) {
          const baseY = heightAt(lx1 + Math.floor(w / 2), lz1 + Math.floor(d / 2), bounds);
          const roofY = baseY + stories * floorH;
          const stairW = Math.min(3, w - 2);
          const stairD = Math.min(3, d - 2);
          fillBox(lx1 + 1, roofY + 1, lz1 + 1,
                  lx1 + stairW, roofY + 3, lz1 + stairD, facade);
          setVoxel(lx1 + 1, roofY + 1, lz1 + 1, 0);
          setVoxel(lx1 + 1, roofY + 2, lz1 + 1, 0);
        }

        // Parapet on flat roofs
        if (lh % 2 === 0 && stories >= 1) {
          const baseY = heightAt(lx1 + Math.floor(w / 2), lz1 + Math.floor(d / 2), bounds);
          const roofY = baseY + stories * floorH;
          const bw = Math.min(w, 22);
          const bd = Math.min(d, 22);
          for (let x = lx1; x < lx1 + bw; x++) {
            setVoxel(x, roofY + 1, lz1, metal);
            setVoxel(x, roofY + 1, lz1 + bd - 1, metal);
          }
          for (let z = lz1; z < lz1 + bd; z++) {
            setVoxel(lx1, roofY + 1, z, metal);
            setVoxel(lx1 + bw - 1, roofY + 1, z, metal);
          }
        }
      }
    }
  }
}

function generateGasStation(bounds: MapdefBounds, P: Record<string, number>): void {
  console.log('  Generating Gas Station (USMC base)...');
  const concrete = P.CONCRETE ?? 11;
  const metal = P.METAL ?? 20;
  const road = P.ROAD ?? 18;
  const stucco = P.STUCCO ?? 25;
  const brick = P.BRICK ?? 15;
  // Center: (-33, -417), far south
  const baseY = heightAt(-33, -417, bounds);

  // Asphalt pad 45×45
  fillBox(-55, baseY, -440, -10, baseY, -395, road);
  for (let x = -55; x <= -10; x++) {
    for (let z = -440; z <= -395; z++) {
      for (let y = baseY + 1; y <= baseY + 8; y++) setVoxel(x, y, z, 0);
    }
  }

  // Canopy: metal roof 36×36 supported by 4 pillars
  fillBox(-51, baseY + 6, -435, -15, baseY + 6, -400, metal);
  for (const [px, pz] of [[-51, -435], [-51, -400], [-15, -435], [-15, -400]] as [number, number][]) {
    for (let y = baseY + 1; y <= baseY + 5; y++) setVoxel(px, y, pz, metal);
  }

  // Fuel pumps (3 sets of 2×1×2)
  for (let i = 0; i < 3; i++) {
    const px = -47 + i * 12;
    fillBox(px, baseY + 1, -420, px + 1, baseY + 2, -419, concrete);
  }

  // Shop building 15×12
  makeBuilding({
    x: -48, z: -397, w: 15, d: 12, h: 4, stories: 1,
    material: stucco, roofMaterial: metal,
    hasDoors: true, hasWindows: true,
  }, bounds, P);

  // Perimeter wall 50×50 (low)
  for (let x = -58; x <= -8; x++) {
    setVoxel(x, baseY + 1, -442, brick);
    setVoxel(x, baseY + 2, -442, brick);
    setVoxel(x, baseY + 1, -392, brick);
    setVoxel(x, baseY + 2, -392, brick);
  }
  for (let z = -442; z <= -392; z++) {
    setVoxel(-58, baseY + 1, z, brick);
    setVoxel(-58, baseY + 2, z, brick);
    setVoxel(-8, baseY + 1, z, brick);
    setVoxel(-8, baseY + 2, z, brick);
  }
  // Gate opening 7-wide (north side)
  for (let y = baseY + 1; y <= baseY + 2; y++) {
    for (let x = -36; x <= -30; x++) {
      setVoxel(x, y, -392, 0);
    }
  }

  // Burnt vehicle hulks (2)
  fillBox(-25, baseY + 1, -425, -21, baseY + 2, -423, metal);
  fillBox(-18, baseY + 1, -438, -14, baseY + 2, -436, metal);
}

function generateHotel(bounds: MapdefBounds, P: Record<string, number>): void {
  console.log('  Generating Hotel (Flag 1)...');
  const stucco = P.STUCCO ?? 25;
  const stuccoDark = P.STUCCO_DARK ?? 26;
  const metal = P.METAL ?? 20;
  const concrete = P.CONCRETE ?? 11;
  // Center: (-100, -167), south-center urban
  const baseY = heightAt(-100, -167, bounds);

  // Main 5-story hotel building 24×18
  makeBuilding({
    x: -112, z: -176, w: 24, d: 18, h: 4, stories: 5,
    material: stucco, roofMaterial: metal,
    hasDoors: true, hasWindows: true, hasBalcony: true,
  }, bounds, P);

  // Lobby entrance: 5-wide door on south face
  for (let dy = 1; dy <= 3; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      setVoxel(-100 + dx, baseY + dy, -176, 0);
    }
  }

  // Ladders on side walls (east and west)
  for (let y = baseY + 1; y <= baseY + 20; y++) {
    setVoxel(-112, y, -167, metal);
    setVoxel(-88, y, -167, metal);
  }

  // Rooftop water tank (iconic BF2 feature)
  const roofY = baseY + 5 * 4;
  fillBox(-106, roofY + 1, -170, -104, roofY + 3, -168, metal);

  // Courtyard to the south: 24×15 open area with low walls
  fillBox(-112, baseY, -193, -88, baseY, -178, concrete);
  for (let x = -112; x <= -88; x++) {
    setVoxel(x, baseY + 1, -193, stuccoDark);
  }
  for (let z = -193; z <= -178; z++) {
    setVoxel(-112, baseY + 1, z, stuccoDark);
    setVoxel(-88, baseY + 1, z, stuccoDark);
  }
  // Courtyard gate
  for (let dx = -1; dx <= 1; dx++) {
    setVoxel(-100 + dx, baseY + 1, -193, 0);
  }
}

function generateSquare(bounds: MapdefBounds, P: Record<string, number>): void {
  console.log('  Generating Square (Flag 2)...');
  const concrete = P.CONCRETE ?? 11;
  const stone = P.STONE ?? 3;
  const stucco = P.STUCCO ?? 25;
  const minaret = P.MINARET_WHITE ?? 28;
  // Center: (-133, 33), central urban
  const baseY = heightAt(-133, 33, bounds);

  // Open plaza 36×36
  fillBox(-151, baseY, 15, -115, baseY, 51, concrete);
  for (let x = -151; x <= -115; x++) {
    for (let z = 15; z <= 51; z++) {
      for (let y = baseY + 1; y <= baseY + 10; y++) setVoxel(x, y, z, 0);
    }
  }

  // Central fountain: stone ring 7×7, water center
  fillBox(-136, baseY + 1, 30, -130, baseY + 1, 36, stone);
  fillBox(-135, baseY + 1, 31, -131, baseY + 1, 35, 0); // hollow out center
  setVoxel(-133, baseY + 1, 33, P.WATER ?? 6);

  // Corner planters (4 corners of plaza)
  for (const [px, pz] of [[-150, 16], [-150, 50], [-116, 16], [-116, 50]] as [number, number][]) {
    fillBox(px, baseY + 1, pz, px + 2, baseY + 1, pz + 2, stone);
    setVoxel(px + 1, baseY + 2, pz + 1, P.GRASS ?? 1);
  }

  // Minaret tower (12 high, iconic) — 2×2 base
  const minaretX = -116;
  const minaretZ = 50;
  for (let y = baseY + 1; y <= baseY + 12; y++) {
    setVoxel(minaretX, y, minaretZ, minaret);
    setVoxel(minaretX + 1, y, minaretZ, minaret);
    setVoxel(minaretX, y, minaretZ + 1, minaret);
    setVoxel(minaretX + 1, y, minaretZ + 1, minaret);
  }
  // Balcony ring at top
  for (let dx = -1; dx <= 2; dx++) {
    for (let dz = -1; dz <= 2; dz++) {
      if (dx >= 0 && dx <= 1 && dz >= 0 && dz <= 1) continue;
      setVoxel(minaretX + dx, baseY + 10, minaretZ + dz, minaret);
    }
  }
  // Pointed top
  setVoxel(minaretX, baseY + 13, minaretZ, minaret);
  setVoxel(minaretX + 1, baseY + 13, minaretZ, minaret);
  setVoxel(minaretX, baseY + 14, minaretZ, minaret);

  // Hole in eastern wall (flanking route)
  for (let dy = 1; dy <= 3; dy++) {
    for (let dz = 30; dz <= 36; dz++) {
      setVoxel(-115, baseY + dy, dz, 0);
    }
  }

  // Mosque building 12×15 beside the square
  makeBuilding({
    x: -115, z: 26, w: 12, d: 15, h: 5, stories: 2,
    material: stucco, roofMaterial: P.ROOF_TILE ?? 16,
    hasDoors: true, hasWindows: true,
  }, bounds, P);
}

function generateCementFactory(bounds: MapdefBounds, P: Record<string, number>): void {
  console.log('  Generating Cement Factory (Flag 6)...');
  const concrete = P.CONCRETE ?? 11;
  const metal = P.METAL ?? 20;
  const stuccoDark = P.STUCCO_DARK ?? 26;
  const brick = P.BRICK ?? 15;
  // Center: (283, 300), NE industrial zone
  const baseY = heightAt(283, 300, bounds);

  // Ground pad 45×42
  fillBox(261, baseY, 279, 306, baseY, 321, concrete);
  for (let x = 261; x <= 306; x++) {
    for (let z = 279; z <= 321; z++) {
      for (let y = baseY + 1; y <= baseY + 16; y++) setVoxel(x, y, z, 0);
    }
  }

  // Main factory building 27×21
  makeBuilding({
    x: 264, z: 282, w: 27, d: 21, h: 5, stories: 2,
    material: stuccoDark, roofMaterial: metal,
    hasDoors: true, hasWindows: true,
  }, bounds, P);

  // Chimneys (2 tall smokestacks) — scaled relative positions
  for (let y = baseY + 1; y <= baseY + 14; y++) {
    setVoxel(270, y, 288, brick);
    setVoxel(271, y, 288, brick);
    setVoxel(270, y, 289, brick);
    setVoxel(271, y, 289, brick);

    setVoxel(285, y, 288, brick);
    setVoxel(286, y, 288, brick);
    setVoxel(285, y, 289, brick);
    setVoxel(286, y, 289, brick);
  }

  // Storage silos (2 cylindrical approximations, radius 3)
  for (let y = baseY + 1; y <= baseY + 8; y++) {
    for (let dx = -3; dx <= 3; dx++) {
      for (let dz = -3; dz <= 3; dz++) {
        if (dx * dx + dz * dz <= 9) {
          setVoxel(298 + dx, y, 290 + dz, concrete);
          setVoxel(298 + dx, y, 305 + dz, concrete);
        }
      }
    }
  }

  // Loading area on south side
  fillBox(267, baseY, 277, 285, baseY + 1, 279, concrete);
  // Loading dock ramp
  fillBox(273, baseY + 1, 277, 281, baseY + 1, 278, concrete);
}

function generateSuburb(bounds: MapdefBounds, P: Record<string, number>): void {
  console.log('  Generating Suburb (Flag 3)...');
  const stucco = P.STUCCO ?? 25;
  const stuccoDark = P.STUCCO_DARK ?? 26;
  const brick = P.BRICK ?? 15;
  const concrete = P.CONCRETE ?? 11;
  const grass = P.GRASS ?? 1;
  const road = P.ROAD ?? 18;
  const metal = P.METAL ?? 20;
  // Center: (50, 100), east of Square, elevated rocky cliffs
  const baseY = heightAt(50, 100, bounds);

  // 6 houses, each 12×12, spread across ~80×80 area
  const houses: Array<{ x: number; z: number; w: number; d: number; stories: number; mat: number }> = [
    { x: 10, z: 70, w: 12, d: 12, stories: 2, mat: stucco },
    { x: 35, z: 65, w: 12, d: 12, stories: 1, mat: stuccoDark },
    { x: 60, z: 72, w: 12, d: 12, stories: 2, mat: brick },
    { x: 15, z: 105, w: 12, d: 12, stories: 1, mat: stucco },
    { x: 40, z: 110, w: 12, d: 12, stories: 2, mat: stuccoDark },
    { x: 65, z: 100, w: 12, d: 12, stories: 1, mat: brick },
  ];

  for (const h of houses) {
    makeBuilding({
      x: h.x, z: h.z, w: h.w, d: h.d, h: 4, stories: h.stories,
      material: h.mat, roofMaterial: P.ROOF_TILE ?? 16,
      hasDoors: true, hasWindows: true,
    }, bounds, P);

    // Small garden/yard in front of each house
    const gardenZ = h.z - 3;
    fillBox(h.x, heightAt(h.x, gardenZ, bounds), gardenZ, h.x + h.w - 1, heightAt(h.x, gardenZ, bounds), gardenZ + 2, grass);
  }

  // MG emplacement on the highest point
  const mgY = heightAt(55, 90, bounds);
  fillBox(52, mgY + 1, 87, 58, mgY + 2, 93, concrete);
  // Sandbag ring around MG
  for (let dx = -1; dx <= 7; dx++) {
    setVoxel(51 + dx, mgY + 3, 86, P.SAND_DARK ?? 8);
    setVoxel(51 + dx, mgY + 3, 94, P.SAND_DARK ?? 8);
  }
  for (let dz = 86; dz <= 94; dz++) {
    setVoxel(51, mgY + 3, dz, P.SAND_DARK ?? 8);
    setVoxel(59, mgY + 3, dz, P.SAND_DARK ?? 8);
  }

  // Wider residential road (5-wide)
  for (let z = 60; z <= 130; z++) {
    const xCenter = 50 + Math.round(Math.sin(z / 12) * 6);
    for (let xOff = -2; xOff <= 2; xOff++) {
      const y = heightAt(xCenter + xOff, z, bounds);
      setVoxel(xCenter + xOff, y, z, road);
      for (let cy = y + 1; cy <= y + 5; cy++) setVoxel(xCenter + xOff, cy, z, 0);
    }
  }

  // Exterior stairs on hillside
  for (let step = 0; step < 6; step++) {
    const sx = 80;
    const sz = 85 + step * 3;
    const y = heightAt(sx, sz, bounds);
    fillBox(sx, y, sz, sx + 3, y, sz + 2, concrete);
  }
}

function generateTrainWreck(bounds: MapdefBounds, P: Record<string, number>): void {
  console.log('  Generating Train Wreck (Flag 4)...');
  const metal = P.METAL ?? 20;
  const railSteel = P.RAIL_STEEL ?? 21;
  const railGravel = P.RAIL_GRAVEL ?? 22;
  const concrete = P.CONCRETE ?? 11;
  const wood = P.WOOD ?? 13;
  // Center: (133, 150), east, near water crossing
  const baseY = heightAt(133, 150, bounds);

  // Platform 36×24
  fillBox(115, baseY, 138, 151, baseY + 1, 162, concrete);
  for (let x = 115; x <= 151; x++) {
    for (let z = 138; z <= 162; z++) {
      for (let y = baseY + 2; y <= baseY + 8; y++) setVoxel(x, y, z, 0);
    }
  }

  // 3 derailed train cars (18×6×4 each) along tracks
  const cars: Array<{ x: number; z: number; angle: number }> = [
    { x: 117, z: 143, angle: 0 },
    { x: 126, z: 146, angle: 1 },
    { x: 138, z: 142, angle: 0 },
  ];

  for (const car of cars) {
    const carW = 18;
    const carD = 6;
    const carH = 4;
    // Car body
    fillBox(car.x, baseY + 1, car.z, car.x + carW - 1, baseY + carH, car.z + carD - 1, metal);
    // Hollow interior
    fillBox(car.x + 1, baseY + 2, car.z + 1, car.x + carW - 2, baseY + carH - 1, car.z + carD - 2, 0);
    // Side openings (doors/windows)
    for (let dx = 4; dx <= 13; dx += 4) {
      for (let dy = 2; dy <= 3; dy++) {
        setVoxel(car.x + dx, baseY + dy, car.z, 0);
        setVoxel(car.x + dx, baseY + dy, car.z + carD - 1, 0);
      }
    }
    // Tilted car effect for middle car
    if (car.angle !== 0) {
      for (let dx = 0; dx < carW; dx++) {
        setVoxel(car.x + dx, baseY + carH + 1, car.z + carD - 1, metal);
      }
    }
  }

  // More debris between cars
  fillBox(135, baseY + 1, 152, 138, baseY + 2, 155, railSteel);
  fillBox(122, baseY + 1, 158, 125, baseY + 1, 160, wood);
  fillBox(140, baseY + 1, 148, 142, baseY + 2, 150, railSteel);
}

function generateWarehouse(bounds: MapdefBounds, P: Record<string, number>): void {
  console.log('  Generating Warehouse (Flag 7)...');
  const concrete = P.CONCRETE ?? 11;
  const metal = P.METAL ?? 20;
  const stuccoDark = P.STUCCO_DARK ?? 26;
  const wood = P.WOOD ?? 13;
  const sandbag = P.SAND_DARK ?? 8;
  // Center: (100, 367), north, strong defensive position
  const baseY = heightAt(100, 367, bounds);

  // Main warehouse 30×22
  const wX = 85;
  const wZ = 356;
  const wW = 30;
  const wD = 22;
  const wH = 8;

  // Floor
  fillBox(wX, baseY, wZ, wX + wW - 1, baseY, wZ + wD - 1, concrete);
  // Clear interior headroom
  for (let x = wX; x < wX + wW; x++) {
    for (let z = wZ; z < wZ + wD; z++) {
      for (let y = baseY + 1; y <= baseY + wH + 2; y++) setVoxel(x, y, z, 0);
    }
  }

  // Walls
  for (let y = baseY + 1; y <= baseY + wH; y++) {
    for (let x = wX; x < wX + wW; x++) {
      setVoxel(x, y, wZ, stuccoDark);
      setVoxel(x, y, wZ + wD - 1, stuccoDark);
    }
    for (let z = wZ; z < wZ + wD; z++) {
      setVoxel(wX, y, z, stuccoDark);
      setVoxel(wX + wW - 1, y, z, stuccoDark);
    }
  }

  // Roof
  fillBox(wX, baseY + wH, wZ, wX + wW - 1, baseY + wH, wZ + wD - 1, metal);

  // 3 bay doors (6-wide each on south wall)
  for (let door = 0; door < 3; door++) {
    const doorX = wX + 3 + door * 9;
    for (let dx = 0; dx < 6; dx++) {
      for (let dy = 1; dy <= 5; dy++) {
        setVoxel(doorX + dx, baseY + dy, wZ, 0);
      }
    }
  }

  // Interior columns (support structure)
  for (const [colX, colZ] of [[wX + 7, wZ + 7], [wX + 22, wZ + 7], [wX + 7, wZ + 15], [wX + 22, wZ + 15]] as [number, number][]) {
    for (let y = baseY + 1; y <= baseY + wH; y++) {
      setVoxel(colX, y, colZ, concrete);
    }
  }

  // Catwalk across interior (elevated walkway)
  fillBox(wX + 3, baseY + 4, wZ + 10, wX + wW - 4, baseY + 4, wZ + 12, metal);

  // MG position front (south side)
  fillBox(wX + 12, baseY + 1, wZ - 4, wX + 18, baseY + 2, wZ - 1, sandbag);
  // MG position back (north side)
  fillBox(wX + 12, baseY + 1, wZ + wD + 1, wX + 18, baseY + 2, wZ + wD + 4, sandbag);

  // Crate stacks inside
  fillBox(wX + 3, baseY + 1, wZ + 3, wX + 6, baseY + 3, wZ + 5, wood);
  fillBox(wX + 23, baseY + 1, wZ + 3, wX + 26, baseY + 2, wZ + 6, wood);
  fillBox(wX + 12, baseY + 1, wZ + 16, wX + 16, baseY + 2, wZ + 19, wood);

  // Flanking routes: openings in east and west walls
  for (let dy = 1; dy <= 3; dy++) {
    for (let dz = 7; dz <= 12; dz++) {
      setVoxel(wX, baseY + dy, wZ + dz, 0);
      setVoxel(wX + wW - 1, baseY + dy, wZ + dz, 0);
    }
  }

  // Loading dock on north side
  fillBox(wX + 5, baseY, wZ + wD, wX + wW - 6, baseY + 1, wZ + wD + 4, concrete);
}

function generateGatehouse(bounds: MapdefBounds, P: Record<string, number>): void {
  console.log('  Generating Gatehouse (Flag 5)...');
  const stone = P.STONE ?? 3;
  const stucco = P.STUCCO ?? 25;
  const stuccoDark = P.STUCCO_DARK ?? 26;
  const metal = P.METAL ?? 20;
  const brick = P.BRICK ?? 15;
  const concrete = P.CONCRETE ?? 11;
  // Center: (233, 217), NE, across the water from Train Wreck
  const baseY = heightAt(233, 217, bounds);

  // 38×38 perimeter stone wall
  const gx = 214;
  const gz = 198;
  const gw = 38;
  const gd = 38;
  const wallH = 5;

  // Clear interior
  for (let x = gx; x < gx + gw; x++) {
    for (let z = gz; z < gz + gd; z++) {
      for (let y = baseY + 1; y <= baseY + 15; y++) setVoxel(x, y, z, 0);
    }
  }

  // Walls
  for (let y = baseY + 1; y <= baseY + wallH; y++) {
    for (let x = gx; x < gx + gw; x++) {
      setVoxel(x, y, gz, stone);
      setVoxel(x, y, gz + gd - 1, stone);
    }
    for (let z = gz; z < gz + gd; z++) {
      setVoxel(gx, y, z, stone);
      setVoxel(gx + gw - 1, y, z, stone);
    }
  }

  // Crenellations
  for (let x = gx; x < gx + gw; x += 2) {
    setVoxel(x, baseY + wallH + 1, gz, stone);
    setVoxel(x, baseY + wallH + 1, gz + gd - 1, stone);
  }
  for (let z = gz; z < gz + gd; z += 2) {
    setVoxel(gx, baseY + wallH + 1, z, stone);
    setVoxel(gx + gw - 1, baseY + wallH + 1, z, stone);
  }

  // Gate opening (west wall, 7-wide)
  for (let dy = 1; dy <= 4; dy++) {
    for (let dz = -3; dz <= 3; dz++) {
      setVoxel(gx, baseY + dy, gz + Math.floor(gd / 2) + dz, 0);
    }
  }

  // Gate tower above entrance
  const towerX = gx - 1;
  const towerZ = gz + Math.floor(gd / 2) - 4;
  for (let y = baseY + 1; y <= baseY + 8; y++) {
    for (let x = towerX; x <= towerX + 3; x++) {
      setVoxel(x, y, towerZ, stone);
      setVoxel(x, y, towerZ + 8, stone);
    }
    for (let z = towerZ; z <= towerZ + 8; z++) {
      setVoxel(towerX, y, z, stone);
      setVoxel(towerX + 3, y, z, stone);
    }
  }
  fillBox(towerX, baseY + 8, towerZ, towerX + 3, baseY + 8, towerZ + 8, stone);

  // Interior barracks (2 buildings, 12×9 each)
  makeBuilding({
    x: gx + 4, z: gz + 4, w: 12, d: 9, h: 4, stories: 1,
    material: stucco, roofMaterial: metal,
    hasDoors: true, hasWindows: true,
  }, bounds, P);
  makeBuilding({
    x: gx + 22, z: gz + 4, w: 12, d: 9, h: 4, stories: 1,
    material: stuccoDark, roofMaterial: metal,
    hasDoors: true, hasWindows: true,
  }, bounds, P);

  // Flag tower in compound center
  const flagX = gx + Math.floor(gw / 2);
  const flagZ = gz + Math.floor(gd / 2);
  for (let y = baseY + 1; y <= baseY + 10; y++) {
    setVoxel(flagX, y, flagZ, metal);
  }
  fillBox(flagX + 1, baseY + 8, flagZ, flagX + 3, baseY + 10, flagZ, brick);

  // Interior courtyard ground
  fillBox(gx + 1, baseY, gz + 1, gx + gw - 2, baseY, gz + gd - 2, concrete);
}

function generateKarkandCover(bounds: MapdefBounds, P: Record<string, number>): void {
  console.log('  Generating Karkand tactical cover...');
  const sandbag = P.SAND_DARK ?? 8;
  const concrete = P.CONCRETE ?? 11;
  const concreteDark = P.STUCCO_DARK ?? 26;
  const metal = P.METAL ?? 20;
  const wood = P.WOOD ?? 13;

  // Intersection sandbags at new landmark positions
  const intersections: [number, number][] = [
    [-100, -167], [-133, 33], [-67, -100], [-83, -33],
    [0, 67], [50, 100], [133, 150], [100, 200],
    [233, 217], [167, 267], [100, 333], [-33, -300],
  ];
  for (const [ix, iz] of intersections) {
    const y = heightAt(ix, iz, bounds);
    for (let dx = -2; dx <= 2; dx++) {
      setVoxel(ix + dx, y + 1, iz - 4, sandbag);
      setVoxel(ix + dx, y + 2, iz - 4, sandbag);
    }
    for (let dz = -4; dz <= 0; dz++) {
      setVoxel(ix + 3, y + 1, iz + dz, sandbag);
      setVoxel(ix + 3, y + 2, iz + dz, sandbag);
    }
  }

  // Jersey barriers along new road network
  const barriers: [number, number, number, number][] = [
    [-67, -267, 1, 6], [-100, -100, 1, 6], [-117, 100, 6, 1],
    [33, 50, 6, 1], [167, 183, 1, 5], [250, 267, 5, 1],
  ];
  for (const [bx, bz, lenX, lenZ] of barriers) {
    for (let x = bx; x < bx + lenX; x++) {
      for (let z = bz; z < bz + lenZ; z++) {
        const y = heightAt(x, z, bounds);
        setVoxel(x, y + 1, z, concreteDark);
        setVoxel(x, y + 2, z, concreteDark);
        setVoxel(x, y + 3, z, concrete);
      }
    }
  }

  // Burnt vehicles scattered along road network
  const vehicles: [number, number][] = [
    [-50, -300], [-83, -67], [-117, 133], [17, 33],
    [100, 167], [200, 233], [133, 333],
  ];
  for (const [vx, vz] of vehicles) {
    const y = heightAt(vx, vz, bounds);
    fillBox(vx, y + 1, vz, vx + 3, y + 2, vz + 1, metal);
    setVoxel(vx, y + 1, vz - 1, metal);
    setVoxel(vx + 3, y + 1, vz - 1, metal);
    setVoxel(vx, y + 1, vz + 2, metal);
    setVoxel(vx + 3, y + 1, vz + 2, metal);
  }

  // Rubble piles in alleys (urban core only: x:-300..67, z:-233..200)
  for (let x = -290; x <= 57; x += 90) {
    for (let z = -223; z <= 190; z += 90) {
      const h = karkandHash(x, z);
      if (h % 7 !== 0) continue;
      const r = 2 + (h % 3);
      const baseY = heightAt(x, z, bounds);
      for (let rx = x - r; rx <= x + r; rx++) {
        for (let rz = z - r; rz <= z + r; rz++) {
          const d = Math.hypot(rx - x, rz - z);
          if (d > r) continue;
          const top = Math.max(1, Math.round((1 - d / r) * (1 + (h % 2))));
          for (let yy = 1; yy <= top; yy++) setVoxel(rx, baseY + yy, rz, P.STONE ?? 3);
        }
      }
    }
  }

  // Crate stacks near buildings (urban core)
  for (let x = -290; x <= 57; x += 70) {
    for (let z = -223; z <= 190; z += 70) {
      const h = karkandHash(x + 5, z - 3);
      if (h % 8 !== 0) continue;
      const y = heightAt(x, z, bounds);
      fillBox(x, y + 1, z, x + 1, y + 2, z + 1, wood);
    }
  }
}

function generateKarkandOutskirts(bounds: MapdefBounds, P: Record<string, number>): void {
  console.log('  Generating Karkand outskirts...');
  const stone = P.STONE ?? 3;
  const sandDark = P.SAND_DARK ?? 8;
  const sandLight = P.SAND_LIGHT ?? 7;
  const stuccoDark = P.STUCCO_DARK ?? 26;

  // Rock formations — positions scaled 3.33x
  const rockPositions: [number, number, number][] = [
    [117, 83, 4], [133, 117, 5], [100, 133, 3],   // Suburb cliffs area
    [-400, -333, 4], [-433, -267, 3],               // South approach edges
    [-467, 167, 3], [-433, 433, 4],                  // Western edges
    [400, 400, 5], [433, 267, 4],                    // NE industrial edges
    [-333, -467, 3], [333, -400, 4],                 // Far south
  ];
  for (const [rx, rz, r] of rockPositions) {
    if (rx < bounds.xMin || rx > bounds.xMax || rz < bounds.zMin || rz > bounds.zMax) continue;
    const baseY = heightAt(rx, rz, bounds);
    for (let dx = -r; dx <= r; dx++) {
      for (let dz = -r; dz <= r; dz++) {
        for (let dy = 0; dy <= r; dy++) {
          const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
          if (dist <= r) {
            const wx = rx + dx;
            const wz = rz + dz;
            if (wx < bounds.xMin || wx > bounds.xMax || wz < bounds.zMin || wz > bounds.zMax) continue;
            setVoxel(wx, baseY + dy, wz, stone);
          }
        }
      }
    }
  }

  // Sand dunes — step 100, skip urban core and industrial zone at new boundaries
  for (let x = bounds.xMin + 10; x <= bounds.xMax - 10; x += 100) {
    for (let z = bounds.zMin + 10; z <= bounds.zMax - 10; z += 100) {
      // Skip urban core (-300..67, -233..200)
      if (x > -310 && x < 77 && z > -243 && z < 210) continue;
      // Skip industrial zone (167..400, 183..483)
      if (x > 157 && x < 410 && z > 173 && z < 493) continue;
      const h = karkandHash(x, z);
      if (h % 4 !== 0) continue;
      const r = 4 + (h % 5);
      const baseY = heightAt(x, z, bounds);
      for (let dx = -r; dx <= r; dx++) {
        for (let dz = -r; dz <= r; dz++) {
          const dist = Math.hypot(dx, dz);
          if (dist > r) continue;
          const lift = Math.max(1, Math.round((1 - dist / r) * 2));
          const wx = x + dx;
          const wz = z + dz;
          if (wx < bounds.xMin || wx > bounds.xMax || wz < bounds.zMin || wz > bounds.zMax) continue;
          for (let yy = 1; yy <= lift; yy++) {
            setVoxel(wx, baseY + yy, wz, yy === lift ? sandLight : sandDark);
          }
        }
      }
    }
  }

  // Destroyed walls at map periphery
  for (let x = bounds.xMin + 20; x <= bounds.xMax - 20; x += 60) {
    for (const z of [bounds.zMin + 12, bounds.zMax - 12]) {
      const h = karkandHash(x, z);
      if (h % 5 !== 0) continue;
      const len = 4 + (h % 6);
      const baseY = heightAt(x, z, bounds);
      for (let dx = 0; dx < len; dx++) {
        const wallH = 2 + (karkandHash(x + dx, z) % 3);
        for (let dy = 1; dy <= wallH; dy++) {
          setVoxel(x + dx, baseY + dy, z, stuccoDark);
        }
      }
    }
  }
  for (let z = bounds.zMin + 20; z <= bounds.zMax - 20; z += 60) {
    for (const x of [bounds.xMin + 12, bounds.xMax - 12]) {
      const h = karkandHash(x, z);
      if (h % 5 !== 0) continue;
      const len = 4 + (h % 6);
      const baseY = heightAt(x, z, bounds);
      for (let dz = 0; dz < len; dz++) {
        const wallH = 2 + (karkandHash(x, z + dz) % 3);
        for (let dy = 1; dy <= wallH; dy++) {
          setVoxel(x, baseY + dy, z + dz, stuccoDark);
        }
      }
    }
  }

  // Palm trees near Gas Station area (south)
  for (let x = -133; x <= 67; x += 50) {
    for (let z = -483; z <= -350; z += 50) {
      const h = karkandHash(x + 7, z - 3);
      if (h % 6 !== 0) continue;
      const baseY = heightAt(x, z, bounds);
      for (let dy = 1; dy <= 3; dy++) {
        setVoxel(x, baseY + dy, z, P.WOOD ?? 13);
      }
    }
  }
}

function generateKarkandRiver(bounds: MapdefBounds, P: Record<string, number>): void {
  console.log('  Generating Karkand river...');
  const sandDark = P.SAND_DARK ?? 8;

  // Channel from (155, 78) to (212, 238), width ~9 voxels
  for (let z = 70; z <= 245; z++) {
    const t = Math.max(0, Math.min(1, (z - 78) / (238 - 78)));
    const riverCx = 155 + t * (212 - 155);
    for (let x = Math.floor(riverCx) - 5; x <= Math.ceil(riverCx) + 5; x++) {
      const dist = Math.abs(x - riverCx);
      if (dist > 5) continue;
      if (x < bounds.xMin || x > bounds.xMax) continue;

      // Ford crossing at z=117-133 (raised to y=0, just barely submerged)
      const isFord = z >= 117 && z <= 133;
      const channelFloor = isFord ? 0 : -1;

      // Carve down to channel floor
      const surfaceY = heightAt(x, z, bounds);
      for (let y = channelFloor; y <= Math.max(surfaceY, 3); y++) {
        setVoxel(x, y, z, 0);
      }

      // Banks: SAND_DARK 3-4 voxels on each side
      if (dist >= 3 && dist <= 5) {
        const bankY = heightAt(x, z, bounds);
        setVoxel(x, bankY, z, sandDark);
        if (bankY > 1) setVoxel(x, bankY - 1, z, sandDark);
      }
    }
  }
}

function generateFactory(bounds: MapdefBounds, P: Record<string, number>): void {
  console.log('  Generating Factory (MEC base)...');
  const concrete = P.CONCRETE ?? 11;
  const metal = P.METAL ?? 20;
  const stucco = P.STUCCO ?? 25;
  const stuccoDark = P.STUCCO_DARK ?? 26;
  const brick = P.BRICK ?? 15;
  // Center: (167, 450), far north, MEC main base
  const baseY = heightAt(167, 450, bounds);

  // Compound pad 54×42
  fillBox(140, baseY, 428, 194, baseY, 470, concrete);
  for (let x = 140; x <= 194; x++) {
    for (let z = 428; z <= 470; z++) {
      for (let y = baseY + 1; y <= baseY + 14; y++) setVoxel(x, y, z, 0);
    }
  }

  // Main factory building 24×18
  makeBuilding({
    x: 145, z: 434, w: 24, d: 18, h: 5, stories: 2,
    material: stuccoDark, roofMaterial: metal,
    hasDoors: true, hasWindows: true,
  }, bounds, P);

  // Vehicle bay 15×18 (open hangar)
  const bayX = 173;
  const bayZ = 434;
  const bayW = 15;
  const bayD = 18;
  // Walls
  for (let y = baseY + 1; y <= baseY + 6; y++) {
    for (let z = bayZ; z < bayZ + bayD; z++) {
      setVoxel(bayX, y, z, stuccoDark);
      setVoxel(bayX + bayW - 1, y, z, stuccoDark);
    }
    for (let x = bayX; x < bayX + bayW; x++) {
      setVoxel(x, y, bayZ + bayD - 1, stuccoDark);
    }
  }
  // Roof
  fillBox(bayX, baseY + 7, bayZ, bayX + bayW - 1, baseY + 7, bayZ + bayD - 1, metal);

  // Watch towers (2 corners)
  for (const [tx, tz] of [[142, 430], [192, 430]] as [number, number][]) {
    for (let y = baseY + 1; y <= baseY + 10; y++) {
      setVoxel(tx, y, tz, brick);
      setVoxel(tx + 1, y, tz, brick);
      setVoxel(tx, y, tz + 1, brick);
      setVoxel(tx + 1, y, tz + 1, brick);
    }
    // Platform at top
    fillBox(tx - 1, baseY + 10, tz - 1, tx + 2, baseY + 10, tz + 2, metal);
    // Railing
    for (let dx = -1; dx <= 2; dx++) {
      setVoxel(tx + dx, baseY + 11, tz - 1, metal);
      setVoxel(tx + dx, baseY + 11, tz + 2, metal);
    }
    for (let dz = -1; dz <= 2; dz++) {
      setVoxel(tx - 1, baseY + 11, tz + dz, metal);
      setVoxel(tx + 2, baseY + 11, tz + dz, metal);
    }
  }

  // Perimeter wall 60×45
  for (let x = 137; x <= 197; x++) {
    for (let y = baseY + 1; y <= baseY + 3; y++) {
      setVoxel(x, y, 425, brick);
      setVoxel(x, y, 470, brick);
    }
  }
  for (let z = 425; z <= 470; z++) {
    for (let y = baseY + 1; y <= baseY + 3; y++) {
      setVoxel(137, y, z, brick);
      setVoxel(197, y, z, brick);
    }
  }
  // Gate opening (south wall, 10-wide)
  for (let y = baseY + 1; y <= baseY + 3; y++) {
    for (let x = 162; x <= 172; x++) {
      setVoxel(x, y, 425, 0);
    }
  }
}

function generateKarkandPerimeter(bounds: MapdefBounds, P: Record<string, number>): void {
  console.log('  Generating Karkand perimeter...');
  const stone = P.STONE ?? 3;
  const stuccoDark = P.STUCCO_DARK ?? 26;

  // Border wall at ±498 (3 voxels thick)
  for (let x = bounds.xMin; x <= bounds.xMax; x++) {
    for (let z = bounds.zMin; z <= bounds.zMax; z++) {
      const edgeDist = Math.min(
        x - bounds.xMin, bounds.xMax - x,
        z - bounds.zMin, bounds.zMax - z,
      );
      if (edgeDist > 2) continue;

      const baseY = heightAt(x, z, bounds);
      const wallTop = Math.min(bounds.yMax, baseY + 8);
      for (let y = baseY + 1; y <= wallTop; y++) {
        setVoxel(x, y, z, stuccoDark);
      }
      if (((x + z) & 1) === 0 && wallTop < bounds.yMax) {
        setVoxel(x, wallTop + 1, z, stone);
      }
    }
  }

  // L-shaped OOB wall: diagonal from (~200, -400) to (~467, 67) — scaled from (60,-120)→(140,20)
  for (let z = -400; z <= 67; z++) {
    const t = (z + 400) / 467;
    const wallX = Math.round(200 + t * 267);
    for (let dx = 0; dx <= 3; dx++) {
      const wx = wallX + dx;
      if (wx > bounds.xMax) continue;
      const baseY = heightAt(wx, z, bounds);
      const wallTop = Math.min(bounds.yMax, baseY + 12);
      for (let y = baseY + 1; y <= wallTop; y++) {
        setVoxel(wx, y, z, stuccoDark);
      }
    }
  }
}

function woodColor(P: Record<string, number>): number {
  return P.WOOD_DARK ?? 14;
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

  const explicitObjects = mapdef.metadata.objects
    ? mapdef.metadata.objects.map((obj) => {
        const surf = surfaceAt(obj.position.x, obj.position.z, bounds);
        return {
          objectId: obj.objectId,
          position: { x: obj.position.x, y: Math.max(obj.position.y, surf + 1), z: obj.position.z },
          rotation: obj.rotation ?? 0,
        };
      })
    : [];

  const generatedObjects = mapdef.name === 'Old Quarter Siege'
    ? buildOldQuarterObjectPlacements(bounds)
    : [];

  const mergedObjects = explicitObjects.concat(generatedObjects);
  if (mergedObjects.length > 0) {
    meta.objects = mergedObjects;
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

  if (mapdef.name === 'Crossroads') {
    generateCrossroadsRoads(mapdef.bounds, P);
    generateCrossroadsCover(mapdef.bounds, P);
  }

  if (mapdef.name === 'Old Quarter Siege') {
    generateOldQuarterRoads(mapdef.bounds, P);
    generateOldQuarterBuildings(mapdef.bounds, P);
    generateOldQuarterCover(mapdef.bounds, P);
    generateOldQuarterLandmarks(mapdef.bounds, P);
    generateOldQuarterVerticality(mapdef.bounds, P);
    generateOldQuarterPerimeter(mapdef.bounds, P);
  }

  if (mapdef.name === 'Strike at Karkand') {
    generateKarkandRoads(mapdef.bounds, P);
    generateKarkandBuildings(mapdef.bounds, P);
    generateKarkandRiver(mapdef.bounds, P);
    generateGasStation(mapdef.bounds, P);
    generateHotel(mapdef.bounds, P);
    generateSquare(mapdef.bounds, P);
    generateSuburb(mapdef.bounds, P);
    generateTrainWreck(mapdef.bounds, P);
    generateGatehouse(mapdef.bounds, P);
    generateCementFactory(mapdef.bounds, P);
    generateWarehouse(mapdef.bounds, P);
    generateFactory(mapdef.bounds, P);
    generateKarkandCover(mapdef.bounds, P);
    generateKarkandOutskirts(mapdef.bounds, P);
    generateKarkandPerimeter(mapdef.bounds, P);
  }

  generateWater(mapdef.bounds, P, mapdef.terrain.waterLevel);

  const terrainMs = performance.now() - startTime;
  console.log(`  Terrain generation: ${(terrainMs / 1000).toFixed(2)}s`);

  // 4. Load registry + place components
  if (mapdef.placements.length > 0) {
    // Try objects registry first (vobj.json format), fall back to components registry
    const objectsRegistryPath = path.join(projectRoot, 'assets', 'objects', 'registry.json');
    const componentsRegistryPath = path.join(projectRoot, 'assets', 'components', 'registry.json');

    let registryMap: Map<string, { filePath: string; isVobj: boolean }>;

    if (fs.existsSync(objectsRegistryPath)) {
      const vobjReg: VobjRegistry = JSON.parse(fs.readFileSync(objectsRegistryPath, 'utf-8'));
      registryMap = new Map(vobjReg.objects.map((o) => [
        o.id,
        { filePath: path.join(projectRoot, 'assets', 'objects', o.path), isVobj: true },
      ]));
      console.log(`  Using objects registry: ${vobjReg.objects.length} entries`);
    } else if (fs.existsSync(componentsRegistryPath)) {
      const compReg: Registry = JSON.parse(fs.readFileSync(componentsRegistryPath, 'utf-8'));
      registryMap = new Map(compReg.components.map((c) => [
        c.id,
        { filePath: path.join(projectRoot, c.componentPath), isVobj: false },
      ]));
      console.log(`  Using components registry: ${compReg.components.length} entries`);
    } else {
      console.error(`Error: no registry found at ${objectsRegistryPath} or ${componentsRegistryPath}`);
      process.exit(1);
    }

    // Cache loaded components
    const componentCache = new Map<string, { component: ComponentFile; remap: Uint8Array }>();

    console.log(`\n  Placing ${mapdef.placements.length} components...`);

    let placedCount = 0;
    let skippedCount = 0;

    for (let i = 0; i < mapdef.placements.length; i++) {
      const placement = mapdef.placements[i];
      const entry = registryMap.get(placement.componentId);
      if (!entry) {
        console.warn(`  Warning: component "${placement.componentId}" not in registry, skipping`);
        skippedCount++;
        continue;
      }

      let cached = componentCache.get(placement.componentId);
      if (!cached) {
        if (!fs.existsSync(entry.filePath)) {
          console.warn(`  Warning: component file not found: ${entry.filePath}, skipping`);
          skippedCount++;
          continue;
        }

        let component: ComponentFile;
        if (entry.filePath.endsWith('.vox')) {
          component = voxFileToComponentFile(entry.filePath, placement.downsample ?? 1);
        } else if (entry.isVobj) {
          const vobj: VobjFile = JSON.parse(fs.readFileSync(entry.filePath, 'utf-8'));
          component = vobjToComponentFile(vobj);
        } else {
          component = JSON.parse(fs.readFileSync(entry.filePath, 'utf-8'));
        }

        const remap = buildRemapTable(component.palette);
        cached = { component, remap };
        componentCache.set(placement.componentId, cached);
      }

      placeComponent(cached.component, placement, cached.remap, mapdef.bounds);
      placedCount++;
    }

    console.log(`  Placed: ${placedCount}, Skipped: ${skippedCount}`);
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
