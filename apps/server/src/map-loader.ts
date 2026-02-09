/**
 * map-loader.ts
 *
 * Loads binary voxel map files and provides chunk lookup utilities.
 *
 * Binary format (little-endian):
 *   Header:
 *     magic:       "CLWF" (4 bytes)
 *     version:     u8
 *     chunkCount:  u32
 *     paletteSize: u16 (=256)
 *     palette:     [r, g, b] x 256 (768 bytes)
 *   Per chunk:
 *     cx: i16, cy: i16, cz: i16
 *     voxels: u8[4096]
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { VoxelObjectDef, MapObjectPlacement } from '@clawfield/shared';

const CHUNK_VOXEL_COUNT = 16 * 16 * 16; // 4096
const HEADER_FIXED_SIZE = 4 + 1 + 4 + 2; // magic + version + chunkCount + paletteSize = 11
const DEFAULT_MAP_NAME = 'shoreline';

interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface MapData {
  chunks: Map<string, Uint8Array>;
  /** 256-entry array of hex colors: (r << 16) | (g << 8) | b */
  palette: number[];
}

export interface MapCapturePointMetadata {
  id: string;
  position: Vec3;
  /** -1 = neutral, 0 = Alpha, 1 = Bravo */
  initialOwner: number;
}

export interface MapObjectiveMetadata {
  id: string;
  type: string;
  position: Vec3;
}

export interface MapMetadata {
  name: string;
  spawnPoints: {
    alpha: Vec3[];
    bravo: Vec3[];
  };
  capturePoints: MapCapturePointMetadata[];
  objectives: MapObjectiveMetadata[];
  /** Palette indices that should be treated as water (for physics and rendering) */
  waterIndices?: number[];
  /** Placed voxel objects (multi-resolution props, buildings, vegetation) */
  objects?: MapObjectPlacement[];
}

function isVec3(value: unknown): value is Vec3 {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.x === 'number' &&
    Number.isFinite(v.x) &&
    typeof v.y === 'number' &&
    Number.isFinite(v.y) &&
    typeof v.z === 'number' &&
    Number.isFinite(v.z)
  );
}

/**
 * Parse PRD-style map metadata payload.
 * Supports both snake_case and camelCase keys.
 */
