/**
 * shoreline-gen.ts
 *
 * Procedural generator for the Shoreline MVP map.
 * Outputs:
 *   - assets/maps/shoreline.map         (CLWF binary)
 *   - assets/maps/shoreline.palette.json (256 RGB colors)
 *
 * Usage:
 *   npx tsx tools/shoreline-gen.ts
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CHUNK_SIZE = 16;
const CHUNK_VOXEL_COUNT = CHUNK_SIZE ** 3; // 4096
const MAGIC = 'CLWF';
const VERSION = 1;
const PALETTE_SIZE = 256;
const HEADER_SIZE = 4 + 1 + 4 + 2 + PALETTE_SIZE * 3; // 779
const CHUNK_RECORD_SIZE = 6 + CHUNK_VOXEL_COUNT; // 4102

// Map bounds (world coordinates)
const X_MIN = -130;
const X_MAX = 130;
const Z_MIN = -110;
const Z_MAX = 110;
const Y_MIN = -4;
const Y_MAX = 32;

// ---------------------------------------------------------------------------
// Palette
// ---------------------------------------------------------------------------

interface RGB {
  r: number;
  g: number;
  b: number;
}

const NAMED_COLORS: Record<string, [number, RGB]> = {
  SAND_LIGHT:    [1,  { r: 212, g: 184, b: 150 }],
  SAND_DARK:     [2,  { r: 196, g: 166, b: 122 }],
  GRASS:         [3,  { r: 90,  g: 140, b: 63  }],
  GRASS_DARK:    [4,  { r: 74,  g: 122, b: 51  }],
  DIRT:          [5,  { r: 122, g: 92,  b: 58  }],
  STONE:         [6,  { r: 136, g: 136, b: 136 }],
  STONE_DARK:    [7,  { r: 102, g: 102, b: 102 }],
  CONCRETE:      [8,  { r: 160, g: 160, b: 160 }],
  CONCRETE_DARK: [9,  { r: 128, g: 128, b: 128 }],
  WOOD:          [10, { r: 139, g: 105, b: 20  }],
  WOOD_DARK:     [11, { r: 107, g: 79,  b: 16  }],
  BRICK:         [12, { r: 160, g: 82,  b: 45  }],
  ROOF_TILE:     [13, { r: 139, g: 69,  b: 19  }],
  WATER:         [14, { r: 34,  g: 102, b: 170 }],
  WATER_DEEP:    [15, { r: 26,  g: 76,  b: 128 }],
  ROAD:          [16, { r: 85,  g: 85,  b: 85  }],
  WINDOW:        [17, { r: 135, g: 206, b: 235 }],
  METAL:         [18, { r: 112, g: 128, b: 144 }],
};

// Extract palette index shortcuts
const P = Object.fromEntries(
  Object.entries(NAMED_COLORS).map(([name, [idx]]) => [name, idx])
) as Record<string, number>;

function buildPalette(): RGB[] {
  const palette: RGB[] = new Array(PALETTE_SIZE);
  for (let i = 0; i < PALETTE_SIZE; i++) {
    palette[i] = { r: 0, g: 0, b: 0 };
  }
  for (const [, [idx, color]] of Object.entries(NAMED_COLORS)) {
    palette[idx] = color;
  }
  return palette;
}

// ---------------------------------------------------------------------------
// Chunk map (world coord → voxel value)
// ---------------------------------------------------------------------------

const chunks = new Map<string, Uint8Array>();

function worldToChunk(wx: number, wy: number, wz: number) {
  const cx = Math.floor(wx / CHUNK_SIZE);
  const cy = Math.floor(wy / CHUNK_SIZE);
  const cz = Math.floor(wz / CHUNK_SIZE);
  return {
    key: `${cx},${cy},${cz}`,
    lx: ((wx % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE,
    ly: ((wy % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE,
    lz: ((wz % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE,
  };
}

function localIndex(lx: number, ly: number, lz: number): number {
  return lx + ly * CHUNK_SIZE + lz * CHUNK_SIZE * CHUNK_SIZE;
}

function setVoxel(wx: number, wy: number, wz: number, value: number): void {
  const { key, lx, ly, lz } = worldToChunk(wx, wy, wz);
  let chunk = chunks.get(key);
  if (!chunk) {
    chunk = new Uint8Array(CHUNK_VOXEL_COUNT);
    chunks.set(key, chunk);
  }
  chunk[localIndex(lx, ly, lz)] = value;
}

function getVoxel(wx: number, wy: number, wz: number): number {
  const { key, lx, ly, lz } = worldToChunk(wx, wy, wz);
  const chunk = chunks.get(key);
  if (!chunk) return 0;
  return chunk[localIndex(lx, ly, lz)];
}

/** Fill a box from (x1,y1,z1) to (x2,y2,z2) inclusive */
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

