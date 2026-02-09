import type { Placement } from './placement-system';
import type { SpawnPoint, CapturePoint } from './metadata-editor';
import type { MapdefBounds, TerrainPaletteEntry } from './terrain-generator';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MapdefFile {
  name: string;
  bounds: MapdefBounds;
  terrain: { generator: string; waterLevel: number; seed?: number };
  terrainPalette: Record<string, TerrainPaletteEntry>;
  placements: Placement[];
  metadata: {
    spawnPoints?: Record<string, { x: number; y: number; z: number }[]>;
    capturePoints?: { id: string; position: { x: number; y: number; z: number }; initialOwner: number }[];
  };
}

// Default terrain palette — indices match standard MAT_* constants
const DEFAULT_PALETTE: Record<string, TerrainPaletteEntry> = {
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

// ---------------------------------------------------------------------------
// Save / Load
// ---------------------------------------------------------------------------

export function createNewMapdef(): MapdefFile {
  return {
    name: 'Untitled',
    bounds: { xMin: -130, xMax: 130, yMin: -4, yMax: 32, zMin: -110, zMax: 110 },
    terrain: { generator: 'heightmap', waterLevel: 0, seed: 0 },
    terrainPalette: { ...DEFAULT_PALETTE },
    placements: [],
    metadata: {
      spawnPoints: { alpha: [], bravo: [] },
      capturePoints: [],
    },
  };
}

export function serializeMapdef(
  name: string,
  bounds: MapdefBounds,
  terrainPalette: Record<string, TerrainPaletteEntry>,
  waterLevel: number,
  seed: number,
  placements: Placement[],
  spawns: SpawnPoint[],
  captures: CapturePoint[],
): MapdefFile {
  const spawnPoints: Record<string, { x: number; y: number; z: number }[]> = {
    alpha: [],
    bravo: [],
  };

  for (const s of spawns) {
    spawnPoints[s.team].push({ ...s.position });
  }

  return {
    name,
    bounds,
    terrain: { generator: 'heightmap', waterLevel, seed },
    terrainPalette,
    placements: placements.map((p) => ({
      componentId: p.componentId,
      position: { ...p.position },
      rotation: p.rotation,
      terrainCarve: p.terrainCarve,
    })),
    metadata: {
      spawnPoints,
      capturePoints: captures.map((c) => ({
        id: c.id,
        position: { ...c.position },
        initialOwner: c.initialOwner,
      })),
    },
  };
}

export function downloadMapdef(mapdef: MapdefFile): void {
  const json = JSON.stringify(mapdef, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = `${mapdef.name.toLowerCase().replace(/\s+/g, '-')}.mapdef.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function openMapdefPicker(): Promise<MapdefFile | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,.mapdef.json';

    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (!file) { resolve(null); return; }

      try {
        const text = await file.text();
        const mapdef = JSON.parse(text) as MapdefFile;
        resolve(mapdef);
      } catch {
        alert('Failed to parse mapdef file');
        resolve(null);
      }
    });

    input.click();
  });
}

export function parseSpawnsFromMapdef(mapdef: MapdefFile): SpawnPoint[] {
  const spawns: SpawnPoint[] = [];
  if (mapdef.metadata.spawnPoints) {
    for (const [team, points] of Object.entries(mapdef.metadata.spawnPoints)) {
      for (const p of points) {
        spawns.push({ team: team as 'alpha' | 'bravo', position: { ...p } });
      }
    }
  }
  return spawns;
}

export function parseCapturesFromMapdef(mapdef: MapdefFile): CapturePoint[] {
  if (!mapdef.metadata.capturePoints) return [];
  return mapdef.metadata.capturePoints.map((c) => ({
    id: c.id,
    position: { ...c.position },
    initialOwner: c.initialOwner,
  }));
}

export function getDefaultPalette(): Record<string, TerrainPaletteEntry> {
  return { ...DEFAULT_PALETTE };
}