export function parseMapMetadata(value: unknown): MapMetadata | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;

  if (typeof raw.name !== 'string' || raw.name.trim().length === 0) {
    return null;
  }

  const rawSpawnPoints =
    (raw.spawn_points as Record<string, unknown> | undefined) ??
    (raw.spawnPoints as Record<string, unknown> | undefined);
  if (!rawSpawnPoints || typeof rawSpawnPoints !== 'object') {
    return null;
  }

  const rawAlpha = rawSpawnPoints.alpha;
  const rawBravo = rawSpawnPoints.bravo;
  if (!Array.isArray(rawAlpha) || !Array.isArray(rawBravo)) {
    return null;
  }

  if (!rawAlpha.every(isVec3) || !rawBravo.every(isVec3)) {
    return null;
  }

  const rawCapturePoints =
    (raw.capture_points as unknown[] | undefined) ??
    (raw.capturePoints as unknown[] | undefined) ??
    [];

  if (!Array.isArray(rawCapturePoints)) {
    return null;
  }

  const capturePoints: MapCapturePointMetadata[] = [];
  for (const cp of rawCapturePoints) {
    if (!cp || typeof cp !== 'object') return null;
    const entry = cp as Record<string, unknown>;
    if (typeof entry.id !== 'string' || !isVec3(entry.position)) return null;
    if (typeof entry.initialOwner !== 'number' || !Number.isFinite(entry.initialOwner)) {
      return null;
    }
    capturePoints.push({
      id: entry.id,
      position: { ...entry.position },
      initialOwner: Math.trunc(entry.initialOwner),
    });
  }

  const rawObjectives =
    (raw.objectives as unknown[] | undefined) ??
    (raw.map_objectives as unknown[] | undefined) ??
    [];
  if (!Array.isArray(rawObjectives)) {
    return null;
  }

  const objectives: MapObjectiveMetadata[] = [];
  for (const obj of rawObjectives) {
    if (!obj || typeof obj !== 'object') return null;
    const entry = obj as Record<string, unknown>;
    if (typeof entry.id !== 'string' || entry.id.trim().length === 0) return null;
    if (typeof entry.type !== 'string' || entry.type.trim().length === 0) return null;
    if (!isVec3(entry.position)) return null;
    objectives.push({
      id: entry.id,
      type: entry.type,
      position: { ...entry.position },
    });
  }

  // Optional waterIndices: palette indices that should be treated as water
  let waterIndices: number[] | undefined;
  const rawWater = raw.waterIndices ?? raw.water_indices;
  if (Array.isArray(rawWater) && rawWater.every((v: unknown) => typeof v === 'number')) {
    waterIndices = rawWater as number[];
  }

  // Optional objects: placed voxel objects
  let objects: MapObjectPlacement[] | undefined;
  const rawObjects = raw.objects;
  if (Array.isArray(rawObjects)) {
    objects = [];
    for (const obj of rawObjects) {
      if (!obj || typeof obj !== 'object') continue;
      const entry = obj as Record<string, unknown>;
      if (typeof entry.objectId !== 'string') continue;
      if (!isVec3(entry.position)) continue;
      const rotation = typeof entry.rotation === 'number' ? entry.rotation : 0;
      objects.push({
        objectId: entry.objectId,
        position: { ...entry.position },
        rotation,
      });
    }
    if (objects.length === 0) objects = undefined;
  }

  return {
    name: raw.name,
    spawnPoints: {
      alpha: rawAlpha.map((sp) => ({ ...sp })),
      bravo: rawBravo.map((sp) => ({ ...sp })),
    },
    capturePoints,
    objectives,
    waterIndices,
    objects,
  };
}

/**
 * Load the binary .map file from disk.
 * Returns the full chunk map and palette.
 * Returns null if the file does not exist.
 */
export function loadBinaryMap(mapPath: string): MapData | null {
  if (!fs.existsSync(mapPath)) {
    return null;
  }

  console.log(`Loading binary map from ${mapPath}...`);
  const startTime = performance.now();

  const fileBuffer = fs.readFileSync(mapPath);
  const view = new DataView(fileBuffer.buffer, fileBuffer.byteOffset, fileBuffer.byteLength);
  let offset = 0;

  // --- Header ---

  // Magic: "CLWF" (4 bytes)
  const magic = fileBuffer.subarray(0, 4).toString('ascii');
  if (magic !== 'CLWF') {
    throw new Error(`Invalid map file: expected magic "CLWF", got "${magic}"`);
  }
  offset += 4;

  // Version: u8
  const version = view.getUint8(offset);
  offset += 1;
  if (version !== 1) {
    throw new Error(`Unsupported map version: ${version}`);
  }

  // Chunk count: u32 LE
  const chunkCount = view.getUint32(offset, true);
  offset += 4;

  // Palette size: u16 LE
  const paletteSize = view.getUint16(offset, true);
  offset += 2;

  // Palette: [r, g, b] x paletteSize
  const palette: number[] = new Array(paletteSize);
  for (let i = 0; i < paletteSize; i++) {
    const r = view.getUint8(offset);
    const g = view.getUint8(offset + 1);
    const b = view.getUint8(offset + 2);
    palette[i] = (r << 16) | (g << 8) | b;
    offset += 3;
  }

  // --- Chunks ---
  const chunks = new Map<string, Uint8Array>();

  for (let ci = 0; ci < chunkCount; ci++) {
    const cx = view.getInt16(offset, true);
    offset += 2;
    const cy = view.getInt16(offset, true);
    offset += 2;
    const cz = view.getInt16(offset, true);
    offset += 2;

    // Copy voxel data into a new Uint8Array
    const voxels = new Uint8Array(CHUNK_VOXEL_COUNT);
    voxels.set(fileBuffer.subarray(offset, offset + CHUNK_VOXEL_COUNT));
    offset += CHUNK_VOXEL_COUNT;

    const key = `${cx},${cy},${cz}`;
    chunks.set(key, voxels);
  }

  const elapsed = ((performance.now() - startTime) / 1000).toFixed(2);
  console.log(`  Map loaded: ${chunks.size} chunks, ${paletteSize} palette colors in ${elapsed}s`);

  return { chunks, palette };
}

