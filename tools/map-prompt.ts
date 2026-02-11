/**
 * map-prompt.ts
 *
 * CLI tool that generates a complete .mapdef.json file from template parameters.
 * Uses deterministic seeded PRNG (no external deps) to produce reproducible layouts.
 *
 * Usage:
 *   npx tsx tools/map-prompt.ts --template urban --size medium --name "Downtown" --teams symmetric
 *   npx tsx tools/map-prompt.ts --template coastal --size large --name "Pacific Shore" --teams asymmetric
 *   npx tsx tools/map-prompt.ts --template desert --size small --name "Outpost Alpha" --teams symmetric
 *   npx tsx tools/map-prompt.ts --template forest --size medium --name "Pine Ridge" --teams symmetric --seed 42
 *   npx tsx tools/map-prompt.ts --template industrial --size large --name "Ironworks" --teams asymmetric --output ./my-map.mapdef.json
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

type Template = 'urban' | 'desert' | 'forest' | 'coastal' | 'industrial' | 'crossroads';
type MapSize = 'small' | 'medium' | 'large';
type TeamLayout = 'symmetric' | 'asymmetric';

interface CliArgs {
  template: Template;
  size: MapSize;
  name: string;
  teams: TeamLayout;
  seed: number;
  output: string;
}

function printUsage(): void {
  console.log(`
Usage: npx tsx tools/map-prompt.ts [options]

Options:
  --template <type>   Map template: urban | desert | forest | coastal | industrial | crossroads
  --size <size>       Map size: small (120x120) | medium (200x200) | large (300x300)
  --name <name>       Map display name (quoted if contains spaces)
  --teams <layout>    Team layout: symmetric | asymmetric
  --seed <number>     Random seed (default: random)
  --output <path>     Output path (default: assets/maps/{name}.mapdef.json)

Examples:
  npx tsx tools/map-prompt.ts --template urban --size medium --name "Downtown" --teams symmetric
  npx tsx tools/map-prompt.ts --template coastal --size large --name "Pacific Shore" --teams asymmetric
  npx tsx tools/map-prompt.ts --template desert --size small --name "Outpost Alpha" --teams symmetric --seed 42
`);
}

function parseArgs(): CliArgs | null {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    printUsage();
    return null;
  }

  const get = (flag: string): string | undefined => {
    const idx = args.indexOf(flag);
    if (idx === -1 || idx + 1 >= args.length) return undefined;
    return args[idx + 1];
  };

  const template = get('--template') as Template | undefined;
  const size = get('--size') as MapSize | undefined;
  const name = get('--name');
  const teams = get('--teams') as TeamLayout | undefined;
  const seedStr = get('--seed');
  const output = get('--output');

  const validTemplates: Template[] = ['urban', 'desert', 'forest', 'coastal', 'industrial', 'crossroads'];
  const validSizes: MapSize[] = ['small', 'medium', 'large'];
  const validTeams: TeamLayout[] = ['symmetric', 'asymmetric'];

  if (!template || !validTemplates.includes(template)) {
    console.error(`Error: --template must be one of: ${validTemplates.join(', ')}`);
    return null;
  }
  if (!size || !validSizes.includes(size)) {
    console.error(`Error: --size must be one of: ${validSizes.join(', ')}`);
    return null;
  }
  if (!name) {
    console.error('Error: --name is required');
    return null;
  }
  if (!teams || !validTeams.includes(teams)) {
    console.error(`Error: --teams must be one of: ${validTeams.join(', ')}`);
    return null;
  }

  const seed = seedStr !== undefined ? parseInt(seedStr, 10) : Math.floor(Math.random() * 1_000_000);
  const slug = name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
  const outputPath = output ?? `assets/maps/${slug}.mapdef.json`;

  return { template, size, name, teams, seed, output: outputPath };
}

// ---------------------------------------------------------------------------
// Seeded PRNG (Mulberry32) - no external dependencies
// ---------------------------------------------------------------------------

function mulberry32(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

class Rng {
  private next: () => number;
  constructor(seed: number) {
    this.next = mulberry32(seed);
  }
  /** Returns float in [0, 1) */
  random(): number { return this.next(); }
  /** Returns integer in [min, max] inclusive */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }
  /** Returns float in [min, max) */
  float(min: number, max: number): number {
    return min + this.next() * (max - min);
  }
  /** Pick random element from array */
  pick<T>(arr: T[]): T { return arr[this.int(0, arr.length - 1)]; }
  /** Shuffle array in place (Fisher-Yates) */
  shuffle<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = this.int(0, i);
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }
}

// ---------------------------------------------------------------------------
// Size configuration
// ---------------------------------------------------------------------------

interface SizeConfig {
  halfX: number;  // bounds will be [-halfX, halfX]
  halfZ: number;
  yMin: number;
  yMax: number;
  buildingCount: { min: number; max: number };
  vehicleCount: { min: number; max: number };
  capturePointCount: { min: number; max: number };
}

const SIZE_CONFIGS: Record<MapSize, SizeConfig> = {
  small:  { halfX: 60,  halfZ: 60,  yMin: -4, yMax: 24, buildingCount: { min: 6,  max: 10 }, vehicleCount: { min: 3,  max: 6  }, capturePointCount: { min: 3, max: 3 } },
  medium: { halfX: 100, halfZ: 100, yMin: -4, yMax: 32, buildingCount: { min: 10, max: 18 }, vehicleCount: { min: 6,  max: 12 }, capturePointCount: { min: 3, max: 5 } },
  large:  { halfX: 150, halfZ: 150, yMin: -4, yMax: 40, buildingCount: { min: 16, max: 28 }, vehicleCount: { min: 10, max: 18 }, capturePointCount: { min: 5, max: 5 } },
};

// ---------------------------------------------------------------------------
// Terrain palettes per template
// ---------------------------------------------------------------------------

interface PaletteEntry { index: number; r: number; g: number; b: number }

function basePalette(): Record<string, PaletteEntry> {
  return {
    GRASS:         { index: 1,  r: 74,  g: 140, b: 63  },
    DIRT:          { index: 2,  r: 122, g: 92,  b: 58  },
    STONE:         { index: 3,  r: 136, g: 136, b: 136 },
    WATER:         { index: 6,  r: 35,  g: 137, b: 218 },
    SAND_LIGHT:    { index: 7,  r: 212, g: 184, b: 150 },
    SAND_DARK:     { index: 8,  r: 196, g: 166, b: 122 },
    GRASS_DARK:    { index: 9,  r: 74,  g: 122, b: 51  },
    STONE_DARK:    { index: 10, r: 102, g: 102, b: 102 },
    CONCRETE:      { index: 11, r: 160, g: 160, b: 160 },
    CONCRETE_DARK: { index: 12, r: 128, g: 128, b: 128 },
    WOOD:          { index: 13, r: 139, g: 105, b: 20  },
    WOOD_DARK:     { index: 14, r: 107, g: 79,  b: 16  },
    BRICK:         { index: 15, r: 160, g: 82,  b: 40  },
    ROOF_TILE:     { index: 16, r: 139, g: 69,  b: 19  },
    WATER_DEEP:    { index: 17, r: 26,  g: 76,  b: 128 },
    ROAD:          { index: 18, r: 85,  g: 85,  b: 85  },
    WINDOW:        { index: 19, r: 135, g: 206, b: 235 },
    METAL:         { index: 20, r: 112, g: 128, b: 144 },
  };
}

