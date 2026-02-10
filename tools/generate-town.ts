/**
 * generate-town.ts
 *
 * Generates a full town map using the urban terrain template and
 * object registry for building/prop placement.
 *
 * Outputs:
 *   <output>.map          — CLWF binary voxel data
 *   <output>.palette.json — 256 RGB colors
 *   <output>.meta.json    — spawn points, capture points, object placements
 *
 * Usage:
 *   npx tsx tools/generate-town.ts [--name "Map Name"] [--size 400] [--seed 42] [--output assets/maps/town]
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { generateTerrain, type TerrainConfig } from './map-templates.js';

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

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface RGB { r: number; g: number; b: number }

interface ObjectRegistryEntry {
  id: string;
  path: string;
  category: string;
}

interface ObjectRegistry {
  version: number;
  objects: ObjectRegistryEntry[];
}

interface VoxelObjectDef {
  name: string;
  version: number;
  category: string;
  sizeX: number;
  sizeY: number;
  sizeZ: number;
  voxelSize: number;
  origin: { x: number; y: number; z: number };
  palette: number[];
  voxels: number[];
}

interface ObjectPlacement {
  objectId: string;
  position: { x: number; y: number; z: number };
  rotation: number;
}

// ---------------------------------------------------------------------------
// Seeded PRNG
// ---------------------------------------------------------------------------

function createRng(seed: number) {
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
  let a = splitmix32(), b = splitmix32(), c = splitmix32(), d = splitmix32();

  function next(): number {
    const result = (Math.imul(((b << 2 | b >>> 30) >>> 0) * 5 >>> 0, 9)) >>> 0;
    const t = (b << 9) >>> 0;
    c = (c ^ a) >>> 0; d = (d ^ b) >>> 0; b = (b ^ c) >>> 0; a = (a ^ d) >>> 0;
    c = (c ^ t) >>> 0; d = ((d << 11 | d >>> 21)) >>> 0;
    return result / 4294967296;
  }

  function nextInt(min: number, max: number): number {
    return min + Math.floor(next() * (max - min + 1));
  }

  function shuffle<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = nextInt(0, i);
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  return { next, nextInt, shuffle };
}

// ---------------------------------------------------------------------------
// Chunk grid
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

// ---------------------------------------------------------------------------
// Terrain palette (indices 1-32, matching map-templates.ts material constants)
// ---------------------------------------------------------------------------

const TERRAIN_PALETTE: RGB[] = new Array(PALETTE_SIZE).fill(null).map(() => ({ r: 0, g: 0, b: 0 }));
const TERRAIN_PALETTE_MAX = 32;
let nextFreeIndex = TERRAIN_PALETTE_MAX + 1; // Object colors start at index 33

function setupPalette(): void {
  const colors: [number, number, number, number][] = [
    [1,  80, 140, 50],   // GRASS
    [2,  120, 90, 60],   // DIRT
    [3,  130, 130, 135],  // STONE
    [4,  60, 60, 65],    // (unused)
    [5,  200, 200, 210],  // (unused)
    [6,  40, 80, 140],   // WATER
    [7,  210, 190, 150],  // SAND_LIGHT
    [8,  180, 160, 120],  // SAND_DARK
    [9,  55, 110, 40],   // GRASS_DARK
    [10, 100, 100, 105],  // STONE_DARK
    [11, 160, 160, 165],  // CONCRETE
    [12, 120, 120, 125],  // CONCRETE_DARK
    [13, 150, 110, 65],   // WOOD
    [14, 100, 70, 40],    // WOOD_DARK
    [15, 160, 80, 70],    // BRICK
    [16, 140, 70, 50],    // ROOF_TILE
    [17, 25, 50, 100],    // WATER_DEEP
    [18, 60, 60, 65],     // ROAD
    [19, 140, 180, 210],  // WINDOW
    [20, 80, 80, 85],     // METAL
  ];
  for (const [idx, r, g, b] of colors) {
    TERRAIN_PALETTE[idx] = { r, g, b };
  }
}

// ---------------------------------------------------------------------------
// Palette remapping — merge object colors into unified palette
// ---------------------------------------------------------------------------

function colorDistance(a: RGB, b: RGB): number {
  const dr = a.r - b.r, dg = a.g - b.g, db = a.b - b.b;
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

function findOrAllocateColor(r: number, g: number, b: number): number {
  const color: RGB = { r, g, b };
  // Search existing palette for close match
  for (let i = 1; i < nextFreeIndex; i++) {
    if (colorDistance(TERRAIN_PALETTE[i], color) <= 8) return i;
  }
  // Allocate new index
  if (nextFreeIndex < PALETTE_SIZE) {
    const idx = nextFreeIndex++;
    TERRAIN_PALETTE[idx] = color;
    return idx;
  }
  // Overflow: find nearest existing
  let bestIdx = 1, bestDist = Infinity;
  for (let i = 1; i < PALETTE_SIZE; i++) {
    const d = colorDistance(TERRAIN_PALETTE[i], color);
    if (d < bestDist) { bestDist = d; bestIdx = i; }
  }
  return bestIdx;
}

/** Build a remap table: object palette index → unified palette index */
function buildRemapTable(def: VoxelObjectDef): Uint8Array {
  const remap = new Uint8Array(256);
  remap[0] = 0; // air stays air
  for (let i = 1; i < def.palette.length && i < 256; i++) {
    const hex = def.palette[i];
    if (hex === 0) { remap[i] = 0; continue; }
    const r = (hex >> 16) & 0xFF;
    const g = (hex >> 8) & 0xFF;
    const b = hex & 0xFF;
    remap[i] = findOrAllocateColor(r, g, b);
  }
  return remap;
}

