/**
 * voxel-object-renderer.ts
 *
 * Loads, meshes, and places multi-resolution voxel objects in the scene.
 * Each object carries its own voxel grid, palette, and resolution, rendered
 * as a standalone mesh using the same atlas-patched material as terrain chunks.
 *
 * Supports distance-based LOD: objects close to the camera render at full
 * detail, while distant objects are downsampled to reduce draw cost.
 */

import * as THREE from 'three';
import type { VoxelObjectDef, MapObjectPlacement, ObjectRegistry } from '@clawfield/shared';
import { OBJECT_LOD_DISTANCE_SQ } from '@clawfield/shared';
import { greedyMesh, quadsToGeometryData } from './mesher';
import { chunkMaterial } from './world-renderer';

/** Internal state for a placed object instance */
interface PlacedObject {
  def: VoxelObjectDef;
  placement: MapObjectPlacement;
  mesh: THREE.Mesh;
  /** World-space center for distance calculations */
  worldCenter: THREE.Vector3;
  /** Current LOD level (0 = full, 1 = half, 2 = quarter) */
  lodLevel: number;
}

/**
 * Downsample a non-cubic voxel grid by the given factor using most-common-material voting.
 * Returns { data, sizeX, sizeY, sizeZ } for the downsampled grid.
 */
function downsampleObjectGrid(
  voxels: number[] | Uint8Array,
  sizeX: number,
  sizeY: number,
  sizeZ: number,
  factor: number,
): { data: Uint8Array; sizeX: number; sizeY: number; sizeZ: number } {
  if (factor <= 1) {
    const data = voxels instanceof Uint8Array ? voxels : new Uint8Array(voxels);
    return { data, sizeX, sizeY, sizeZ };
  }

  const outX = Math.max(1, Math.ceil(sizeX / factor));
  const outY = Math.max(1, Math.ceil(sizeY / factor));
  const outZ = Math.max(1, Math.ceil(sizeZ / factor));
  const out = new Uint8Array(outX * outY * outZ);
  const votes = new Uint16Array(256);

  for (let oz = 0; oz < outZ; oz++) {
    for (let oy = 0; oy < outY; oy++) {
      for (let ox = 0; ox < outX; ox++) {
        votes.fill(0);
        const bx = ox * factor;
        const by = oy * factor;
        const bz = oz * factor;

        for (let dz = 0; dz < factor && bz + dz < sizeZ; dz++) {
          for (let dy = 0; dy < factor && by + dy < sizeY; dy++) {
            for (let dx = 0; dx < factor && bx + dx < sizeX; dx++) {
              const ix = bx + dx;
              const iy = by + dy;
              const iz = bz + dz;
              const mat = voxels[ix + iy * sizeX + iz * sizeX * sizeY];
              if (mat !== 0) votes[mat]++;
            }
          }
        }

        let bestMat = 0;
        let bestCount = 0;
        for (let m = 1; m < 256; m++) {
          if (votes[m] > bestCount) {
            bestCount = votes[m];
            bestMat = m;
          }
        }
        out[ox + oy * outX + oz * outX * outY] = bestMat;
      }
    }
  }

  return { data: out, sizeX: outX, sizeY: outY, sizeZ: outZ };
}

/** LOD factors matching terrain: full, half, quarter */
const OBJECT_LOD_FACTORS = [1, 2, 4];

/**
 * Determine object LOD level from squared world-space distance.
 */
function getObjectLodLevel(distSq: number): number {
  if (distSq <= OBJECT_LOD_DISTANCE_SQ[0]) return 0;
  if (distSq <= OBJECT_LOD_DISTANCE_SQ[1]) return 1;
  return 2;
}

/**
 * Mesh a VoxelObjectDef into a THREE.BufferGeometry at a given LOD level.
 *
 * Approach:
 * 1. Downsample the voxel grid by the LOD factor
 * 2. Pad the voxel grid to a cube (greedy mesher requires cubic grids)
 * 3. Run greedyMesh with the appropriate scale
 * 4. Convert quads to geometry using the object's palette for vertex colors
 */