function templatePalette(template: Template): Record<string, PaletteEntry> {
  const p = basePalette();

  switch (template) {
    case 'urban':
      // More concrete tones, asphalt
      p.GRASS =       { index: 1,  r: 60,  g: 120, b: 55  };
      p.GRASS_DARK =  { index: 9,  r: 50,  g: 100, b: 40  };
      p.ROAD =        { index: 18, r: 70,  g: 70,  b: 70  };
      p.CONCRETE =    { index: 11, r: 175, g: 175, b: 175 };
      p.BRICK =       { index: 15, r: 150, g: 75,  b: 38  };
      break;

    case 'desert':
      // Warm sandy tones, minimal water
      p.GRASS =       { index: 1,  r: 180, g: 165, b: 120 };  // sandy ground
      p.DIRT =        { index: 2,  r: 160, g: 130, b: 85  };
      p.GRASS_DARK =  { index: 9,  r: 165, g: 145, b: 100 };
      p.SAND_LIGHT =  { index: 7,  r: 225, g: 200, b: 160 };
      p.SAND_DARK =   { index: 8,  r: 205, g: 175, b: 130 };
      p.STONE =       { index: 3,  r: 170, g: 155, b: 130 };
      p.STONE_DARK =  { index: 10, r: 140, g: 125, b: 100 };
      p.CONCRETE =    { index: 11, r: 185, g: 175, b: 160 };
      p.CONCRETE_DARK = { index: 12, r: 155, g: 145, b: 130 };
      break;

    case 'forest':
      // Rich greens, mossy stone
      p.GRASS =       { index: 1,  r: 55,  g: 145, b: 45  };
      p.GRASS_DARK =  { index: 9,  r: 40,  g: 110, b: 35  };
      p.DIRT =        { index: 2,  r: 100, g: 75,  b: 45  };
      p.STONE =       { index: 3,  r: 120, g: 130, b: 115 };  // mossy stone
      p.STONE_DARK =  { index: 10, r: 90,  g: 100, b: 85  };
      p.WOOD =        { index: 13, r: 120, g: 85,  b: 30  };
      p.WOOD_DARK =   { index: 14, r: 90,  g: 60,  b: 20  };
      break;

    case 'coastal':
      // Beach-forward palette, vivid water
      p.SAND_LIGHT =  { index: 7,  r: 230, g: 210, b: 170 };
      p.SAND_DARK =   { index: 8,  r: 210, g: 185, b: 140 };
      p.WATER =       { index: 6,  r: 30,  g: 150, b: 230 };
      p.WATER_DEEP =  { index: 17, r: 20,  g: 80,  b: 140 };
      p.GRASS =       { index: 1,  r: 80,  g: 150, b: 65  };
      p.STONE =       { index: 3,  r: 140, g: 140, b: 140 };
      p.WOOD =        { index: 13, r: 145, g: 110, b: 30  };
      break;

    case 'industrial':
      // Grays, rust, metal
      p.GRASS =       { index: 1,  r: 65,  g: 110, b: 55  };  // sparse grass
      p.GRASS_DARK =  { index: 9,  r: 50,  g: 85,  b: 40  };
      p.CONCRETE =    { index: 11, r: 170, g: 170, b: 170 };
      p.CONCRETE_DARK = { index: 12, r: 140, g: 140, b: 140 };
      p.METAL =       { index: 20, r: 100, g: 115, b: 130 };
      p.BRICK =       { index: 15, r: 145, g: 70,  b: 35  };  // rusted
      p.ROAD =        { index: 18, r: 75,  g: 75,  b: 75  };
      p.ROOF_TILE =   { index: 16, r: 120, g: 60,  b: 25  };
      break;

    case 'crossroads':
      // Urban warfare: dark asphalt, concrete sidewalks, rich greens for parks
      p.GRASS =         { index: 1,  r: 68,  g: 135, b: 55  };
      p.DIRT =          { index: 2,  r: 115, g: 88,  b: 52  };
      p.STONE =         { index: 3,  r: 145, g: 145, b: 145 };
      p.GRASS_DARK =    { index: 9,  r: 48,  g: 105, b: 38  };
      p.STONE_DARK =    { index: 10, r: 110, g: 110, b: 110 };
      p.CONCRETE =      { index: 11, r: 180, g: 180, b: 180 };
      p.CONCRETE_DARK = { index: 12, r: 145, g: 145, b: 145 };
      p.WOOD =          { index: 13, r: 135, g: 100, b: 22  };
      p.WOOD_DARK =     { index: 14, r: 100, g: 74,  b: 18  };
      p.BRICK =         { index: 15, r: 155, g: 78,  b: 38  };
      p.ROOF_TILE =     { index: 16, r: 135, g: 65,  b: 22  };
      p.ROAD =          { index: 18, r: 60,  g: 60,  b: 60  };  // dark asphalt
      p.WINDOW =        { index: 19, r: 130, g: 200, b: 230 };
      p.METAL =         { index: 20, r: 105, g: 120, b: 138 };
      // Add sidewalk and curb colors
      p.SIDEWALK =      { index: 21, r: 190, g: 185, b: 175 };
      p.CURB =          { index: 22, r: 165, g: 160, b: 150 };
      p.ROAD_MARKING =  { index: 23, r: 220, g: 220, b: 200 };
      break;
  }

  return p;
}

// ---------------------------------------------------------------------------
// Component catalogs per template
// ---------------------------------------------------------------------------

// Available building component IDs from the existing shoreline mapdef and memory docs
const BUILDING_COMPONENTS = {
  urban: [
    'buildings/cinema/model_000',
    'buildings/cafe/model_000',
    'buildings/apartment_a/model_000',
    'buildings/office_small_a/model_000',
    'buildings/office_small_b/model_000',
    'buildings/office_med_a/model_000',
    'buildings/office_large_a/model_000',
    'buildings/tower_a/model_000',
    'buildings/house_a/model_000',
  ],
  desert: [
    'buildings/house_a/model_000',
    'buildings/cafe/model_000',
    'buildings/office_small_a/model_000',
    'buildings/office_small_b/model_000',
    'oasis/model_279',
    'oasis/model_083',
    'oasis/model_071',
    'oasis/model_086',
  ],
  forest: [
    'buildings/house_a/model_000',
    'buildings/cafe/model_000',
    'oasis/model_205',
    'oasis/model_045',
    'oasis/model_161',
    'oasis/model_163',
  ],
  coastal: [
    'buildings/house_a/model_000',
    'buildings/cafe/model_000',
    'buildings/cinema/model_000',
    'buildings/office_small_a/model_000',
    'buildings/office_small_b/model_000',
    'oasis/model_279',
    'oasis/model_277',
    'oasis/model_278',
  ],
  industrial: [
    'buildings/office_large_a/model_000',
    'buildings/office_med_a/model_000',
    'buildings/office_small_a/model_000',
    'buildings/office_small_b/model_000',
    'buildings/tower_a/model_000',
    'oasis/model_279',
    'oasis/model_086',
  ],
  crossroads: [
    'craftsman_home', 'colonial_house', 'townhouse', 'ranch_house',
    'corner_store', 'pharmacy', 'bookstore', 'hardware_store', 'bakery',
    'diner', 'pizza_place', 'apartment_block_1', 'apartment_block_2',
    'office_building_1', 'office_building_2', 'bunker', 'watchtower',
    'spanish_villa', 'suburban_house', 'compact_home', 'modern_house',
    'laundromat', 'small_shop', 'market', 'deli',
  ],
};