// ---------------------------------------------------------------------------
// Object baking — stamp objects into terrain chunks with real colors
// ---------------------------------------------------------------------------

function bakeObjectIntoChunks(
  def: VoxelObjectDef,
  placement: ObjectPlacement,
  remap: Uint8Array,
): number {
  const { sizeX, sizeY, sizeZ, voxelSize, origin } = def;
  const rot = ((placement.rotation % 360) + 360) % 360;
  let stamped = 0;

  for (let lz = 0; lz < sizeZ; lz++) {
    for (let ly = 0; ly < sizeY; ly++) {
      for (let lx = 0; lx < sizeX; lx++) {
        const idx = lx + ly * sizeX + lz * sizeX * sizeY;
        const colorIdx = def.voxels[idx];
        if (colorIdx === 0) continue;

        const remapped = remap[colorIdx];
        if (remapped === 0) continue;

        // Offset from origin in world units
        let dx = (lx - origin.x) * voxelSize;
        const dy = (ly - origin.y) * voxelSize;
        let dz = (lz - origin.z) * voxelSize;

        // Apply Y-axis rotation
        if (rot === 90) { [dx, dz] = [-dz, dx]; }
        else if (rot === 180) { dx = -dx; dz = -dz; }
        else if (rot === 270) { [dx, dz] = [dz, -dx]; }

        // World coordinates (round to nearest terrain voxel)
        const wx = Math.round(placement.position.x + dx);
        const wy = Math.round(placement.position.y + dy);
        const wz = Math.round(placement.position.z + dz);

        setVoxel(wx, wy, wz, remapped);
        stamped++;
      }
    }
  }
  return stamped;
}

function bakeAllObjects(
  placements: ObjectPlacement[],
  defs: Map<string, VoxelObjectDef>,
): number {
  const remapCache = new Map<string, Uint8Array>();
  let totalStamped = 0;

  for (const placement of placements) {
    const def = defs.get(placement.objectId);
    if (!def) continue;

    let remap = remapCache.get(placement.objectId);
    if (!remap) {
      remap = buildRemapTable(def);
      remapCache.set(placement.objectId, remap);
    }

    // Carve terrain in object footprint first
    const fp = getFootprint(def, placement.rotation);
    const halfW = fp.width / 2, halfD = fp.depth / 2;
    const objHeight = def.sizeY * def.voxelSize;
    for (let x = Math.floor(placement.position.x - halfW); x <= Math.ceil(placement.position.x + halfW); x++) {
      for (let z = Math.floor(placement.position.z - halfD); z <= Math.ceil(placement.position.z + halfD); z++) {
        for (let y = placement.position.y; y < placement.position.y + objHeight; y++) {
          const current = getVoxel(x, y, z);
          if (current > 0 && current <= TERRAIN_PALETTE_MAX) {
            setVoxel(x, y, z, 0); // Carve terrain
          }
        }
      }
    }

    totalStamped += bakeObjectIntoChunks(def, placement, remap);
  }

  return totalStamped;
}

// ---------------------------------------------------------------------------
// Object loading
// ---------------------------------------------------------------------------

function loadRegistry(projectRoot: string): { registry: ObjectRegistry; defs: Map<string, VoxelObjectDef> } {
  const regPath = path.join(projectRoot, 'assets', 'objects', 'registry.json');
  const registry: ObjectRegistry = JSON.parse(fs.readFileSync(regPath, 'utf-8'));
  const defs = new Map<string, VoxelObjectDef>();

  for (const entry of registry.objects) {
    const defPath = path.join(projectRoot, 'assets', 'objects', entry.path);
    if (fs.existsSync(defPath)) {
      const def: VoxelObjectDef = JSON.parse(fs.readFileSync(defPath, 'utf-8'));
      defs.set(entry.id, def);
    }
  }

  return { registry, defs };
}