/** Clear a box (set to air) */
function clearBox(
  x1: number, y1: number, z1: number,
  x2: number, y2: number, z2: number
): void {
  fillBox(x1, y1, z1, x2, y2, z2, 0);
}

// ---------------------------------------------------------------------------
// Terrain heightmap
// ---------------------------------------------------------------------------

function heightAt(x: number, z: number): number {
  // Base slope: rises from west (Y=2 at beach edge) to east (Y=8 at hills)
  const normalized = (x - X_MIN) / (X_MAX - X_MIN); // 0..1
  let h = 2 + normalized * 6;

  // Beach depression: X < -50 drops below water level at far west
  if (x < -50) {
    const beachFactor = (-50 - x) / 80; // 0 at x=-50, 1 at x=-130
    h = h * (1 - beachFactor) + (-2) * beachFactor; // lerp toward Y=-2
  }

  // Coastal edges: Z near boundaries drops toward water
  const zEdgeDist = Math.min(Math.abs(z - Z_MIN), Math.abs(z - Z_MAX));
  if (zEdgeDist < 15) {
    const edgeFactor = 1 - zEdgeDist / 15;
    h -= edgeFactor * (h + 2); // pull toward Y=-2
  }

  // Northern hill bump (centered around x=60, z=-70)
  const dxN = (x - 60) / 40;
  const dzN = (z - (-70)) / 35;
  const distN = dxN * dxN + dzN * dzN;
  if (distN < 1) {
    h += (1 - distN) * 6;
  }

  // Southern hill / hilltop fort area (centered around x=58, z=60)
  const dxS = (x - 58) / 35;
  const dzS = (z - 60) / 30;
  const distS = dxS * dxS + dzS * dzS;
  if (distS < 1) {
    h += (1 - distS) * 5;
  }

  // Natural undulation
  h += Math.sin(x / 20) * Math.cos(z / 15) * 1.5;
  h += Math.sin(x / 11 + 0.5) * Math.cos(z / 9 + 0.3) * 0.7;

  return Math.round(h);
}

function materialAt(x: number, z: number, y: number, surfaceY: number): number {
  // Water surface
  if (surfaceY <= 0 && y <= 0) {
    return y === 0 ? P.WATER : P.WATER_DEEP;
  }

  // Beach sand
  if (x < -40 && surfaceY <= 2) {
    return y === surfaceY ? P.SAND_LIGHT : (y === surfaceY - 1 ? P.SAND_DARK : P.DIRT);
  }

  // Surface layer
  if (y === surfaceY) {
    if (surfaceY <= 2) return P.GRASS;
    if (surfaceY <= 5) return (x + z) % 3 === 0 ? P.GRASS_DARK : P.GRASS;
    return (x + z) % 2 === 0 ? P.STONE : P.GRASS_DARK;
  }

  // Sub-surface
  if (y >= surfaceY - 2) return P.DIRT;
  return P.STONE_DARK;
}

// ---------------------------------------------------------------------------
// Terrain generation
// ---------------------------------------------------------------------------