const VEHICLE_COMPONENTS = [
  'vehicles/car-v1/model_000',
  'vehicles/car-v2/model_000',
  'vehicles/car-v3/model_000',
  'vehicles/car-v4/model_000',
  'vehicles/car-v5/model_000',
  'vehicles/truck-v1/model_000',
  'vehicles/truck-v3/model_000',
  'vehicles/bus-small/model_000',
  'vehicles/container/model_000',
  'vehicles/emergency-ambulance-1/model_000',
  'vehicles/emergency-police-1/model_000',
  'vehicles/tractor/model_000',
];

// Crossroads uses vobj registry IDs for vehicles
const CROSSROADS_VEHICLE_COMPONENTS = [
  'sedan_1', 'sedan_2', 'sedan_3', 'sedan_4', 'sedan_5',
  'taxi', 'city_bus', 'police_car', 'suv_1', 'suv_2',
  'truck', 'delivery_truck',
];

// Prop components for crossroads (vobj registry IDs)
const PROP_COMPONENTS: Record<string, string[]> = {
  crossroads: [
    'street_light_1', 'street_light_2', 'street_light_3',
    'traffic_light_1', 'traffic_light_2',
    'park_bench', 'park_bench_2', 'park_bench_3',
    'trash_can', 'dumpster_1',
    'fire_hydrant', 'bus_stop',
    'planter_1', 'planter_2',
    'traffic_cone', 'newsbox_1', 'newsbox_2',
    'mailbox_1', 'street_sign_1', 'street_sign_2',
    'shipping_container_1', 'column_1',
    'fountain', 'statue_1',
  ],
};

// Vegetation components (vobj registry IDs)
const VEGETATION_COMPONENTS: Record<string, string[]> = {
  crossroads: ['small_tree', 'medium_tree', 'pine_tree'],
};

// ---------------------------------------------------------------------------
// Map generation types
// ---------------------------------------------------------------------------

interface Placement {
  componentId: string;
  position: { x: number; y: number; z: number };
  rotation: number;
  terrainCarve: boolean;
}

interface CapturePoint {
  id: string;
  position: { x: number; y: number; z: number };
  initialOwner: number;
}

interface Objective {
  id: string;
  type: string;
  position: { x: number; y: number; z: number };
}

interface Bounds {
  xMin: number; xMax: number;
  yMin: number; yMax: number;
  zMin: number; zMax: number;
}

interface MapdefOutput {
  name: string;
  bounds: Bounds;
  terrain: { generator: string; waterLevel: number; seed?: number };
  terrainPalette: Record<string, PaletteEntry>;
  placements: Placement[];
  metadata: {
    spawnPoints: Record<string, { x: number; y: number; z: number }[]>;
    capturePoints: CapturePoint[];
    objectives: Objective[];
  };
}

// ---------------------------------------------------------------------------
// Placement grid helpers (avoid overlapping buildings)
// ---------------------------------------------------------------------------

interface PlacedRect {
  x: number; z: number; w: number; d: number;
}

function rectsOverlap(a: PlacedRect, b: PlacedRect, margin: number): boolean {
  return !(
    a.x + a.w + margin <= b.x ||
    b.x + b.w + margin <= a.x ||
    a.z + a.d + margin <= b.z ||
    b.z + b.d + margin <= a.z
  );
}