function meshObjectDefLod(def: VoxelObjectDef, lodLevel: number): THREE.BufferGeometry | null {
  const factor = OBJECT_LOD_FACTORS[lodLevel] ?? 1;
  const scaledVoxelSize = def.voxelSize * factor;

  // Downsample if needed
  const { data, sizeX, sizeY, sizeZ } = downsampleObjectGrid(
    def.voxels, def.sizeX, def.sizeY, def.sizeZ, factor,
  );

  const gridSize = Math.max(sizeX, sizeY, sizeZ);
  if (gridSize === 0) return null;

  // Pad voxels into a cubic array
  const padded = new Uint8Array(gridSize * gridSize * gridSize);
  for (let z = 0; z < sizeZ; z++) {
    for (let y = 0; y < sizeY; y++) {
      for (let x = 0; x < sizeX; x++) {
        const srcIdx = x + y * sizeX + z * sizeX * sizeY;
        const dstIdx = x + y * gridSize + z * gridSize * gridSize;
        padded[dstIdx] = data[srcIdx];
      }
    }
  }

  // Run greedy mesher with scaled voxel size
  const quads = greedyMesh(padded, false, gridSize, scaledVoxelSize, true);
  if (quads.length === 0) return null;

  const { positions, normals, colors, uvs, ao, materialIds, indices } = quadsToGeometryData(quads, def.palette);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geometry.setAttribute('ao', new THREE.BufferAttribute(ao, 1));
  geometry.setAttribute('materialId', new THREE.BufferAttribute(materialIds, 1));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.computeBoundingSphere();

  return geometry;
}

/**
 * Manages multi-resolution voxel objects in the Three.js scene.
 * Supports distance-based LOD for all placed objects.
 */
export class VoxelObjectRenderer {
  private scene: THREE.Scene;
  private placed: PlacedObject[] = [];
  /** Cache geometry per objectId:lodLevel to avoid re-meshing duplicates */
  private geometryCache = new Map<string, THREE.BufferGeometry | null>();
  /** Store defs for LOD rebuilds */
  private defs = new Map<string, VoxelObjectDef>();

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  /** Build a cache key for geometry: objectId @ lodLevel */
  private geomKey(objectId: string, lodLevel: number): string {
    return `${objectId}:${lodLevel}`;
  }

  /** Get or create geometry for an object at a given LOD level */
  private getGeometry(objectId: string, lodLevel: number): THREE.BufferGeometry | null {
    const key = this.geomKey(objectId, lodLevel);
    let geometry = this.geometryCache.get(key);
    if (geometry !== undefined) return geometry;

    const def = this.defs.get(objectId);
    if (!def) return null;

    geometry = meshObjectDefLod(def, lodLevel);
    this.geometryCache.set(key, geometry);
    return geometry;
  }

  /** Compute world center of a placed object for distance calculations */
  private computeWorldCenter(def: VoxelObjectDef, placement: MapObjectPlacement): THREE.Vector3 {
    const halfX = (def.sizeX * def.voxelSize) / 2;
    const halfY = (def.sizeY * def.voxelSize) / 2;
    const halfZ = (def.sizeZ * def.voxelSize) / 2;
    return new THREE.Vector3(
      placement.position.x - def.origin.x * def.voxelSize + halfX,
      placement.position.y - def.origin.y * def.voxelSize + halfY,
      placement.position.z - def.origin.z * def.voxelSize + halfZ,
    );
  }

