/**
 * types.ts — Shared interfaces for the geo-tiles pipeline.
 */

/** RGB color triplet */
export interface RGB {
  r: number;
  g: number;
  b: number;
}

/** Reference to a downloaded tile GLB */
export interface TileRef {
  /** Local file path to the cached .glb */
  glbPath: string;
  /** 4×4 column-major transform from tile → root (ECEF) */
  transform: number[];
  /** Geometric error from tileset.json (lower = more detail) */
  geometricError: number;
  /** Bounding volume center in tile's local coordinate space (RTC offset for GLB positions) */
  bvCenter?: [number, number, number];
}

/** Merged scene geometry ready for voxelization */
export interface MergedScene {
  /** Interleaved float32 positions [x,y,z, ...] in local ENU meters */
  positions: Float32Array;
  /** Triangle indices */
  indices: Uint32Array;
  /** UV coordinates [u,v, ...] per vertex */
  uvs: Float32Array | null;
  /** Per-vertex RGB colors [r,g,b, ...] 0-255 (fallback if no textures) */
  vertexColors: Uint8Array | null;
  /** Per-triangle material group index → texture */
  materialGroups: MaterialGroup[];
}

/** A group of triangles sharing a texture */
export interface MaterialGroup {
  /** Start triangle index */
  startTriangle: number;
  /** Number of triangles */
  triangleCount: number;
  /** Decoded RGBA texture buffer */
  texture: {
    data: Uint8Array;
    width: number;
    height: number;
  } | null;
}

/** 3D voxel grid with color information */
export interface VoxelGrid {
  /** Sparse chunk storage: key = "cx,cy,cz", value = Uint8Array(4096) */
  chunks: Map<string, Uint8Array>;
  /** Per-voxel RGB color: key = "wx,wy,wz", value = RGB */
  colorMap: Map<string, RGB>;
  /** Bounding box in world voxel coordinates */
  bounds: {
    xMin: number; xMax: number;
    yMin: number; yMax: number;
    zMin: number; zMax: number;
  };
}

/** Classified voxel grid with material IDs */
export interface ClassifiedGrid {
  /** Sparse chunk storage with material IDs */
  chunks: Map<string, Uint8Array>;
  /** Palette: 256 RGB entries */
  palette: RGB[];
  /** Bounds */
  bounds: VoxelGrid['bounds'];
}

/** A detected building volume */
export interface BuildingVolume {
  /** Bounding box in world coordinates */
  xMin: number; xMax: number;
  yMin: number; yMax: number;
  zMin: number; zMax: number;
  /** Number of floors */
  floorCount: number;
}

/** Map metadata for spawn/capture points */
export interface MapMeta {
  name: string;
  description: string;
  spawnPoints: {
    alpha: Vec3[];
    bravo: Vec3[];
  };
  capturePoints: {
    id: string;
    position: Vec3;
    initialOwner: number;
  }[];
  objectives: {
    id: string;
    type: string;
    position: Vec3;
  }[];
  waterIndices: number[];
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** CLI options parsed from command line */
export interface CLIOptions {
  lat: number;
  lon: number;
  radius: number;
  apiKey: string;
  output: string;
  name: string;
  voxelSize: number;
  maxGeometricError: number;
  skipInteriors: boolean;
  skipMeta: boolean;
  dryRun: boolean;
  verbose: boolean;
  cacheOnly: boolean;
  rawPalette: boolean;
}