function isValidPlacement(candidate: PlacedRect, existing: PlacedRect[], margin: number): boolean {
  for (const e of existing) {
    if (rectsOverlap(candidate, e, margin)) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Terrain height estimation (matches map-compose.ts generic heightmap)
// ---------------------------------------------------------------------------

function estimateHeight(x: number, z: number, seed: number, bounds: Bounds): number {
  const s = seed * 0.1;
  let h = 3;
  h += Math.sin(x / 25 + s) * Math.cos(z / 20 + s * 0.7) * 1.5;
  h += Math.sin(x / 13 + s * 1.3) * Math.cos(z / 11 + s * 0.4) * 0.8;
  h += Math.sin(x / 40 + s * 0.5) * Math.cos(z / 35 + s * 1.1) * 0.5;

  const xRange = bounds.xMax - bounds.xMin;
  const zRange = bounds.zMax - bounds.zMin;
  const xEdgeDist = Math.min(Math.abs(x - bounds.xMin), Math.abs(x - bounds.xMax));
  const zEdgeDist = Math.min(Math.abs(z - bounds.zMin), Math.abs(z - bounds.zMax));
  const edgeDist = Math.min(xEdgeDist / (xRange * 0.1), zEdgeDist / (zRange * 0.1), 1);
  if (edgeDist < 1) {
    h = h * edgeDist + 1 * (1 - edgeDist);
  }
  h = Math.max(1, h);
  return Math.round(h);
}

// ---------------------------------------------------------------------------
// Building scatter strategies
// ---------------------------------------------------------------------------

interface LayoutStrategy {
  /**
   * Generate candidate building positions.
   * Returns footprints in world space: { x, z, w, d } where x,z is bottom-left corner.
   */
  generate(
    rng: Rng,
    count: number,
    bounds: Bounds,
    seed: number,
  ): PlacedRect[];
}

/** Urban: dense grid along roads with small random offsets */
const urbanLayout: LayoutStrategy = {
  generate(rng, count, bounds) {
    const results: PlacedRect[] = [];
    const playableX = bounds.xMax - bounds.xMin;
    const playableZ = bounds.zMax - bounds.zMin;
    // Grid spacing: try to fill roughly 60% of the playable area center
    const margin = 6;
    const cellSize = Math.max(20, Math.floor(Math.sqrt((playableX * playableZ * 0.5) / count)));
    const innerMarginX = Math.floor(playableX * 0.12);
    const innerMarginZ = Math.floor(playableZ * 0.12);

    const startX = bounds.xMin + innerMarginX;
    const endX = bounds.xMax - innerMarginX;
    const startZ = bounds.zMin + innerMarginZ;
    const endZ = bounds.zMax - innerMarginZ;

    const candidates: { x: number; z: number }[] = [];
    for (let gx = startX; gx < endX; gx += cellSize) {
      for (let gz = startZ; gz < endZ; gz += cellSize) {
        candidates.push({ x: gx + rng.int(-3, 3), z: gz + rng.int(-3, 3) });
      }
    }
    rng.shuffle(candidates);

    for (const c of candidates) {
      if (results.length >= count) break;
      const w = rng.int(8, 16);
      const d = rng.int(8, 14);
      const rect: PlacedRect = { x: c.x, z: c.z, w, d };
      if (rect.x + rect.w > bounds.xMax - 10 || rect.z + rect.d > bounds.zMax - 10) continue;
      if (rect.x < bounds.xMin + 10 || rect.z < bounds.zMin + 10) continue;
      if (isValidPlacement(rect, results, margin)) {
        results.push(rect);
      }
    }
    return results;
  },
};

/** Desert: sparse outposts/compounds clustered around a few points */
const desertLayout: LayoutStrategy = {
  generate(rng, count, bounds) {
    const results: PlacedRect[] = [];
    const margin = 10; // more spacing
    // Pick 2-4 cluster centers
    const clusterCount = rng.int(2, Math.min(4, Math.ceil(count / 3)));
    const playableRangeX = (bounds.xMax - bounds.xMin) * 0.35;
    const playableRangeZ = (bounds.zMax - bounds.zMin) * 0.35;
    const centers: { x: number; z: number }[] = [];
    for (let i = 0; i < clusterCount; i++) {
      centers.push({
        x: rng.int(-Math.floor(playableRangeX), Math.floor(playableRangeX)),
        z: rng.int(-Math.floor(playableRangeZ), Math.floor(playableRangeZ)),
      });
    }

    let attempts = 0;
    while (results.length < count && attempts < count * 20) {
      attempts++;
      const center = rng.pick(centers);
      const x = center.x + rng.int(-20, 20);
      const z = center.z + rng.int(-20, 20);
      const w = rng.int(6, 12);
      const d = rng.int(6, 10);
      const rect: PlacedRect = { x, z, w, d };
      if (rect.x + rect.w > bounds.xMax - 10 || rect.z + rect.d > bounds.zMax - 10) continue;
      if (rect.x < bounds.xMin + 10 || rect.z < bounds.zMin + 10) continue;
      if (isValidPlacement(rect, results, margin)) {
        results.push(rect);
      }
    }
    return results;
  },
};

/** Forest: scattered cabins in clearings */
const forestLayout: LayoutStrategy = {
  generate(rng, count, bounds) {
    const results: PlacedRect[] = [];
    const margin = 12; // large gaps for "forest clearings"
    let attempts = 0;
    while (results.length < count && attempts < count * 30) {
      attempts++;
      const x = rng.int(bounds.xMin + 15, bounds.xMax - 25);
      const z = rng.int(bounds.zMin + 15, bounds.zMax - 25);
      const w = rng.int(5, 10);
      const d = rng.int(5, 10);
      const rect: PlacedRect = { x, z, w, d };
      if (isValidPlacement(rect, results, margin)) {
        results.push(rect);
      }
    }
    return results;
  },
};

/** Coastal: buildings along the beach edge (one side) + inland clusters */
const coastalLayout: LayoutStrategy = {
  generate(rng, count, bounds) {
    const results: PlacedRect[] = [];
    const margin = 8;
    // Beach side = negative X (like Shoreline). Put some buildings near x ~ -halfX*0.4..0
    const beachCount = Math.max(2, Math.floor(count * 0.4));
    const inlandCount = count - beachCount;

    // Beach strip buildings
    let attempts = 0;
    while (results.length < beachCount && attempts < beachCount * 20) {
      attempts++;
      const x = rng.int(bounds.xMin + 15, Math.floor(bounds.xMin * 0.2));
      const z = rng.int(bounds.zMin + 15, bounds.zMax - 15);
      const w = rng.int(6, 12);
      const d = rng.int(6, 10);
      const rect: PlacedRect = { x, z, w, d };
      if (isValidPlacement(rect, results, margin)) {
        results.push(rect);
      }
    }

    // Inland buildings
    attempts = 0;
    while (results.length < beachCount + inlandCount && attempts < inlandCount * 20) {
      attempts++;
      const x = rng.int(0, bounds.xMax - 20);
      const z = rng.int(bounds.zMin + 15, bounds.zMax - 15);
      const w = rng.int(8, 14);
      const d = rng.int(8, 12);
      const rect: PlacedRect = { x, z, w, d };
      if (isValidPlacement(rect, results, margin)) {
        results.push(rect);
      }
    }

    return results;
  },
};

/** Industrial: warehouses and factories in linear rows */
const industrialLayout: LayoutStrategy = {
  generate(rng, count, bounds) {
    const results: PlacedRect[] = [];
    const margin = 6;
    // Two main "rows" of industrial buildings along z-axis
    const rowCount = 2;
    const rowSpacing = Math.floor((bounds.zMax - bounds.zMin) * 0.25);
    const rowZs = [
      -rowSpacing,
      rowSpacing,
    ];

    let attempts = 0;
    while (results.length < count && attempts < count * 25) {
      attempts++;
      const rowZ = rng.pick(rowZs) + rng.int(-8, 8);
      const x = rng.int(bounds.xMin + 15, bounds.xMax - 25);
      const w = rng.int(10, 20);  // warehouses are wider
      const d = rng.int(8, 14);
      const rect: PlacedRect = { x, z: rowZ, w, d };
      if (rect.x + rect.w > bounds.xMax - 10 || rect.z + rect.d > bounds.zMax - 10) continue;
      if (rect.z < bounds.zMin + 10) continue;
      if (isValidPlacement(rect, results, margin)) {
        results.push(rect);
      }
    }
    return results;
  },
};

/** Crossroads: buildings in 4 quadrants around a central intersection, roads kept clear */
const crossroadsLayout: LayoutStrategy = {
  generate(rng, count, bounds) {
    const results: PlacedRect[] = [];
    const margin = 8;
    // Road corridors: main roads at x≈0 and z≈0, keep ±10 voxels clear
    const roadClearance = 12;
    const perQuadrant = Math.ceil(count / 4);

    // 4 quadrants: NE (+x, +z), NW (-x, +z), SW (-x, -z), SE (+x, -z)
    const quadrants = [
      { xMin: roadClearance, xMax: bounds.xMax - 15, zMin: roadClearance, zMax: bounds.zMax - 15 },
      { xMin: bounds.xMin + 15, xMax: -roadClearance, zMin: roadClearance, zMax: bounds.zMax - 15 },
      { xMin: bounds.xMin + 15, xMax: -roadClearance, zMin: bounds.zMin + 15, zMax: -roadClearance },
      { xMin: roadClearance, xMax: bounds.xMax - 15, zMin: bounds.zMin + 15, zMax: -roadClearance },
    ];

    for (const quad of quadrants) {
      const quadWidth = quad.xMax - quad.xMin;
      const quadDepth = quad.zMax - quad.zMin;
      if (quadWidth < 20 || quadDepth < 20) continue;

      // Grid cells within the quadrant
      const cellSize = Math.max(18, Math.floor(Math.sqrt((quadWidth * quadDepth * 0.5) / perQuadrant)));
      const candidates: { x: number; z: number }[] = [];
      for (let gx = quad.xMin + 3; gx < quad.xMax - 10; gx += cellSize) {
        for (let gz = quad.zMin + 3; gz < quad.zMax - 10; gz += cellSize) {
          candidates.push({ x: gx + rng.int(-2, 2), z: gz + rng.int(-2, 2) });
        }
      }
      rng.shuffle(candidates);

      let placed = 0;
      for (const c of candidates) {
        if (placed >= perQuadrant) break;
        const w = rng.int(10, 18);
        const d = rng.int(8, 16);
        const rect: PlacedRect = { x: c.x, z: c.z, w, d };
        if (rect.x + rect.w > quad.xMax) continue;
        if (rect.z + rect.d > quad.zMax) continue;
        // Ensure not overlapping road corridors
        if (rect.x < roadClearance && rect.x + rect.w > -roadClearance) continue;
        if (rect.z < roadClearance && rect.z + rect.d > -roadClearance) continue;
        if (isValidPlacement(rect, results, margin)) {
          results.push(rect);
          placed++;
        }
      }
    }
    return results;
  },
};

const LAYOUT_STRATEGIES: Record<Template, LayoutStrategy> = {
  urban: urbanLayout,
  desert: desertLayout,
  forest: forestLayout,
  coastal: coastalLayout,
  industrial: industrialLayout,
  crossroads: crossroadsLayout,
};

// ---------------------------------------------------------------------------
// Building placement generation
// ---------------------------------------------------------------------------

function generateBuildingPlacements(
  rng: Rng,
  template: Template,
  count: number,
  bounds: Bounds,
  seed: number,
): { placements: Placement[]; rects: PlacedRect[] } {
  const strategy = LAYOUT_STRATEGIES[template];
  const rects = strategy.generate(rng, count, bounds, seed);
  const components = BUILDING_COMPONENTS[template];
  const rotations = [0, 90, 180, 270];

  const heightFn = template === 'crossroads'
    ? (x: number, z: number) => estimateHeightCrossroads(x, z, bounds)
    : (x: number, z: number) => estimateHeight(x, z, seed, bounds);

  const placements: Placement[] = rects.map((rect) => {
    const compId = rng.pick(components);
    const centerX = rect.x + Math.floor(rect.w / 2);
    const centerZ = rect.z + Math.floor(rect.d / 2);
    const y = heightFn(centerX, centerZ);
    return {
      componentId: compId,
      position: { x: centerX, y, z: centerZ },
      rotation: rng.pick(rotations),
      terrainCarve: true,
    };
  });

  return { placements, rects };
}

// ---------------------------------------------------------------------------
// Vehicle placement generation
// ---------------------------------------------------------------------------

/** Crossroads height estimate: mostly flat urban terrain */
function estimateHeightCrossroads(x: number, z: number, bounds: Bounds): number {
  let h = 3;
  // Road corridors depressed slightly
  const inRoadX = Math.abs(x) < 5;
  const inRoadZ = Math.abs(z) < 5;
  if (inRoadX || inRoadZ) {
    h = 2;
  }
  // Gentle hills at map corners
  const cornerDist = Math.min(
    Math.sqrt((x - bounds.xMax * 0.7) ** 2 + (z - bounds.zMax * 0.7) ** 2),
    Math.sqrt((x - bounds.xMin * 0.7) ** 2 + (z - bounds.zMin * 0.7) ** 2),
    Math.sqrt((x - bounds.xMax * 0.7) ** 2 + (z - bounds.zMin * 0.7) ** 2),
    Math.sqrt((x - bounds.xMin * 0.7) ** 2 + (z - bounds.zMax * 0.7) ** 2),
  );
  const cornerInfluence = Math.max(0, 1 - cornerDist / 60);
  h += cornerInfluence * 3;
  // Edge drop-off
  const xEdge = Math.min(Math.abs(x - bounds.xMin), Math.abs(x - bounds.xMax));
  const zEdge = Math.min(Math.abs(z - bounds.zMin), Math.abs(z - bounds.zMax));
  const edgeDist = Math.min(xEdge, zEdge);
  if (edgeDist < 10) {
    h = h * (edgeDist / 10) + 1 * (1 - edgeDist / 10);
  }
  return Math.max(1, Math.round(h));
}

function generateVehiclePlacements(
  rng: Rng,
  count: number,
  bounds: Bounds,
  buildingRects: PlacedRect[],
  seed: number,
  template?: Template,
): Placement[] {
  const placements: Placement[] = [];
  const rotations = [0, 90, 180, 270];
  const vehicleRect: PlacedRect = { x: 0, z: 0, w: 4, d: 2 };
  const usedRects: PlacedRect[] = [...buildingRects];
  const vehiclePool = template === 'crossroads' ? CROSSROADS_VEHICLE_COMPONENTS : VEHICLE_COMPONENTS;
  const heightFn = template === 'crossroads'
    ? (x: number, z: number) => estimateHeightCrossroads(x, z, bounds)
    : (x: number, z: number) => estimateHeight(x, z, seed, bounds);

  let attempts = 0;
  while (placements.length < count && attempts < count * 30) {
    attempts++;
    let x: number, z: number;
    if (template === 'crossroads') {
      // Place vehicles along road corridors
      if (rng.random() < 0.5) {
        // Along E-W road
        x = rng.int(bounds.xMin + 15, bounds.xMax - 15);
        z = rng.int(-12, 12);
      } else {
        // Along N-S road
        x = rng.int(-12, 12);
        z = rng.int(bounds.zMin + 15, bounds.zMax - 15);
      }
    } else {
      x = rng.int(bounds.xMin + 10, bounds.xMax - 10);
      z = rng.int(bounds.zMin + 10, bounds.zMax - 10);
    }
    vehicleRect.x = x;
    vehicleRect.z = z;
    if (isValidPlacement(vehicleRect, usedRects, 3)) {
      const y = heightFn(x, z);
      placements.push({
        componentId: rng.pick(vehiclePool),
        position: { x, y, z },
        rotation: rng.pick(rotations),
        terrainCarve: false,
      });
      usedRects.push({ ...vehicleRect });
    }
  }

  return placements;
}

// ---------------------------------------------------------------------------
// Prop placement generation (crossroads)
// ---------------------------------------------------------------------------

function generatePropPlacements(
  rng: Rng,
  template: Template,
  bounds: Bounds,
  buildingRects: PlacedRect[],
): Placement[] {
  const propPool = PROP_COMPONENTS[template];
  if (!propPool) return [];

  const placements: Placement[] = [];
  const rotations = [0, 90, 180, 270];
  const usedRects: PlacedRect[] = [...buildingRects];
  const propRect: PlacedRect = { x: 0, z: 0, w: 2, d: 2 };
  const heightFn = template === 'crossroads'
    ? (x: number, z: number) => estimateHeightCrossroads(x, z, bounds)
    : (x: number, z: number) => estimateHeight(x, z, 0, bounds);

  // Street lights and signs along road edges (every 15-20 voxels)
  const streetProps = propPool.filter((p) =>
    p.includes('street_light') || p.includes('traffic_light') || p.includes('sign')
  );
  const otherProps = propPool.filter((p) =>
    !p.includes('street_light') && !p.includes('traffic_light') && !p.includes('sign')
  );

  // Place props along E-W road edges
  for (let x = bounds.xMin + 20; x < bounds.xMax - 20; x += rng.int(14, 22)) {
    for (const zOff of [-6, 6]) {
      if (streetProps.length === 0) break;
      propRect.x = x;
      propRect.z = zOff;
      if (isValidPlacement(propRect, usedRects, 2)) {
        const y = heightFn(x, zOff);
        placements.push({
          componentId: rng.pick(streetProps),
          position: { x, y, z: zOff },
          rotation: rng.pick(rotations),
          terrainCarve: false,
        });
        usedRects.push({ ...propRect });
      }
    }
  }

  // Place props along N-S road edges
  for (let z = bounds.zMin + 20; z < bounds.zMax - 20; z += rng.int(14, 22)) {
    for (const xOff of [-6, 6]) {
      if (streetProps.length === 0) break;
      propRect.x = xOff;
      propRect.z = z;
      if (isValidPlacement(propRect, usedRects, 2)) {
        const y = heightFn(xOff, z);
        placements.push({
          componentId: rng.pick(streetProps),
          position: { x: xOff, y, z },
          rotation: rng.pick(rotations),
          terrainCarve: false,
        });
        usedRects.push({ ...propRect });
      }
    }
  }

  // Traffic lights at intersection
  for (const [x, z] of [[7, 7], [-7, 7], [-7, -7], [7, -7]] as [number, number][]) {
    const y = heightFn(x, z);
    placements.push({
      componentId: rng.pick(propPool.filter((p) => p.includes('traffic_light')) || streetProps),
      position: { x, y, z },
      rotation: rng.pick(rotations),
      terrainCarve: false,
    });
  }

  // Scatter other props near buildings and in open areas
  let attempts = 0;
  const targetMiscProps = rng.int(12, 20);
  while (placements.length < targetMiscProps + 30 && attempts < 200) {
    attempts++;
    const x = rng.int(bounds.xMin + 15, bounds.xMax - 15);
    const z = rng.int(bounds.zMin + 15, bounds.zMax - 15);
    // Skip if in road corridor
    if (Math.abs(x) < 5 && Math.abs(z) < 5) continue;
    propRect.x = x;
    propRect.z = z;
    if (isValidPlacement(propRect, usedRects, 3) && otherProps.length > 0) {
      const y = heightFn(x, z);
      placements.push({
        componentId: rng.pick(otherProps),
        position: { x, y, z },
        rotation: rng.pick(rotations),
        terrainCarve: false,
      });
      usedRects.push({ ...propRect });
    }
  }

  return placements;
}

// ---------------------------------------------------------------------------
// Vegetation placement generation
// ---------------------------------------------------------------------------

function generateVegetationPlacements(
  rng: Rng,
  template: Template,
  bounds: Bounds,
  buildingRects: PlacedRect[],
): Placement[] {
  const treePool = VEGETATION_COMPONENTS[template];
  if (!treePool) return [];

  const placements: Placement[] = [];
  const rotations = [0, 90, 180, 270];
  const usedRects: PlacedRect[] = [...buildingRects];
  const treeRect: PlacedRect = { x: 0, z: 0, w: 4, d: 4 };
  const heightFn = template === 'crossroads'
    ? (x: number, z: number) => estimateHeightCrossroads(x, z, bounds)
    : (x: number, z: number) => estimateHeight(x, z, 0, bounds);

  // Place trees in quadrant interiors (green areas / parks)
  const targetTrees = rng.int(12, 24);
  let attempts = 0;
  while (placements.length < targetTrees && attempts < targetTrees * 20) {
    attempts++;
    const x = rng.int(bounds.xMin + 20, bounds.xMax - 20);
    const z = rng.int(bounds.zMin + 20, bounds.zMax - 20);
    // Skip road corridors
    if (Math.abs(x) < 10 || Math.abs(z) < 10) continue;
    treeRect.x = x;
    treeRect.z = z;
    if (isValidPlacement(treeRect, usedRects, 4)) {
      const y = heightFn(x, z);
      placements.push({
        componentId: rng.pick(treePool),
        position: { x, y, z },
        rotation: rng.pick(rotations),
        terrainCarve: false,
      });
      usedRects.push({ ...treeRect });
    }
  }

  return placements;
}

// ---------------------------------------------------------------------------
// Capture point generation
// ---------------------------------------------------------------------------

const CAPTURE_LABELS = ['A', 'B', 'C', 'D', 'E'];

function generateCapturePoints(
  rng: Rng,
  count: number,
  bounds: Bounds,
  buildingRects: PlacedRect[],
  seed: number,
  teams: TeamLayout,
): CapturePoint[] {
  const points: CapturePoint[] = [];

  // Always place center point
  const centerX = 0;
  const centerZ = 0;
  const centerY = estimateHeight(centerX, centerZ, seed, bounds);
  points.push({
    id: CAPTURE_LABELS[Math.floor(count / 2)],
    position: { x: centerX, y: centerY, z: centerZ },
    initialOwner: -1,  // neutral
  });

  // Remaining points: distribute evenly along the X-axis (the team axis)
  const remainingCount = count - 1;
  const halfRemaining = Math.floor(remainingCount / 2);

  // Alpha side points (negative X)
  for (let i = 0; i < halfRemaining; i++) {
    const fraction = (i + 1) / (halfRemaining + 1);
    const x = Math.round(bounds.xMin * 0.35 * fraction + bounds.xMin * 0.15);
    const z = rng.int(-Math.floor(bounds.zMax * 0.3), Math.floor(bounds.zMax * 0.3));
    const y = estimateHeight(x, z, seed, bounds);

    // Try to place near a building for cover
    const nearBuilding = findNearestBuilding(x, z, buildingRects);
    const finalX = nearBuilding ? nearBuilding.x + Math.floor(nearBuilding.w / 2) : x;
    const finalZ = nearBuilding ? nearBuilding.z + Math.floor(nearBuilding.d / 2) + nearBuilding.d : z;
    const finalY = estimateHeight(finalX, finalZ, seed, bounds);

    const labelIdx = Math.floor(count / 2) - (i + 1);
    points.push({
      id: CAPTURE_LABELS[Math.max(0, labelIdx)],
      position: { x: finalX, y: finalY, z: finalZ },
      initialOwner: teams === 'symmetric' ? -1 : 0,  // neutral or alpha-biased
    });
  }

  // Bravo side points (positive X)
  for (let i = 0; i < halfRemaining; i++) {
    const fraction = (i + 1) / (halfRemaining + 1);
    const x = Math.round(bounds.xMax * 0.35 * fraction + bounds.xMax * 0.15);
    const z = rng.int(-Math.floor(bounds.zMax * 0.3), Math.floor(bounds.zMax * 0.3));
    const y = estimateHeight(x, z, seed, bounds);

    const nearBuilding = findNearestBuilding(x, z, buildingRects);
    const finalX = nearBuilding ? nearBuilding.x + Math.floor(nearBuilding.w / 2) : x;
    const finalZ = nearBuilding ? nearBuilding.z + Math.floor(nearBuilding.d / 2) + nearBuilding.d : z;
    const finalY = estimateHeight(finalX, finalZ, seed, bounds);

    const labelIdx = Math.floor(count / 2) + (i + 1);
    points.push({
      id: CAPTURE_LABELS[Math.min(CAPTURE_LABELS.length - 1, labelIdx)],
      position: { x: finalX, y: finalY, z: finalZ },
      initialOwner: teams === 'symmetric' ? -1 : 1,
    });
  }

  // Sort by label
  points.sort((a, b) => a.id.localeCompare(b.id));
  // Re-assign labels sequentially
  for (let i = 0; i < points.length; i++) {
    points[i].id = CAPTURE_LABELS[i];
  }

  return points;
}

function findNearestBuilding(x: number, z: number, rects: PlacedRect[]): PlacedRect | null {
  let best: PlacedRect | null = null;
  let bestDist = Infinity;
  for (const r of rects) {
    const cx = r.x + r.w / 2;
    const cz = r.z + r.d / 2;
    const dist = Math.sqrt((x - cx) ** 2 + (z - cz) ** 2);
    if (dist < bestDist && dist < 40) {
      bestDist = dist;
      best = r;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Spawn point generation
// ---------------------------------------------------------------------------

function generateSpawnPoints(
  bounds: Bounds,
  teams: TeamLayout,
  seed: number,
): Record<string, { x: number; y: number; z: number }[]> {
  const spawnCountPerTeam = 3;
  const spawnSpread = Math.floor(bounds.zMax * 0.3);

  if (teams === 'symmetric') {
    // Mirror across x=0
    const alphaX = Math.round(bounds.xMin * 0.7);
    const bravoX = Math.round(bounds.xMax * 0.7);
    const alphaY = estimateHeight(alphaX, 0, seed, bounds);
    const bravoY = estimateHeight(bravoX, 0, seed, bounds);

    return {
      alpha: [
        { x: alphaX, y: alphaY, z: -spawnSpread },
        { x: alphaX, y: alphaY, z: spawnSpread },
        { x: Math.round(alphaX * 0.9), y: alphaY, z: 0 },
      ],
      bravo: [
        { x: bravoX, y: bravoY, z: -spawnSpread },
        { x: bravoX, y: bravoY, z: spawnSpread },
        { x: Math.round(bravoX * 0.9), y: bravoY, z: 0 },
      ],
    };
  } else {
    // Asymmetric: alpha at bottom-left area, bravo at top-right area
    const alphaX = Math.round(bounds.xMin * 0.65);
    const alphaZ = Math.round(bounds.zMin * 0.4);
    const bravoX = Math.round(bounds.xMax * 0.65);
    const bravoZ = Math.round(bounds.zMax * 0.4);

    const alphaY = estimateHeight(alphaX, alphaZ, seed, bounds);
    const bravoY = estimateHeight(bravoX, bravoZ, seed, bounds);

    return {
      alpha: [
        { x: alphaX, y: alphaY, z: alphaZ - 15 },
        { x: alphaX, y: alphaY, z: alphaZ + 15 },
        { x: Math.round(alphaX * 0.85), y: alphaY, z: alphaZ },
      ],
      bravo: [
        { x: bravoX, y: bravoY, z: bravoZ - 15 },
        { x: bravoX, y: bravoY, z: bravoZ + 15 },
        { x: Math.round(bravoX * 0.85), y: bravoY, z: bravoZ },
      ],
    };
  }
}

// ---------------------------------------------------------------------------
// Objective generation
// ---------------------------------------------------------------------------

const OBJECTIVE_TYPES = ['control', 'flank', 'route', 'chokepoint'];

const OBJECTIVE_NAME_POOLS: Record<Template, string[]> = {
  urban: ['plaza', 'intersection', 'alley', 'overpass', 'parking', 'metro', 'rooftop', 'market', 'bridge', 'tower'],
  desert: ['oasis', 'ridge', 'compound', 'well', 'ruins', 'dune', 'outpost', 'canyon', 'watchtower', 'passage'],
  forest: ['clearing', 'creek', 'lodge', 'overlook', 'trail', 'ravine', 'grove', 'hilltop', 'camp', 'falls'],
  coastal: ['harbor', 'beach', 'lighthouse', 'pier', 'cliff', 'inlet', 'seawall', 'docks', 'cove', 'boardwalk'],
  industrial: ['warehouse', 'silo', 'railyard', 'refinery', 'loading_dock', 'smokestack', 'crane', 'foundry', 'pipeline', 'yard'],
  crossroads: ['intersection', 'plaza', 'market', 'alley', 'overpass', 'courtyard', 'parking', 'park', 'monument', 'depot'],
};

function generateObjectives(
  rng: Rng,
  capturePoints: CapturePoint[],
  bounds: Bounds,
  template: Template,
  seed: number,
): Objective[] {
  const objectives: Objective[] = [];
  const namePool = [...OBJECTIVE_NAME_POOLS[template]];
  rng.shuffle(namePool);

  // Each capture point gets a "control" objective
  for (const cp of capturePoints) {
    const name = namePool.pop() ?? `point_${cp.id}`;
    objectives.push({
      id: name,
      type: 'control',
      position: { ...cp.position },
    });
  }

  // Add 1-2 extra objectives (flanking routes, chokepoints)
  const extraCount = rng.int(1, 2);
  for (let i = 0; i < extraCount; i++) {
    const name = namePool.pop() ?? `area_${i}`;
    const type = rng.pick(OBJECTIVE_TYPES.filter(t => t !== 'control'));
    const x = rng.int(bounds.xMin + 20, bounds.xMax - 20);
    const z = rng.int(bounds.zMin + 20, bounds.zMax - 20);
    const y = estimateHeight(x, z, seed, bounds);
    objectives.push({ id: name, type, position: { x, y, z } });
  }

  return objectives;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

interface ValidationWarning {
  level: 'warn' | 'error';
  message: string;
}

function validateMapdef(mapdef: MapdefOutput): ValidationWarning[] {
  const warnings: ValidationWarning[] = [];

  // Check inter-team spawn separation (each alpha spawn vs each bravo spawn should be 60+ apart)
  const alphaSpawns = mapdef.metadata.spawnPoints.alpha ?? [];
  const bravoSpawns = mapdef.metadata.spawnPoints.bravo ?? [];
  for (let i = 0; i < alphaSpawns.length; i++) {
    for (let j = 0; j < bravoSpawns.length; j++) {
      const dx = alphaSpawns[i].x - bravoSpawns[j].x;
      const dz = alphaSpawns[i].z - bravoSpawns[j].z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist < 60) {
        warnings.push({
          level: 'warn',
          message: `Alpha spawn ${i} and Bravo spawn ${j} are only ${Math.round(dist)} voxels apart (recommended: 60+)`,
        });
      }
    }
  }

  // Check that each team has equal distance to center capture point
  const centerCP = mapdef.metadata.capturePoints.find(cp =>
    cp.position.x === 0 && cp.position.z === 0
  ) ?? mapdef.metadata.capturePoints[Math.floor(mapdef.metadata.capturePoints.length / 2)];

  if (centerCP) {
    const alphaCenter = mapdef.metadata.spawnPoints.alpha?.[2] ?? mapdef.metadata.spawnPoints.alpha?.[0];
    const bravoCenter = mapdef.metadata.spawnPoints.bravo?.[2] ?? mapdef.metadata.spawnPoints.bravo?.[0];
    if (alphaCenter && bravoCenter) {
      const alphaDist = Math.sqrt(
        (alphaCenter.x - centerCP.position.x) ** 2 + (alphaCenter.z - centerCP.position.z) ** 2
      );
      const bravoDist = Math.sqrt(
        (bravoCenter.x - centerCP.position.x) ** 2 + (bravoCenter.z - centerCP.position.z) ** 2
      );
      const imbalance = Math.abs(alphaDist - bravoDist);
      if (imbalance > 20) {
        warnings.push({
          level: 'warn',
          message: `Distance imbalance to center CP: alpha=${Math.round(alphaDist)}, bravo=${Math.round(bravoDist)} (diff=${Math.round(imbalance)})`,
        });
      }
    }
  }

  // Check capture point count
  if (mapdef.metadata.capturePoints.length < 3) {
    warnings.push({ level: 'error', message: `Only ${mapdef.metadata.capturePoints.length} capture points (minimum 3)` });
  }

  // Check spawn counts
  if ((mapdef.metadata.spawnPoints.alpha?.length ?? 0) < 3) {
    warnings.push({ level: 'error', message: 'Alpha team has fewer than 3 spawn points' });
  }
  if ((mapdef.metadata.spawnPoints.bravo?.length ?? 0) < 3) {
    warnings.push({ level: 'error', message: 'Bravo team has fewer than 3 spawn points' });
  }

  return warnings;
}

// ---------------------------------------------------------------------------
// Summary printer
// ---------------------------------------------------------------------------

function printSummary(mapdef: MapdefOutput, args: CliArgs, outputPath: string, warnings: ValidationWarning[]): void {
  console.log('\n=== Map Prompt Generator ===\n');
  console.log(`  Name:      ${mapdef.name}`);
  console.log(`  Template:  ${args.template}`);
  console.log(`  Size:      ${args.size} (${mapdef.bounds.xMax - mapdef.bounds.xMin}x${mapdef.bounds.zMax - mapdef.bounds.zMin})`);
  console.log(`  Teams:     ${args.teams}`);
  console.log(`  Seed:      ${args.seed}`);
  console.log(`  Bounds:    X[${mapdef.bounds.xMin}..${mapdef.bounds.xMax}] Z[${mapdef.bounds.zMin}..${mapdef.bounds.zMax}] Y[${mapdef.bounds.yMin}..${mapdef.bounds.yMax}]`);

  const waterLevel = mapdef.terrain.waterLevel;
  if (waterLevel >= -1) {
    console.log(`  Water:     level ${waterLevel}`);
  } else {
    console.log(`  Water:     none (dry map)`);
  }

  const buildings = mapdef.placements.filter(p => p.terrainCarve).length;
  const nonBuildings = mapdef.placements.filter(p => !p.terrainCarve);
  console.log(`\n  Buildings: ${buildings}`);
  console.log(`  Other:     ${nonBuildings.length} (vehicles, props, vegetation)`);
  console.log(`  Total:     ${mapdef.placements.length} placements`);

  console.log(`\n  Spawns:`);
  for (const [team, points] of Object.entries(mapdef.metadata.spawnPoints)) {
    for (const p of points) {
      console.log(`    ${team}: (${p.x}, ${p.y}, ${p.z})`);
    }
  }

  console.log(`\n  Capture Points: ${mapdef.metadata.capturePoints.length}`);
  for (const cp of mapdef.metadata.capturePoints) {
    const ownerStr = cp.initialOwner === -1 ? 'neutral' : cp.initialOwner === 0 ? 'alpha' : 'bravo';
    console.log(`    ${cp.id}: (${cp.position.x}, ${cp.position.y}, ${cp.position.z}) [${ownerStr}]`);
  }

  console.log(`\n  Objectives: ${mapdef.metadata.objectives.length}`);
  for (const obj of mapdef.metadata.objectives) {
    console.log(`    ${obj.id} (${obj.type}): (${obj.position.x}, ${obj.position.y}, ${obj.position.z})`);
  }

  console.log(`\n  Palette:   ${Object.keys(mapdef.terrainPalette).length} entries`);

  if (warnings.length > 0) {
    console.log('\n  Warnings:');
    for (const w of warnings) {
      const prefix = w.level === 'error' ? 'ERROR' : 'WARN';
      console.log(`    [${prefix}] ${w.message}`);
    }
  } else {
    console.log('\n  Validation: PASSED (no warnings)');
  }

  console.log(`\n  Output:    ${outputPath}`);
  console.log('\n=== Done ===\n');
}

// ---------------------------------------------------------------------------
// Water level config per template
// ---------------------------------------------------------------------------

function getWaterLevel(template: Template, rng: Rng): number {
  switch (template) {
    case 'coastal':
      return 0;
    case 'forest':
      return rng.random() < 0.4 ? -1 : -999;  // 40% chance of streams
    case 'urban':
    case 'desert':
    case 'industrial':
    case 'crossroads':
      return -999;  // no water
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main(): void {
  const args = parseArgs();
  if (!args) {
    process.exit(1);
  }

  const rng = new Rng(args.seed);
  const sizeConfig = SIZE_CONFIGS[args.size];

  // Build bounds
  const bounds: Bounds = {
    xMin: -sizeConfig.halfX,
    xMax: sizeConfig.halfX,
    yMin: sizeConfig.yMin,
    yMax: sizeConfig.yMax,
    zMin: -sizeConfig.halfZ,
    zMax: sizeConfig.halfZ,
  };

  // Terrain
  const waterLevel = getWaterLevel(args.template, rng);
  const palette = templatePalette(args.template);

  // Building placements
  const buildingCount = rng.int(sizeConfig.buildingCount.min, sizeConfig.buildingCount.max);
  const { placements: buildingPlacements, rects: buildingRects } = generateBuildingPlacements(
    rng, args.template, buildingCount, bounds, args.seed,
  );

  // Vehicle placements
  const vehicleCount = rng.int(sizeConfig.vehicleCount.min, sizeConfig.vehicleCount.max);
  const vehiclePlacements = generateVehiclePlacements(rng, vehicleCount, bounds, buildingRects, args.seed, args.template);

  // Prop placements (crossroads and future templates)
  const propPlacements = generatePropPlacements(rng, args.template, bounds, buildingRects);

  // Vegetation placements
  const vegetationPlacements = generateVegetationPlacements(rng, args.template, bounds, buildingRects);

  // All placements
  const allPlacements = [...buildingPlacements, ...vehiclePlacements, ...propPlacements, ...vegetationPlacements];

  // Capture points
  const cpCount = rng.int(sizeConfig.capturePointCount.min, sizeConfig.capturePointCount.max);
  const capturePoints = generateCapturePoints(rng, cpCount, bounds, buildingRects, args.seed, args.teams);

  // Spawn points
  const spawnPoints = generateSpawnPoints(bounds, args.teams, args.seed);

  // Objectives
  const objectives = generateObjectives(rng, capturePoints, bounds, args.template, args.seed);

  // Assemble mapdef
  const mapdef: MapdefOutput = {
    name: args.name,
    bounds,
    terrain: {
      generator: 'heightmap',
      waterLevel: waterLevel > -999 ? waterLevel : 0,
      seed: args.seed,
    },
    terrainPalette: palette,
    placements: allPlacements,
    metadata: {
      spawnPoints,
      capturePoints,
      objectives,
    },
  };

  // For desert template, set negative water level so map-compose uses sand surface textures
  if (args.template === 'desert') {
    mapdef.terrain.waterLevel = -10;
  }
  // Crossroads: no water at all
  if (args.template === 'crossroads') {
    mapdef.terrain.waterLevel = -10;
  }

  // Validate
  const warnings = validateMapdef(mapdef);

  // Write output
  const outputPath = path.resolve(args.output);
  const outputDir = path.dirname(outputPath);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const json = JSON.stringify(mapdef, null, 2);
  fs.writeFileSync(outputPath, json + '\n');

  // Print summary
  printSummary(mapdef, args, outputPath, warnings);
}

main();