/** Get the world-space footprint of an object in terrain voxel units */
function getFootprint(def: VoxelObjectDef, rotation: number): { width: number; depth: number } {
  const w = def.sizeX * def.voxelSize;
  const d = def.sizeZ * def.voxelSize;
  if (rotation === 90 || rotation === 270) return { width: d, depth: w };
  return { width: w, depth: d };
}

// ---------------------------------------------------------------------------
// Object placement logic
// ---------------------------------------------------------------------------

interface PlacedBox {
  x: number; z: number; w: number; d: number;
}

function boxesOverlap(a: PlacedBox, b: PlacedBox, padding: number): boolean {
  return !(
    a.x + a.w + padding <= b.x ||
    b.x + b.w + padding <= a.x ||
    a.z + a.d + padding <= b.z ||
    b.z + b.d + padding <= a.z
  );
}

function generatePlacements(
  buildingZones: { x: number; z: number; width: number; depth: number }[],
  roads: { x: number; z: number; direction: 'x' | 'z' }[],
  defs: Map<string, VoxelObjectDef>,
  getHeight: (x: number, z: number) => number,
  bounds: { xMin: number; xMax: number; zMin: number; zMax: number },
  rng: ReturnType<typeof createRng>,
): ObjectPlacement[] {
  const placements: ObjectPlacement[] = [];
  const placedBoxes: PlacedBox[] = [];

  // -----------------------------------------------------------------------
  // Object categories
  // -----------------------------------------------------------------------

  // Buildings - residential
  const residentialBuildings = [
    'craftsman_home', 'spanish_villa', 'suburban_house', 'compact_home',
    'colonial_house', 'townhouse', 'ranch_house', 'modern_house',
  ];

  // Buildings - commercial
  const commercialBuildings = [
    'corner_store', 'small_shop', 'market',
    'pharmacy', 'bookstore', 'hardware_store', 'bakery', 'laundromat',
    'deli', 'florist', 'pet_store', 'electronics', 'barber',
    'candy_shop', 'thrift_store', 'diner', 'pizza_place',
  ];

  // Buildings - multi-story (for larger zones)
  const multiStoryBuildings = [
    'apartment_block_1', 'apartment_block_2', 'apartment_block_3',
    'office_building_1', 'office_building_2', 'office_building_3',
  ];

  // Military/tactical buildings
  const militaryBuildings = ['bunker', 'watchtower', 'small_house', 'two_story'];

  // Street furniture (placed along roads every ~10-15 blocks)
  const streetFurniture = [
    'street_light_1', 'street_light_2', 'street_light_3',
    'traffic_light_1', 'traffic_light_2',
    'fire_hydrant',
    'mailbox_1', 'mailbox_2',
    'newsbox_1', 'newsbox_2', 'newsbox_3',
    'traffic_cone',
    'street_sign_1', 'street_sign_2', 'street_sign_3', 'street_sign_4',
  ];

  // Decorative props (placed in open areas, parks, near buildings)
  const decorativeProps = [
    'planter_1', 'planter_2',
    'fountain', 'statue_1', 'statue_2',
    'park_bench', 'park_bench_2', 'park_bench_3',
    'trash_can', 'dumpster_1', 'dumpster_2',
    'column_1', 'column_2',
    'porta_potty',
    'barrel', 'crate_small', 'sandbag_cover',
  ];

  // Urban clutter (scattered in alleys, behind buildings)
  const urbanClutter = [
    'rubbish_pile_1', 'rubbish_pile_2',
    'shipping_container_1', 'shipping_container_2',
    'barrel', 'crate_small',
  ];

  // Vehicles (parked along roads)
  const vehicles = [
    'sedan_1', 'sedan_2', 'sedan_3', 'sedan_4', 'sedan_5',
    'taxi', 'city_bus', 'police_car',
    'suv_1', 'suv_2', 'delivery_truck', 'truck',
  ];

  // Trees
  const trees = ['small_tree', 'medium_tree', 'pine_tree', 'palm_tree'];

  // -----------------------------------------------------------------------
  // Filter to only objects we actually have definitions for
  // -----------------------------------------------------------------------

  const availableResidential = residentialBuildings.filter(id => defs.has(id));
  const availableCommercial = commercialBuildings.filter(id => defs.has(id));
  const availableMultiStory = multiStoryBuildings.filter(id => defs.has(id));
  const availableMilitary = militaryBuildings.filter(id => defs.has(id));
  const availableStreetFurniture = streetFurniture.filter(id => defs.has(id));
  const availableDecorativeProps = decorativeProps.filter(id => defs.has(id));
  const availableUrbanClutter = urbanClutter.filter(id => defs.has(id));
  const availableVehicles = vehicles.filter(id => defs.has(id));
  const availableTrees = trees.filter(id => defs.has(id));

  const totalBuildings = availableResidential.length + availableCommercial.length
    + availableMultiStory.length + availableMilitary.length;
  const totalProps = availableStreetFurniture.length + availableDecorativeProps.length
    + availableUrbanClutter.length + availableVehicles.length;

  console.log(`  Available: ${totalBuildings} buildings (${availableResidential.length} res, ${availableCommercial.length} com, ${availableMultiStory.length} multi, ${availableMilitary.length} mil)`);
  console.log(`  Available: ${totalProps} props, ${availableVehicles.length} vehicles, ${availableTrees.length} trees`);

  // -----------------------------------------------------------------------
  // Helper: determine if a zone is "near" a road
  // -----------------------------------------------------------------------

  function isZoneNearRoad(zone: { x: number; z: number; width: number; depth: number }): boolean {
    const zoneCenterX = zone.x + zone.width / 2;
    const zoneCenterZ = zone.z + zone.depth / 2;
    for (const road of roads) {
      if (road.direction === 'x') {
        // Road runs along X; check Z proximity
        if (Math.abs(zoneCenterZ - road.z) < 20) return true;
      } else {
        // Road runs along Z; check X proximity
        if (Math.abs(zoneCenterX - road.x) < 20) return true;
      }
    }
    return false;
  }

  // -----------------------------------------------------------------------
  // Helper: try to place a building from a candidate list in a zone
  // -----------------------------------------------------------------------

  function tryPlaceBuilding(
    zone: { x: number; z: number; width: number; depth: number },
    candidateIds: string[],
    margin: number,
  ): boolean {
    const shuffled = rng.shuffle([...candidateIds]);
    for (const id of shuffled) {
      const def = defs.get(id)!;
      const rotation = [0, 90, 180, 270][rng.nextInt(0, 3)];
      const fp = getFootprint(def, rotation);

      if (fp.width > zone.width + margin || fp.depth > zone.depth + margin) continue;

      const wx = zone.x + Math.floor((zone.width - fp.width) / 2);
      const wz = zone.z + Math.floor((zone.depth - fp.depth) / 2);

      const box: PlacedBox = { x: wx, z: wz, w: fp.width, d: fp.depth };
      if (placedBoxes.some(b => boxesOverlap(box, b, 2))) continue;

      const wy = getHeight(
        Math.round(wx + fp.width / 2),
        Math.round(wz + fp.depth / 2),
      ) + 1;

      placements.push({ objectId: id, position: { x: wx, y: wy, z: wz }, rotation });
      placedBoxes.push(box);
      return true;
    }
    return false;
  }

  // -----------------------------------------------------------------------
  // 1. Place buildings in zones
  // -----------------------------------------------------------------------

  const shuffledZones = rng.shuffle([...buildingZones]);
  let buildingCount = 0;
  const usedZones: Set<number> = new Set(); // track which zones got a building

  for (let zi = 0; zi < shuffledZones.length; zi++) {
    const zone = shuffledZones[zi];
    let placed = false;

    // Large zones: try multi-story first
    if (zone.width >= 20 && zone.depth >= 20 && availableMultiStory.length > 0) {
      placed = tryPlaceBuilding(zone, availableMultiStory, 4);
    }

    // Near-road zones: prefer commercial buildings
    if (!placed && isZoneNearRoad(zone) && availableCommercial.length > 0) {
      placed = tryPlaceBuilding(zone, availableCommercial, 4);
    }

    // Away from roads: prefer residential
    if (!placed && availableResidential.length > 0) {
      placed = tryPlaceBuilding(zone, availableResidential, 4);
    }

    // Still nothing? Try commercial as fallback for any zone
    if (!placed && availableCommercial.length > 0) {
      placed = tryPlaceBuilding(zone, availableCommercial, 4);
    }

    // Last resort: military/small buildings
    if (!placed && availableMilitary.length > 0) {
      placed = tryPlaceBuilding(zone, availableMilitary, 2);
    }

    if (placed) {
      usedZones.add(zi);
      buildingCount++;
    }
  }

  console.log(`  Placed ${buildingCount} buildings in ${shuffledZones.length} zones`);

  // -----------------------------------------------------------------------
  // 2. Decorative props near buildings (50% chance, 1-2 props per building)
  // -----------------------------------------------------------------------

  let decorPropCount = 0;
  if (availableDecorativeProps.length > 0) {
    // Iterate over placements that are buildings (placed so far are all buildings)
    const buildingPlacements = placements.slice(); // snapshot current list
    for (const bp of buildingPlacements) {
      if (rng.next() > 0.5) continue; // 50% chance

      const bDef = defs.get(bp.objectId);
      if (!bDef) continue;
      const bFp = getFootprint(bDef, bp.rotation);

      const numProps = rng.nextInt(1, 2);
      for (let p = 0; p < numProps; p++) {
        const propId = availableDecorativeProps[rng.nextInt(0, availableDecorativeProps.length - 1)];
        const propDef = defs.get(propId)!;
        const propFp = getFootprint(propDef, 0);

        // Place within 3-5 voxels of building footprint
        const offsetDist = rng.nextInt(3, 5);
        const side = rng.nextInt(0, 3); // 0=+x, 1=-x, 2=+z, 3=-z
        let px: number, pz: number;
        if (side === 0) {
          px = Math.round(bp.position.x + bFp.width / 2 + offsetDist);
          pz = Math.round(bp.position.z + rng.nextInt(0, Math.max(0, Math.floor(bFp.depth) - 1)));
        } else if (side === 1) {
          px = Math.round(bp.position.x - bFp.width / 2 - offsetDist);
          pz = Math.round(bp.position.z + rng.nextInt(0, Math.max(0, Math.floor(bFp.depth) - 1)));
        } else if (side === 2) {
          px = Math.round(bp.position.x + rng.nextInt(0, Math.max(0, Math.floor(bFp.width) - 1)));
          pz = Math.round(bp.position.z + bFp.depth / 2 + offsetDist);
        } else {
          px = Math.round(bp.position.x + rng.nextInt(0, Math.max(0, Math.floor(bFp.width) - 1)));
          pz = Math.round(bp.position.z - bFp.depth / 2 - offsetDist);
        }

        if (px < bounds.xMin + 5 || px > bounds.xMax - 5) continue;
        if (pz < bounds.zMin + 5 || pz > bounds.zMax - 5) continue;

        const box: PlacedBox = { x: px, z: pz, w: propFp.width, d: propFp.depth };
        if (placedBoxes.some(b => boxesOverlap(box, b, 1))) continue;

        const wy = getHeight(px, pz) + 1;
        const rotation = [0, 90, 180, 270][rng.nextInt(0, 3)];
        placements.push({ objectId: propId, position: { x: px, y: wy, z: pz }, rotation });
        placedBoxes.push(box);
        decorPropCount++;
      }
    }
  }
  console.log(`  Placed ${decorPropCount} decorative props near buildings`);

  // -----------------------------------------------------------------------
  // 3. Street furniture along roads
  // -----------------------------------------------------------------------

  let furnitureCount = 0;
  if (availableStreetFurniture.length > 0) {
    // Separate street lights from smaller items
    const streetLights = availableStreetFurniture.filter(id =>
      id.startsWith('street_light') || id.startsWith('traffic_light'));
    const smallFurniture = availableStreetFurniture.filter(id =>
      !id.startsWith('street_light') && !id.startsWith('traffic_light'));

    for (const road of roads) {
      // Walk along the road placing furniture
      const startPos = road.direction === 'x' ? bounds.xMin + 10 : bounds.zMin + 10;
      const endPos = road.direction === 'x' ? bounds.xMax - 10 : bounds.zMax - 10;

      let distSinceLight = 0;
      let distSinceSmall = 0;

      for (let pos = startPos; pos < endPos; pos += 1) {
        distSinceLight++;
        distSinceSmall++;

        // Street lights every ~20 voxels on both sides
        if (distSinceLight >= 20 && streetLights.length > 0) {
          distSinceLight = 0;
          for (const sideOffset of [-4, 4]) {
            const lightId = streetLights[rng.nextInt(0, streetLights.length - 1)];
            const lightDef = defs.get(lightId)!;
            const lightFp = getFootprint(lightDef, 0);

            let px: number, pz: number;
            if (road.direction === 'x') {
              px = pos;
              pz = road.z + sideOffset;
            } else {
              px = road.x + sideOffset;
              pz = pos;
            }

            if (px < bounds.xMin + 5 || px > bounds.xMax - 5) continue;
            if (pz < bounds.zMin + 5 || pz > bounds.zMax - 5) continue;

            const box: PlacedBox = { x: px, z: pz, w: lightFp.width, d: lightFp.depth };
            if (placedBoxes.some(b => boxesOverlap(box, b, 1))) continue;

            const wy = getHeight(px, pz) + 1;
            placements.push({ objectId: lightId, position: { x: px, y: wy, z: pz }, rotation: 0 });
            placedBoxes.push(box);
            furnitureCount++;
          }
        }

        // Smaller items every 8-12 voxels (alternate spacing)
        const smallInterval = rng.nextInt(8, 12);
        if (distSinceSmall >= smallInterval && smallFurniture.length > 0) {
          distSinceSmall = 0;
          // Pick a random side
          const sideOffset = rng.next() > 0.5 ? 3 : -3;
          const itemId = smallFurniture[rng.nextInt(0, smallFurniture.length - 1)];
          const itemDef = defs.get(itemId)!;
          const itemFp = getFootprint(itemDef, 0);

          let px: number, pz: number;
          if (road.direction === 'x') {
            px = pos;
            pz = road.z + sideOffset;
          } else {
            px = road.x + sideOffset;
            pz = pos;
          }

          if (px < bounds.xMin + 5 || px > bounds.xMax - 5) continue;
          if (pz < bounds.zMin + 5 || pz > bounds.zMax - 5) continue;

          const box: PlacedBox = { x: px, z: pz, w: itemFp.width, d: itemFp.depth };
          if (placedBoxes.some(b => boxesOverlap(box, b, 1))) continue;

          const wy = getHeight(px, pz) + 1;
          const rotation = [0, 90, 180, 270][rng.nextInt(0, 3)];
          placements.push({ objectId: itemId, position: { x: px, y: wy, z: pz }, rotation });
          placedBoxes.push(box);
          furnitureCount++;
        }
      }
    }
  }
  console.log(`  Placed ${furnitureCount} street furniture items`);

  // -----------------------------------------------------------------------
  // 4. Vehicle placement along roads
  // -----------------------------------------------------------------------

  let vehicleCount = 0;
  if (availableVehicles.length > 0) {
    for (const road of roads) {
      const startPos = road.direction === 'x' ? bounds.xMin + 15 : bounds.zMin + 15;
      const endPos = road.direction === 'x' ? bounds.xMax - 15 : bounds.zMax - 15;

      for (let pos = startPos; pos < endPos; pos += rng.nextInt(10, 20)) {
        if (rng.next() > 0.3) continue; // ~30% chance per segment

        const vehicleId = availableVehicles[rng.nextInt(0, availableVehicles.length - 1)];
        const vehicleDef = defs.get(vehicleId)!;
        // Rotation: parallel to road direction
        const rotation = road.direction === 'x'
          ? (rng.next() > 0.5 ? 0 : 180)
          : (rng.next() > 0.5 ? 90 : 270);
        const vehicleFp = getFootprint(vehicleDef, rotation);

        // Offset ±6 from road center (parked on the side)
        const sideOffset = rng.next() > 0.5 ? 6 : -6;

        let px: number, pz: number;
        if (road.direction === 'x') {
          px = pos;
          pz = road.z + sideOffset;
        } else {
          px = road.x + sideOffset;
          pz = pos;
        }

        if (px < bounds.xMin + 5 || px > bounds.xMax - 5) continue;
        if (pz < bounds.zMin + 5 || pz > bounds.zMax - 5) continue;

        const box: PlacedBox = { x: px, z: pz, w: vehicleFp.width, d: vehicleFp.depth };
        if (placedBoxes.some(b => boxesOverlap(box, b, 1))) continue;

        const wy = getHeight(px, pz) + 1;
        placements.push({ objectId: vehicleId, position: { x: px, y: wy, z: pz }, rotation });
        placedBoxes.push(box);
        vehicleCount++;
      }
    }
  }
  console.log(`  Placed ${vehicleCount} vehicles along roads`);

  // -----------------------------------------------------------------------
  // 5. Urban clutter in empty building zones
  // -----------------------------------------------------------------------

  let clutterCount = 0;
  if (availableUrbanClutter.length > 0) {
    for (let zi = 0; zi < shuffledZones.length; zi++) {
      if (usedZones.has(zi)) continue; // skip zones that got a building

      const zone = shuffledZones[zi];
      // Place cluster of 2-4 items in the empty zone
      const clusterSize = rng.nextInt(2, 4);
      for (let c = 0; c < clusterSize; c++) {
        const itemId = availableUrbanClutter[rng.nextInt(0, availableUrbanClutter.length - 1)];
        const itemDef = defs.get(itemId)!;
        const rotation = [0, 90, 180, 270][rng.nextInt(0, 3)];
        const itemFp = getFootprint(itemDef, rotation);

        // Random position within the zone
        const px = zone.x + rng.nextInt(1, Math.max(1, zone.width - Math.ceil(itemFp.width) - 1));
        const pz = zone.z + rng.nextInt(1, Math.max(1, zone.depth - Math.ceil(itemFp.depth) - 1));

        if (px < bounds.xMin + 3 || px > bounds.xMax - 3) continue;
        if (pz < bounds.zMin + 3 || pz > bounds.zMax - 3) continue;

        const box: PlacedBox = { x: px, z: pz, w: itemFp.width, d: itemFp.depth };
        if (placedBoxes.some(b => boxesOverlap(box, b, 1))) continue;

        const wy = getHeight(px, pz) + 1;
        placements.push({ objectId: itemId, position: { x: px, y: wy, z: pz }, rotation });
        placedBoxes.push(box);
        clutterCount++;
      }
    }
  }
  console.log(`  Placed ${clutterCount} urban clutter items in empty zones`);

  // -----------------------------------------------------------------------
  // 6. Scatter trees in grass areas (away from roads and buildings)
  // -----------------------------------------------------------------------

  let treeCount = 0;
  const mapArea = (bounds.xMax - bounds.xMin) * (bounds.zMax - bounds.zMin);
  const treeAttempts = Math.round(mapArea / 120);
  for (let i = 0; i < treeAttempts && availableTrees.length > 0; i++) {
    const tx = rng.nextInt(bounds.xMin + 10, bounds.xMax - 10);
    const tz = rng.nextInt(bounds.zMin + 10, bounds.zMax - 10);

    const treeId = availableTrees[rng.nextInt(0, availableTrees.length - 1)];
    const def = defs.get(treeId)!;
    const fp = getFootprint(def, 0);
    const box: PlacedBox = { x: tx, z: tz, w: fp.width + 2, d: fp.depth + 2 };

    if (placedBoxes.some(b => boxesOverlap(box, b, 2))) continue;

    const wy = getHeight(tx, tz) + 1;
    placements.push({ objectId: treeId, position: { x: tx, y: wy, z: tz }, rotation: 0 });
    placedBoxes.push(box);
    treeCount++;
  }
  console.log(`  Placed ${treeCount} trees`);

  return placements;
}

