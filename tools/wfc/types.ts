/**
 * WFC (Wave Function Collapse) type definitions for procedural map generation.
 */

/** Socket types for tile edge compatibility */
export type SocketType = 'G' | 'R' | 'W' | 'RG' | 'WG';

/** Sockets on all four horizontal edges of a tile */
export interface Sockets {
  n: SocketType;
  e: SocketType;
  s: SocketType;
  w: SocketType;
}

/** A vertically-stacked layer placed above the base tile */
export interface StackLayer {
  file: string;       // .vox file relative to tileset dir
  level: number;      // chunk Y offset (1 = cy+1, 2 = cy+2)
}

/** Tile specification from tileset.json */
export interface TileSpec {
  name: string;
  file: string;
  sockets: Sockets;
  weight: number;
  rotatable: boolean;
  tags: string[];
  stack?: StackLayer[];
}

/** A tile variant (original or rotated) ready for the solver */
export interface TileVariant {
  spec: TileSpec;
  rotation: number; // 0, 1, 2, or 3 (× 90° CW)
  sockets: Sockets;
  voxels: Uint8Array; // 4096 bytes (16³)
  stackLayers?: { level: number; voxels: Uint8Array; paletteName: string }[];
}

/** A cell in the WFC grid */
export interface GridCell {
  x: number;
  z: number;
  possible: Set<number>; // indices into TileVariant[]
  collapsed: number | null; // index of chosen variant, or null
}

/** RGB color */
export interface RGB {
  r: number;
  g: number;
  b: number;
}

/** Parsed voxel from .vox file */
export interface VoxVoxel {
  x: number;
  y: number;
  z: number;
  colorIndex: number;
}

/** Spawn point for a team */
export interface SpawnPoint {
  x: number;
  y: number;
  z: number;
}

/** Capture zone for Incursion mode */
export interface CaptureZone {
  id: string;
  x: number;
  y: number;
  z: number;
  radius: number;
}

/** Gameplay metadata output */
export interface GameplayMeta {
  spawns: { team1: SpawnPoint[]; team2: SpawnPoint[] };
  captureZones: CaptureZone[];
  mapWidth: number;
  mapDepth: number;
  tileSize: number;
}