  /**
   * Load object definitions and place them in the scene.
   *
   * @param placements - Object placements from the map metadata
   * @param baseUrl - Base URL for fetching object assets (e.g. "/assets/objects/")
   */
  async loadAndPlace(placements: MapObjectPlacement[], baseUrl: string = '/assets/objects/'): Promise<void> {
    if (placements.length === 0) return;

    // 1. Fetch the registry to resolve objectId → file path
    const registryUrl = `${baseUrl}registry.json`;
    let registry: ObjectRegistry;
    try {
      const res = await fetch(registryUrl);
      if (!res.ok) {
        console.warn(`[VoxelObjectRenderer] Failed to fetch registry: ${res.status}`);
        return;
      }
      registry = await res.json() as ObjectRegistry;
    } catch (err) {
      console.warn(`[VoxelObjectRenderer] Failed to load registry:`, err);
      return;
    }

    // Build lookup: objectId → file path
    const pathMap = new Map<string, string>();
    for (const entry of registry.objects) {
      pathMap.set(entry.id, entry.path);
    }

    // 2. Identify unique object IDs needed
    const neededIds = new Set<string>();
    for (const p of placements) {
      neededIds.add(p.objectId);
    }

    // 3. Fetch each unique object definition
    const fetchPromises: Promise<void>[] = [];

    for (const objectId of neededIds) {
      const relPath = pathMap.get(objectId);
      if (!relPath) {
        console.warn(`[VoxelObjectRenderer] Object "${objectId}" not found in registry`);
        continue;
      }

      const url = `${baseUrl}${relPath}`;
      fetchPromises.push(
        fetch(url)
          .then(res => {
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return res.json();
          })
          .then((def: VoxelObjectDef) => {
            this.defs.set(objectId, def);
          })
          .catch(err => {
            console.warn(`[VoxelObjectRenderer] Failed to load "${objectId}" from ${url}:`, err);
          })
      );
    }

    await Promise.all(fetchPromises);

    // 4. Mesh and place each object (start at LOD 0)
    for (const placement of placements) {
      const def = this.defs.get(placement.objectId);
      if (!def) continue;

      const geometry = this.getGeometry(placement.objectId, 0);
      if (!geometry) continue;

      const mesh = new THREE.Mesh(geometry, chunkMaterial);

      const ox = def.origin.x * def.voxelSize;
      const oy = def.origin.y * def.voxelSize;
      const oz = def.origin.z * def.voxelSize;
      mesh.position.set(
        placement.position.x - ox,
        placement.position.y - oy,
        placement.position.z - oz,
      );

      mesh.rotation.y = (placement.rotation * Math.PI) / 180;
      mesh.castShadow = true;
      mesh.receiveShadow = true;

      this.scene.add(mesh);

      const worldCenter = this.computeWorldCenter(def, placement);
      this.placed.push({ def, placement, mesh, worldCenter, lodLevel: 0 });
    }

    console.log(
      `[VoxelObjectRenderer] Placed ${this.placed.length} objects (${this.defs.size} unique types)`
    );
  }

  /**
   * Load and place objects from inline definitions (no registry fetch needed).
   * Used when object defs are bundled or pre-loaded.
   */
  placeFromDefs(
    defs: Map<string, VoxelObjectDef>,
    placements: MapObjectPlacement[]
  ): void {
    // Store defs for LOD rebuilds
    for (const [id, def] of defs) {
      this.defs.set(id, def);
    }

    for (const placement of placements) {
      const def = defs.get(placement.objectId);
      if (!def) continue;

      const geometry = this.getGeometry(placement.objectId, 0);
      if (!geometry) continue;

      const mesh = new THREE.Mesh(geometry, chunkMaterial);

      const ox = def.origin.x * def.voxelSize;
      const oy = def.origin.y * def.voxelSize;
      const oz = def.origin.z * def.voxelSize;
      mesh.position.set(
        placement.position.x - ox,
        placement.position.y - oy,
        placement.position.z - oz,
      );
      mesh.rotation.y = (placement.rotation * Math.PI) / 180;
      mesh.castShadow = true;
      mesh.receiveShadow = true;

      this.scene.add(mesh);

      const worldCenter = this.computeWorldCenter(def, placement);
      this.placed.push({ def, placement, mesh, worldCenter, lodLevel: 0 });
    }
  }

  /**
   * Update LOD levels for all placed objects based on camera distance.
   * Swaps geometry when the LOD level changes. Call periodically from the game loop.
   *
   * @param cameraPos - Current camera world position
   * @param maxRebuilds - Max geometry swaps per call to avoid frame stalls (default 6)
   */
  updateLod(cameraPos: { x: number; y: number; z: number }, maxRebuilds: number = 6): void {
    let rebuilds = 0;

    for (const obj of this.placed) {
      if (rebuilds >= maxRebuilds) break;

      const dx = obj.worldCenter.x - cameraPos.x;
      const dy = obj.worldCenter.y - cameraPos.y;
      const dz = obj.worldCenter.z - cameraPos.z;
      const distSq = dx * dx + dy * dy + dz * dz;

      const desiredLod = getObjectLodLevel(distSq);
      if (desiredLod === obj.lodLevel) continue;

      const newGeometry = this.getGeometry(obj.placement.objectId, desiredLod);
      if (!newGeometry && desiredLod > 0) continue; // keep current if downsample produced nothing

      if (newGeometry) {
        obj.mesh.geometry = newGeometry;
      }

      // Only cast shadows at LOD 0 (full detail)
      obj.mesh.castShadow = desiredLod === 0;

      obj.lodLevel = desiredLod;
      rebuilds++;
    }
  }

  /** Remove all placed objects from the scene and free resources */
  dispose(): void {
    for (const obj of this.placed) {
      this.scene.remove(obj.mesh);
    }
    for (const geom of this.geometryCache.values()) {
      geom?.dispose();
    }
    this.placed = [];
    this.geometryCache.clear();
    this.defs.clear();
  }
}