// ---------------------------------------------------------------------------
// Spawn + capture point generation
// ---------------------------------------------------------------------------

function generateSpawns(
  bounds: { xMin: number; xMax: number; zMin: number; zMax: number },
  getHeight: (x: number, z: number) => number,
) {
  const midZ = Math.round((bounds.zMin + bounds.zMax) / 2);
  const alphaX = bounds.xMin + 20;
  const bravoX = bounds.xMax - 20;

  // Multiple spawn points per team (4 each, spread along Z)
  const spread = Math.round((bounds.zMax - bounds.zMin) * 0.3);
  const alphaSpawns = [];
  const bravoSpawns = [];
  for (let i = -1; i <= 2; i++) {
    const z = midZ + i * Math.round(spread / 3);
    alphaSpawns.push({ x: alphaX, y: getHeight(alphaX, z) + 2, z });
    bravoSpawns.push({ x: bravoX, y: getHeight(bravoX, z) + 2, z });
  }

  return { alpha: alphaSpawns, bravo: bravoSpawns };
}

function generateCapturePoints(
  bounds: { xMin: number; xMax: number; zMin: number; zMax: number },
  getHeight: (x: number, z: number) => number,
) {
  const midX = Math.round((bounds.xMin + bounds.xMax) / 2);
  const midZ = Math.round((bounds.zMin + bounds.zMax) / 2);
  const spanX = Math.round((bounds.xMax - bounds.xMin) * 0.6);

  const points = [
    { id: 'A', x: midX - Math.round(spanX * 0.4), z: midZ - 20 },
    { id: 'B', x: midX - Math.round(spanX * 0.2), z: midZ + 15 },
    { id: 'C', x: midX, z: midZ },
    { id: 'D', x: midX + Math.round(spanX * 0.2), z: midZ - 15 },
    { id: 'E', x: midX + Math.round(spanX * 0.4), z: midZ + 20 },
  ];

  return points.map(p => ({
    id: p.id,
    position: { x: p.x, y: getHeight(p.x, p.z) + 1, z: p.z },
    initialOwner: 0,
  }));
}