/**
 * Resolve the configured map name from the environment.
 * Defaults to "shoreline".
 */
export function getConfiguredMapName(): string {
  const raw = process.env.CLAWFIELD_MAP?.trim().toLowerCase();
  return raw && raw.length > 0 ? raw : DEFAULT_MAP_NAME;
}

/**
 * Get the default map file path for a map id.
 * Resolves relative to the project root: assets/maps/<mapName>.map
 */
export function getDefaultMapPath(mapName = getConfiguredMapName()): string {
  // Resolve from the server source to project root: apps/server/src -> ../../..
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  return path.resolve(__dirname, '..', '..', '..', 'assets', 'maps', `${mapName}.map`);
}

/**
 * Get the default map metadata path for a map id.
 * Resolves relative to the project root: assets/maps/<mapName>.meta.json
 */
export function getDefaultMapMetaPath(mapName = getConfiguredMapName()): string {
  // Resolve from the server source to project root: apps/server/src -> ../../..
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  return path.resolve(__dirname, '..', '..', '..', 'assets', 'maps', `${mapName}.meta.json`);
}

/**
 * Load map metadata from disk.
 * Returns null if the file is missing or invalid.
 */
export function loadMapMetadata(metaPath: string): MapMetadata | null {
  if (!fs.existsSync(metaPath)) {
    return null;
  }

  try {
    const rawText = fs.readFileSync(metaPath, 'utf-8');
    const parsed = JSON.parse(rawText);
    return parseMapMetadata(parsed);
  } catch (err) {
    console.warn(`Failed to parse map metadata at ${metaPath}: ${String(err)}`);
    return null;
  }
}

/**
 * Get all chunk keys within `radius` chunks of a center position (in chunk coordinates).
 * Uses a cubic region (not spherical) for simplicity and speed.
 */
export function getChunksInRadius(
  centerCx: number,
  centerCy: number,
  centerCz: number,
  radius: number
): string[] {
  const keys: string[] = [];
  for (let dx = -radius; dx <= radius; dx++) {
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dz = -radius; dz <= radius; dz++) {
        keys.push(`${centerCx + dx},${centerCy + dy},${centerCz + dz}`);
      }
    }
  }
  return keys;
}

// ---------------------------------------------------------------------------
// Voxel object loading & collision stamping
// ---------------------------------------------------------------------------

/**
 * Resolve the path to the objects directory for a map.
 * Resolves relative to project root: assets/objects/
 */
export function getObjectsBasePath(): string {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  return path.resolve(__dirname, '..', '..', '..', 'assets', 'objects');
}

/**
 * Load object definitions referenced by placements.
 * Returns a map of objectId → VoxelObjectDef.
 */