function generateTerrain(): void {
  console.log('  Generating terrain...');
  for (let x = X_MIN; x <= X_MAX; x++) {
    for (let z = Z_MIN; z <= Z_MAX; z++) {
      const surfaceY = heightAt(x, z);
      const minY = Math.max(Y_MIN, -4);
      const maxY = Math.max(surfaceY, 0); // at least fill to water level

      for (let y = minY; y <= maxY; y++) {
        const mat = materialAt(x, z, y, surfaceY);
        setVoxel(x, y, z, mat);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Road generation
// ---------------------------------------------------------------------------

function generateRoads(): void {
  console.log('  Generating roads...');
  // Main east-west road along Z=0, from x=-60 to x=80
  for (let x = -60; x <= 80; x++) {
    for (let zOff = -2; zOff <= 2; zOff++) {
      const z = 0 + zOff;
      const surfaceY = heightAt(x, z);
      setVoxel(x, surfaceY, z, P.ROAD);
      // Flatten road: clear above
      for (let y = surfaceY + 1; y <= surfaceY + 4; y++) {
        setVoxel(x, y, z, 0);
      }
    }
  }

  // North-south road connecting town to hilltop (x=50, z=10 to z=55)
  for (let z = 10; z <= 55; z++) {
    for (let xOff = -1; xOff <= 1; xOff++) {
      const x = 50 + xOff;
      const surfaceY = heightAt(x, z);
      setVoxel(x, surfaceY, z, P.ROAD);
      for (let y = surfaceY + 1; y <= surfaceY + 4; y++) {
        setVoxel(x, y, z, 0);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Structure builders
// ---------------------------------------------------------------------------

interface BuildingSpec {
  x: number;
  z: number;
  w: number; // width (X)
  d: number; // depth (Z)
  h: number; // height (Y)
  stories: number;
  material: number;
  roofMaterial: number;
  hasDoors: boolean;
  hasWindows: boolean;
  hasBalcony?: boolean;
}

function makeBuilding(spec: BuildingSpec): void {
  const baseY = heightAt(spec.x + Math.floor(spec.w / 2), spec.z + Math.floor(spec.d / 2));

  for (let story = 0; story < spec.stories; story++) {
    const floorY = baseY + story * spec.h;

    // Floor
    fillBox(spec.x, floorY, spec.z, spec.x + spec.w - 1, floorY, spec.z + spec.d - 1, spec.material);

    // Walls
    for (let y = floorY + 1; y <= floorY + spec.h - 1; y++) {
      // X walls (north/south faces)
      for (let x = spec.x; x < spec.x + spec.w; x++) {
        setVoxel(x, y, spec.z, spec.material);
        setVoxel(x, y, spec.z + spec.d - 1, spec.material);
      }
      // Z walls (east/west faces)
      for (let z = spec.z; z < spec.z + spec.d; z++) {
        setVoxel(spec.x, y, z, spec.material);
        setVoxel(spec.x + spec.w - 1, y, z, spec.material);
      }
    }

    // Windows (holes in walls at y = floorY+2 and floorY+3)
    if (spec.hasWindows) {
      for (let wy = floorY + 2; wy <= floorY + 3; wy++) {
        // Windows on X walls (every 3 blocks)
        for (let x = spec.x + 2; x < spec.x + spec.w - 1; x += 3) {
          setVoxel(x, wy, spec.z, P.WINDOW);
          setVoxel(x, wy, spec.z + spec.d - 1, P.WINDOW);
        }
        // Windows on Z walls
        for (let z = spec.z + 2; z < spec.z + spec.d - 1; z += 3) {
          setVoxel(spec.x, wy, z, P.WINDOW);
          setVoxel(spec.x + spec.w - 1, wy, z, P.WINDOW);
        }
      }
    }

    // Doors (ground floor only)
    if (spec.hasDoors && story === 0) {
      // Front door (south face, center)
      const doorX = spec.x + Math.floor(spec.w / 2);
      for (let dy = 1; dy <= 2; dy++) {
        setVoxel(doorX, floorY + dy, spec.z, 0);
        setVoxel(doorX + 1, floorY + dy, spec.z, 0);
      }
      // Back door (north face)
      for (let dy = 1; dy <= 2; dy++) {
        setVoxel(doorX, floorY + dy, spec.z + spec.d - 1, 0);
      }
    }
  }

  // Roof
  const roofY = baseY + spec.stories * spec.h;
  fillBox(spec.x - 1, roofY, spec.z - 1, spec.x + spec.w, roofY, spec.z + spec.d, spec.roofMaterial);

  // Balcony on 2nd floor (if enabled and has 2+ stories)
  if (spec.hasBalcony && spec.stories >= 2) {
    const balconyY = baseY + spec.h;
    // Balcony floor extending south
    fillBox(spec.x, balconyY, spec.z - 2, spec.x + spec.w - 1, balconyY, spec.z - 1, P.WOOD);
    // Railing
    for (let x = spec.x; x < spec.x + spec.w; x++) {
      setVoxel(x, balconyY + 1, spec.z - 2, P.WOOD_DARK);
    }
    for (let z = spec.z - 2; z <= spec.z - 1; z++) {
      setVoxel(spec.x, balconyY + 1, z, P.WOOD_DARK);
      setVoxel(spec.x + spec.w - 1, balconyY + 1, z, P.WOOD_DARK);
    }
  }
}

function generateBuildings(): void {
  console.log('  Generating buildings...');

  // --- Harbor buildings (near capture A, x=-48, z=0) ---
  makeBuilding({
    x: -60, z: -16, w: 14, d: 8, h: 6, stories: 1,
    material: P.CONCRETE, roofMaterial: P.METAL,
    hasDoors: true, hasWindows: false,
  });
  makeBuilding({
    x: -46, z: 4, w: 10, d: 8, h: 5, stories: 1,
    material: P.CONCRETE_DARK, roofMaterial: P.METAL,
    hasDoors: true, hasWindows: false,
  });

  // Dock extending toward water
  const dockBaseY = heightAt(-65, 0);
  fillBox(-70, dockBaseY, -2, -62, dockBaseY, 2, P.STONE);
  fillBox(-80, dockBaseY - 1, -1, -70, dockBaseY, 1, P.STONE);

  // --- Town buildings (near capture B, x=6, z=0) ---
  makeBuilding({
    x: -2, z: -20, w: 8, d: 10, h: 4, stories: 3,
    material: P.BRICK, roofMaterial: P.ROOF_TILE,
    hasDoors: true, hasWindows: true,
  });
  makeBuilding({
    x: 10, z: 2, w: 10, d: 8, h: 5, stories: 2,
    material: P.CONCRETE, roofMaterial: P.ROOF_TILE,
    hasDoors: true, hasWindows: true, hasBalcony: true,
  });
  makeBuilding({
    x: -8, z: 12, w: 6, d: 6, h: 4, stories: 1,
    material: P.WOOD, roofMaterial: P.WOOD_DARK,
    hasDoors: true, hasWindows: true,
  });

  // Extra town buildings for density
  makeBuilding({
    x: 22, z: -12, w: 7, d: 7, h: 4, stories: 2,
    material: P.BRICK, roofMaterial: P.ROOF_TILE,
    hasDoors: true, hasWindows: true,
  });
  makeBuilding({
    x: -12, z: -6, w: 8, d: 6, h: 4, stories: 2,
    material: P.CONCRETE_DARK, roofMaterial: P.METAL,
    hasDoors: true, hasWindows: true,
  });
}

// ---------------------------------------------------------------------------
// Hilltop Fort
// ---------------------------------------------------------------------------

function generateFort(): void {
  console.log('  Generating hilltop fort...');
  const fortX = 50;
  const fortZ = 52;
  const fortW = 16;
  const fortD = 16;
  const baseY = heightAt(fortX + 8, fortZ + 8);

  // Flatten the hilltop area
  for (let x = fortX - 2; x <= fortX + fortW + 2; x++) {
    for (let z = fortZ - 2; z <= fortZ + fortD + 2; z++) {
      const surfY = heightAt(x, z);
      // Fill up to baseY if needed
      for (let y = surfY + 1; y <= baseY; y++) {
        setVoxel(x, y, z, P.DIRT);
      }
      setVoxel(x, baseY, z, P.GRASS);
      // Clear above
      for (let y = baseY + 1; y <= baseY + 15; y++) {
        setVoxel(x, y, z, 0);
      }
    }
  }

  // Stone walls (4 high)
  const wallH = 4;
  for (let y = baseY + 1; y <= baseY + wallH; y++) {
    for (let x = fortX; x < fortX + fortW; x++) {
      setVoxel(x, y, fortZ, P.STONE);
      setVoxel(x, y, fortZ + fortD - 1, P.STONE);
    }
    for (let z = fortZ; z < fortZ + fortD; z++) {
      setVoxel(fortX, y, z, P.STONE);
      setVoxel(fortX + fortW - 1, y, z, P.STONE);
    }
  }

  // Battlements (crenellations on top)
  for (let x = fortX; x < fortX + fortW; x += 2) {
    setVoxel(x, baseY + wallH + 1, fortZ, P.STONE);
    setVoxel(x, baseY + wallH + 1, fortZ + fortD - 1, P.STONE);
  }
  for (let z = fortZ; z < fortZ + fortD; z += 2) {
    setVoxel(fortX, baseY + wallH + 1, z, P.STONE);
    setVoxel(fortX + fortW - 1, baseY + wallH + 1, z, P.STONE);
  }

  // Gate openings (south and west walls)
  for (let dy = 1; dy <= 3; dy++) {
    // South gate
    setVoxel(fortX + 7, baseY + dy, fortZ, 0);
    setVoxel(fortX + 8, baseY + dy, fortZ, 0);
    // West gate
    setVoxel(fortX, baseY + dy, fortZ + 7, 0);
    setVoxel(fortX, baseY + dy, fortZ + 8, 0);
  }

  // Watchtower in NE corner
  const towerX = fortX + fortW - 5;
  const towerZ = fortZ + fortD - 5;
  const towerH = 10;
  for (let y = baseY + 1; y <= baseY + towerH; y++) {
    for (let x = towerX; x < towerX + 4; x++) {
      setVoxel(x, y, towerZ, P.STONE_DARK);
      setVoxel(x, y, towerZ + 3, P.STONE_DARK);
    }
    for (let z = towerZ; z < towerZ + 4; z++) {
      setVoxel(towerX, y, z, P.STONE_DARK);
      setVoxel(towerX + 3, y, z, P.STONE_DARK);
    }
  }

  // Tower floor platforms (every 3 levels for climbing)
  for (let level = 3; level <= towerH; level += 3) {
    fillBox(towerX + 1, baseY + level, towerZ + 1, towerX + 2, baseY + level, towerZ + 2, P.WOOD);
    // Opening for climbing (ladder hole)
    setVoxel(towerX + 1, baseY + level, towerZ + 1, 0);
  }

  // Tower top platform
  fillBox(towerX - 1, baseY + towerH + 1, towerZ - 1, towerX + 4, baseY + towerH + 1, towerZ + 4, P.STONE);
}

// ---------------------------------------------------------------------------
// Bridge
// ---------------------------------------------------------------------------

function generateBridge(): void {
  console.log('  Generating bridge...');
  // Bridge connecting from town area (z=25) to hilltop fort area (z=50)
  const bridgeX = 48;
  const bridgeW = 4; // width
  const bridgeY = 10; // deck height
  const zStart = 25;
  const zEnd = 50;

  // Bridge deck
  for (let z = zStart; z <= zEnd; z++) {
    for (let x = bridgeX; x < bridgeX + bridgeW; x++) {
      setVoxel(x, bridgeY, z, P.STONE);
    }
  }

  // Railings
  for (let z = zStart; z <= zEnd; z++) {
    setVoxel(bridgeX, bridgeY + 1, z, P.STONE_DARK);
    setVoxel(bridgeX + bridgeW - 1, bridgeY + 1, z, P.STONE_DARK);
  }

  // Support pillars (every 8 blocks)
  for (let z = zStart; z <= zEnd; z += 8) {
    for (let x = bridgeX; x < bridgeX + bridgeW; x += (bridgeW - 1)) {
      const groundY = heightAt(x, z);
      for (let y = groundY + 1; y < bridgeY; y++) {
        setVoxel(x, y, z, P.STONE_DARK);
      }
    }
  }

  // Arch supports between pillars
  for (let z = zStart + 4; z <= zEnd; z += 8) {
    const archCenterY = bridgeY - 2;
    for (let x = bridgeX; x < bridgeX + bridgeW; x++) {
      setVoxel(x, archCenterY, z, P.STONE_DARK);
      setVoxel(x, archCenterY, z - 1, P.STONE_DARK);
      setVoxel(x, archCenterY, z + 1, P.STONE_DARK);
    }
  }

  // Ramps at bridge ends (stairs connecting to ground)
  // South ramp (from town)
  const groundSouth = heightAt(bridgeX + 2, zStart);
  for (let step = 0; step <= bridgeY - groundSouth; step++) {
    const z = zStart - step;
    const y = bridgeY - step;
    for (let x = bridgeX; x < bridgeX + bridgeW; x++) {
      setVoxel(x, y, z, P.STONE);
    }
    // Clear above ramp
    for (let cy = y + 1; cy <= y + 3; cy++) {
      for (let x = bridgeX; x < bridgeX + bridgeW; x++) {
        setVoxel(x, cy, z, 0);
      }
    }
  }

  // North ramp (to fort)
  const groundNorth = heightAt(bridgeX + 2, zEnd);
  for (let step = 0; step <= bridgeY - groundNorth; step++) {
    const z = zEnd + step;
    const y = bridgeY - step;
    for (let x = bridgeX; x < bridgeX + bridgeW; x++) {
      setVoxel(x, y, z, P.STONE);
    }
    for (let cy = y + 1; cy <= y + 3; cy++) {
      for (let x = bridgeX; x < bridgeX + bridgeW; x++) {
        setVoxel(x, cy, z, 0);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Tunnel
// ---------------------------------------------------------------------------

function generateTunnel(): void {
  console.log('  Generating tunnel...');
  const tunnelW = 4;
  const tunnelH = 3;
  const tunnelY = -2; // floor at Y=-2, ceiling at Y=0
  const zCenter = 0;

  // Main east-west tunnel passage
  const xStart = 35;
  const xEnd = 75;

  for (let x = xStart; x <= xEnd; x++) {
    for (let zOff = 0; zOff < tunnelW; zOff++) {
      const z = zCenter + zOff - Math.floor(tunnelW / 2);
      // Carve out tunnel space
      for (let y = tunnelY; y < tunnelY + tunnelH; y++) {
        setVoxel(x, y, z, 0);
      }
      // Floor
      setVoxel(x, tunnelY - 1, z, P.STONE_DARK);
      // Ceiling
      setVoxel(x, tunnelY + tunnelH, z, P.STONE_DARK);
    }
  }

  // Tunnel walls on sides
  for (let x = xStart; x <= xEnd; x++) {
    for (let y = tunnelY - 1; y <= tunnelY + tunnelH; y++) {
      const zLeft = zCenter - Math.floor(tunnelW / 2) - 1;
      const zRight = zCenter + Math.floor(tunnelW / 2);
      setVoxel(x, y, zLeft, P.STONE_DARK);
      setVoxel(x, y, zRight, P.STONE_DARK);
    }
  }

  // West entrance (near town center) — stairway going down
  const westX = xStart;
  for (let step = 0; step < 4; step++) {
    const x = westX - step - 1;
    const y = tunnelY + step;
    for (let zOff = 0; zOff < tunnelW; zOff++) {
      const z = zCenter + zOff - Math.floor(tunnelW / 2);
      setVoxel(x, y, z, P.STONE);
      // Clear above stairs
      for (let cy = y + 1; cy <= y + 3; cy++) {
        setVoxel(x, cy, z, 0);
      }
    }
  }

  // East entrance (near eastern hills)
  const eastX = xEnd;
  for (let step = 0; step < 4; step++) {
    const x = eastX + step + 1;
    const y = tunnelY + step;
    for (let zOff = 0; zOff < tunnelW; zOff++) {
      const z = zCenter + zOff - Math.floor(tunnelW / 2);
      setVoxel(x, y, z, P.STONE);
      for (let cy = y + 1; cy <= y + 3; cy++) {
        setVoxel(x, cy, z, 0);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Cover elements (sandbags, crates, low walls)
// ---------------------------------------------------------------------------

function generateCover(): void {
  console.log('  Generating cover elements...');

  const sandbagPositions: [number, number, number, number][] = [
    // [x, z, length along X, length along Z]  (2 high walls)
    [-30, -5, 4, 1],   // Near harbor road
    [-30, 5, 4, 1],
    [-15, -3, 1, 3],   // Between harbor and town
    [30, -8, 3, 1],    // East of town
    [30, 8, 3, 1],
    [-70, -10, 3, 1],  // Beach flanks
    [-70, 10, 3, 1],
    [40, 15, 1, 3],    // Near tunnel entrance
    [0, -30, 3, 1],    // North of town
    [0, 30, 3, 1],     // South of town
  ];

  for (const [sx, sz, lenX, lenZ] of sandbagPositions) {
    for (let x = sx; x < sx + lenX; x++) {
      for (let z = sz; z < sz + lenZ; z++) {
        const surfaceY = heightAt(x, z);
        setVoxel(x, surfaceY + 1, z, P.SAND_DARK);
        setVoxel(x, surfaceY + 2, z, P.SAND_DARK);
      }
    }
  }

  // Crate clusters near buildings
  const cratePositions: [number, number][] = [
    [-50, -8], [-50, 8], [-38, 0],   // Harbor
    [5, -8], [5, 18], [20, -5],      // Town
    [55, 48], [60, 55],              // Near fort
  ];

  for (const [cx, cz] of cratePositions) {
    const surfaceY = heightAt(cx, cz);
    // 2x2x2 crate
    fillBox(cx, surfaceY + 1, cz, cx + 1, surfaceY + 2, cz + 1, P.WOOD_DARK);
  }

  // Low stone walls along paths
  const wallSegments: [number, number, number, number, number][] = [
    // [x, z, dx, dz, length]
    [-20, -15, 1, 0, 8],   // North of road, near town
    [-20, 15, 1, 0, 8],    // South of road
    [35, -20, 0, 1, 6],    // East approach
    [35, 20, 0, 1, 6],
  ];

  for (const [wx, wz, dx, dz, len] of wallSegments) {
    for (let i = 0; i < len; i++) {
      const x = wx + dx * i;
      const z = wz + dz * i;
      const surfaceY = heightAt(x, z);
      setVoxel(x, surfaceY + 1, z, P.STONE);
    }
  }
}

// ---------------------------------------------------------------------------
// Water bodies
// ---------------------------------------------------------------------------

function generateWater(): void {
  console.log('  Generating water...');
  // Fill water at Y=0 and below for areas where terrain is below water level
  // Focus on western beach area and coastal edges
  for (let x = X_MIN; x <= X_MAX; x++) {
    for (let z = Z_MIN; z <= Z_MAX; z++) {
      const surfaceY = heightAt(x, z);
      if (surfaceY < 0) {
        // Fill water up to Y=0
        for (let y = surfaceY + 1; y <= 0; y++) {
          if (getVoxel(x, y, z) === 0) {
            setVoxel(x, y, z, y === 0 ? P.WATER : P.WATER_DEEP);
          }
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Binary writer (CLWF format)
// ---------------------------------------------------------------------------

function writeCLWF(palette: RGB[], outputPath: string): void {
  const chunkEntries = Array.from(chunks.entries());

  // Filter out entirely empty chunks
  const nonEmpty = chunkEntries.filter(([, data]) => {
    for (let i = 0; i < data.length; i++) {
      if (data[i] !== 0) return true;
    }
    return false;
  });

  console.log(`  Writing ${nonEmpty.length} non-empty chunks (${chunkEntries.length} total)...`);

  const totalSize = HEADER_SIZE + nonEmpty.length * CHUNK_RECORD_SIZE;
  const buffer = Buffer.alloc(totalSize);
  let offset = 0;

  // Header
  buffer.write(MAGIC, offset, 4, 'ascii');
  offset += 4;
  buffer.writeUInt8(VERSION, offset);
  offset += 1;
  buffer.writeUInt32LE(nonEmpty.length, offset);
  offset += 4;
  buffer.writeUInt16LE(PALETTE_SIZE, offset);
  offset += 2;

  // Palette
  for (let i = 0; i < PALETTE_SIZE; i++) {
    const c = palette[i];
    buffer.writeUInt8(c.r, offset);
    offset += 1;
    buffer.writeUInt8(c.g, offset);
    offset += 1;
    buffer.writeUInt8(c.b, offset);
    offset += 1;
  }

  // Chunks
  for (const [key, data] of nonEmpty) {
    const [cx, cy, cz] = key.split(',').map(Number);
    buffer.writeInt16LE(cx, offset);
    offset += 2;
    buffer.writeInt16LE(cy, offset);
    offset += 2;
    buffer.writeInt16LE(cz, offset);
    offset += 2;

    // Copy voxel data
    for (let i = 0; i < CHUNK_VOXEL_COUNT; i++) {
      buffer.writeUInt8(data[i], offset);
      offset += 1;
    }
  }

  fs.writeFileSync(outputPath, buffer);
  console.log(`  Binary map: ${(totalSize / 1024 / 1024).toFixed(2)} MB`);
}

function writePalette(palette: RGB[], outputPath: string): void {
  fs.writeFileSync(outputPath, JSON.stringify(palette, null, 2));
  console.log(`  Palette: ${outputPath}`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

/** Find the highest solid voxel at (x,z) after generation */
function surfaceAt(x: number, z: number): number {
  for (let y = Y_MAX; y >= Y_MIN; y--) {
    if (getVoxel(x, y, z) > 0) return y;
  }
  return Y_MIN;
}

/** Update meta.json spawn/capture point Y values to match generated terrain */
function updateMeta(metaPath: string): void {
  console.log('  Updating meta.json Y values...');
  const raw = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));

  for (const team of ['alpha', 'bravo'] as const) {
    for (const sp of raw.spawn_points[team]) {
      const surf = surfaceAt(sp.x, sp.z);
      const newY = surf + 1; // spawn 1 above surface
      if (newY !== sp.y) {
        console.log(`    ${team} spawn (${sp.x},${sp.z}): Y ${sp.y} -> ${newY}`);
        sp.y = newY;
      }
    }
  }

  for (const cp of raw.capture_points) {
    const p = cp.position;
    const surf = surfaceAt(p.x, p.z);
    const newY = surf + 1;
    if (newY !== p.y) {
      console.log(`    capture ${cp.id} (${p.x},${p.z}): Y ${p.y} -> ${newY}`);
      p.y = newY;
    }
  }

  for (const obj of raw.objectives ?? []) {
    const p = obj.position;
    const surf = surfaceAt(p.x, p.z);
    const newY = surf + 1;
    if (newY !== p.y) {
      console.log(`    objective ${obj.id} (${p.x},${p.z}): Y ${p.y} -> ${newY}`);
      p.y = newY;
    }
  }

  fs.writeFileSync(metaPath, JSON.stringify(raw, null, 2) + '\n');
  console.log(`  Meta: ${metaPath}`);
}

function main(): void {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const projectRoot = path.resolve(__dirname, '..');
  const outputMap = path.join(projectRoot, 'assets', 'maps', 'shoreline.map');
  const outputPalette = path.join(projectRoot, 'assets', 'maps', 'shoreline.palette.json');
  const metaPath = path.join(projectRoot, 'assets', 'maps', 'shoreline.meta.json');

  console.log('=== Shoreline Map Generator ===\n');
  console.log(`  Map bounds: X[${X_MIN}..${X_MAX}] Z[${Z_MIN}..${Z_MAX}] Y[${Y_MIN}..${Y_MAX}]`);

  const startTime = performance.now();

  // 1. Generate terrain
  generateTerrain();

  // 2. Roads (before buildings, so buildings override road if overlapping)
  generateRoads();

  // 3. Structures
  generateBuildings();
  generateFort();
  generateBridge();
  generateTunnel();

  // 4. Cover elements
  generateCover();

  // 5. Water fill
  generateWater();

  const genMs = performance.now() - startTime;
  console.log(`\n  Generation time: ${(genMs / 1000).toFixed(2)}s`);

  // 6. Write outputs
  console.log('\nWriting files...');
  const palette = buildPalette();
  writeCLWF(palette, outputMap);
  writePalette(palette, outputPalette);
  updateMeta(metaPath);

  const totalMs = performance.now() - startTime;
  console.log(`\n=== Done in ${(totalMs / 1000).toFixed(2)}s ===`);
  console.log(`  ${outputMap}`);
  console.log(`  ${outputPalette}`);
}

main();