// ---------------------------------------------------------------------------
// Binary writer
// ---------------------------------------------------------------------------

function writeCLWF(outputPath: string, palette: RGB[]): void {
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
    const c = palette[i];
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
// Main
// ---------------------------------------------------------------------------

function main(): void {
  const args = process.argv.slice(2);

  // Parse args
  const nameIdx = args.indexOf('--name');
  const sizeIdx = args.indexOf('--size');
  const seedIdx = args.indexOf('--seed');
  const outputIdx = args.indexOf('--output');

  const mapName = nameIdx !== -1 ? args[nameIdx + 1] : 'Milltown';
  const mapSize = sizeIdx !== -1 ? parseInt(args[sizeIdx + 1]) : 400;
  const seed = seedIdx !== -1 ? parseInt(args[seedIdx + 1]) : 42;
  const outputPrefix = outputIdx !== -1 ? args[outputIdx + 1] : 'assets/maps/town';

  const half = Math.floor(mapSize / 2);
  const bounds = {
    xMin: -half, xMax: half,
    yMin: -4, yMax: 40,
    zMin: -half, zMax: half,
  };

  const projectRoot = path.resolve(__dirname, '..');
  const resolvedOutput = path.resolve(outputPrefix);
  const outputDir = path.dirname(resolvedOutput);
  const basename = path.basename(resolvedOutput);

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  console.log('=== Clawfield Town Generator ===\n');
  console.log(`  Name:   ${mapName}`);
  console.log(`  Size:   ${mapSize}x${mapSize} (${bounds.xMin} to ${bounds.xMax})`);
  console.log(`  Seed:   ${seed}`);
  console.log(`  Output: ${resolvedOutput}`);

  const rng = createRng(seed + 999);

  // 1. Setup palette
  setupPalette();

  // 2. Generate urban terrain
  console.log('\n--- Terrain ---');
  const startTime = performance.now();

  const terrainConfig: TerrainConfig = {
    template: 'urban',
    bounds,
    seed,
    waterLevel: -10, // no water for town map
    roadDensity: 0.6,
    buildingDensity: 0.7,
  };

  const terrainResult = generateTerrain(terrainConfig, setVoxel);
  const terrainMs = performance.now() - startTime;
  console.log(`  Terrain: ${(terrainMs / 1000).toFixed(2)}s, ${terrainResult.roads.length} roads, ${terrainResult.buildingZones.length} building zones`);

  // 3. Load object registry
  console.log('\n--- Objects ---');
  const { registry, defs } = loadRegistry(projectRoot);
  console.log(`  Registry: ${registry.objects.length} entries, ${defs.size} loaded`);

  // 4. Generate object placements
  const objectPlacements = generatePlacements(
    terrainResult.buildingZones,
    terrainResult.roads,
    defs,
    terrainResult.getHeight,
    bounds,
    rng,
  );
  console.log(`  Total placements: ${objectPlacements.length}`);

  // 4b. Bake objects into terrain with real palette colors
  console.log('\n--- Baking Objects ---');
  const bakeStart = performance.now();
  const bakedVoxels = bakeAllObjects(objectPlacements, defs);
  const bakeMs = performance.now() - bakeStart;
  console.log(`  Baked ${bakedVoxels.toLocaleString()} voxels from ${objectPlacements.length} objects in ${(bakeMs / 1000).toFixed(2)}s`);
  console.log(`  Palette usage: ${nextFreeIndex} / ${PALETTE_SIZE} indices (${TERRAIN_PALETTE_MAX} terrain + ${nextFreeIndex - TERRAIN_PALETTE_MAX - 1} object colors)`);

  // 5. Generate spawn and capture points
  console.log('\n--- Gameplay ---');
  const spawnPoints = generateSpawns(bounds, terrainResult.getHeight);
  const capturePoints = generateCapturePoints(bounds, terrainResult.getHeight);
  console.log(`  Spawns: alpha=${spawnPoints.alpha.length}, bravo=${spawnPoints.bravo.length}`);
  console.log(`  Capture points: ${capturePoints.length}`);

  // 6. Write outputs
  console.log('\n--- Output ---');

  const mapPath = `${resolvedOutput}.map`;
  const palettePath = `${resolvedOutput}.palette.json`;
  const metaPath = `${resolvedOutput}.meta.json`;

  writeCLWF(mapPath, TERRAIN_PALETTE);

  fs.writeFileSync(palettePath, JSON.stringify(TERRAIN_PALETTE, null, 2));
  console.log(`  Palette: ${palettePath}`);

  const meta = {
    name: mapName,
    description: `Procedurally generated town map (${mapSize}x${mapSize}, seed ${seed})`,
    spawn_points: spawnPoints,
    capture_points: capturePoints,
    objects: objectPlacements,
  };
  fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2) + '\n');
  console.log(`  Meta: ${metaPath} (${objectPlacements.length} objects)`);

  const totalMs = performance.now() - startTime;
  console.log(`\n=== Done in ${(totalMs / 1000).toFixed(2)}s ===`);
  console.log(`  ${mapPath}`);
  console.log(`  ${palettePath}`);
  console.log(`  ${metaPath}`);
}

main();