export function loadObjectDefs(
  placements: MapObjectPlacement[],
  objectsBasePath?: string
): Map<string, VoxelObjectDef> {
  const basePath = objectsBasePath ?? getObjectsBasePath();
  const defs = new Map<string, VoxelObjectDef>();

  // Load registry
  const registryPath = path.join(basePath, 'registry.json');
  if (!fs.existsSync(registryPath)) {
    console.warn(`[VoxelObjects] No registry found at ${registryPath}`);
    return defs;
  }

  let registry: { version: number; objects: { id: string; path: string }[] };
  try {
    registry = JSON.parse(fs.readFileSync(registryPath, 'utf-8'));
  } catch (err) {
    console.warn(`[VoxelObjects] Failed to parse registry: ${String(err)}`);
    return defs;
  }

  // Build lookup: id → relative path
  const pathMap = new Map<string, string>();
  for (const entry of registry.objects) {
    pathMap.set(entry.id, entry.path);
  }

  // Identify unique object IDs needed
  const neededIds = new Set<string>();
  for (const p of placements) {
    neededIds.add(p.objectId);
  }

  // Load each needed definition
  for (const objectId of neededIds) {
    const relPath = pathMap.get(objectId);
    if (!relPath) {
      console.warn(`[VoxelObjects] Object "${objectId}" not found in registry`);
      continue;
    }

    const defPath = path.join(basePath, relPath);
    if (!fs.existsSync(defPath)) {
      console.warn(`[VoxelObjects] Object file missing: ${defPath}`);
      continue;
    }

    try {
      const def = JSON.parse(fs.readFileSync(defPath, 'utf-8')) as VoxelObjectDef;
      defs.set(objectId, def);
    } catch (err) {
      console.warn(`[VoxelObjects] Failed to load "${objectId}": ${String(err)}`);
    }
  }

  return defs;
}

/**
 * Stamp voxel objects into the chunk map for collision detection.
 *
 * For each object's non-air voxel, computes the world coordinate (accounting
 * for placement position, origin offset, and Y-axis rotation) and writes a
 * solid material (MAT_STONE = 3) into the chunk map.
 *
 * This means existing physics code (getVoxel, movePlayer, raycasting) works
 * unchanged — objects simply appear as solid voxels in the chunk grid.
 */
export function stampObjectsIntoChunks(
  chunks: Map<string, Uint8Array>,
  defs: Map<string, VoxelObjectDef>,
  placements: MapObjectPlacement[]
): number {
  const MAT_SOLID = 3; // MAT_STONE — any non-zero, non-water value works
  const CHUNK_SIZE = 16;
  let stampedCount = 0;

  for (const placement of placements) {
    const def = defs.get(placement.objectId);
    if (!def) continue;

    const { sizeX, sizeY, sizeZ, voxelSize, origin, voxels } = def;
    const rot = ((placement.rotation % 360) + 360) % 360;

    for (let z = 0; z < sizeZ; z++) {
      for (let y = 0; y < sizeY; y++) {
        for (let x = 0; x < sizeX; x++) {
          const vi = x + y * sizeX + z * sizeX * sizeY;
          const mat = voxels[vi];
          if (mat === 0) continue;

          // Compute world position from object-local voxel coordinate
          let dx = (x - origin.x) * voxelSize;
          const dy = (y - origin.y) * voxelSize;
          let dz = (z - origin.z) * voxelSize;

          // Apply Y-axis rotation
          if (rot === 90) {
            [dx, dz] = [-dz, dx];
          } else if (rot === 180) {
            dx = -dx;
            dz = -dz;
          } else if (rot === 270) {
            [dx, dz] = [dz, -dx];
          }

          const wx = Math.floor(placement.position.x + dx);
          const wy = Math.floor(placement.position.y + dy);
          const wz = Math.floor(placement.position.z + dz);

          // Write to chunk
          const cx = Math.floor(wx / CHUNK_SIZE);
          const cy = Math.floor(wy / CHUNK_SIZE);
          const cz = Math.floor(wz / CHUNK_SIZE);
          const chunkKey = `${cx},${cy},${cz}`;

          const lx = ((wx % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
          const ly = ((wy % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
          const lz = ((wz % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;

          let chunk = chunks.get(chunkKey);
          if (!chunk) {
            chunk = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE * CHUNK_SIZE);
            chunks.set(chunkKey, chunk);
          }

          const idx = lx + ly * CHUNK_SIZE + lz * CHUNK_SIZE * CHUNK_SIZE;
          if (chunk[idx] === 0) {
            chunk[idx] = MAT_SOLID;
            stampedCount++;
          }
        }
      }
    }
  }

  return stampedCount;
}
