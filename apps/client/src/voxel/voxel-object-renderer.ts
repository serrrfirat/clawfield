/**
 * voxel-object-renderer.ts
 *
 * Loads, meshes, and places multi-resolution voxel objects in the scene.
 * Each object carries its own voxel grid, palette, and resolution, rendered
 * as a standalone mesh using the same atlas-patched material as terrain chunks.
 *
 * The greedy mesher is reused directly — objects just pass their own grid
 * dimensions, voxel size (as scale), and palette override.
 */

import * as THREE from 'three';
import type { VoxelObjectDef, MapObjectPlacement, ObjectRegistry } from '@clawfield/shared';
import { greedyMesh, quadsToGeometryData } from './mesher';
import { chunkMaterial } from './world-renderer';

/** Internal state for a placed object instance */
interface PlacedObject {
  def: VoxelObjectDef;
  placement: MapObjectPlacement;
  mesh: THREE.Mesh;
}

/**
 * Mesh a VoxelObjectDef into a THREE.BufferGeometry.
 *
 * Approach:
 * 1. Pad the voxel grid to a cube (greedy mesher requires cubic grids)
 * 2. Run greedyMesh with the object's voxelSize as scale
 * 3. Convert quads to geometry using the object's palette for vertex colors
 */
function meshObjectDef(def: VoxelObjectDef): THREE.BufferGeometry | null {
  const { sizeX, sizeY, sizeZ, voxelSize, voxels } = def;
  const gridSize = Math.max(sizeX, sizeY, sizeZ);

  if (gridSize === 0) return null;

  // Pad voxels into a cubic array
  const padded = new Uint8Array(gridSize * gridSize * gridSize);

  for (let z = 0; z < sizeZ; z++) {
    for (let y = 0; y < sizeY; y++) {
      for (let x = 0; x < sizeX; x++) {
        const srcIdx = x + y * sizeX + z * sizeX * sizeY;
        const dstIdx = x + y * gridSize + z * gridSize * gridSize;
        padded[dstIdx] = voxels[srcIdx];
      }
    }
  }

  // Run greedy mesher with object's voxel size as scale
  // skipWaterFilter=true: object palette indices are unrelated to terrain water IDs
  const quads = greedyMesh(padded, false, gridSize, voxelSize, true);
  if (quads.length === 0) return null;

  // Convert to geometry with the object's own palette for vertex colors
  const { positions, normals, colors, uvs, indices } = quadsToGeometryData(quads, def.palette);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.computeBoundingSphere();

  return geometry;
}

/**
 * Manages multi-resolution voxel objects in the Three.js scene.
 */
export class VoxelObjectRenderer {
  private scene: THREE.Scene;
  private placed: PlacedObject[] = [];
  /** Cache geometry per objectId to avoid re-meshing duplicates */
  private geometryCache = new Map<string, THREE.BufferGeometry | null>();

  constructor(scene: THREE.Scene) {
    this.scene = scene;
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
    const defs = new Map<string, VoxelObjectDef>();
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
            defs.set(objectId, def);
          })
          .catch(err => {
            console.warn(`[VoxelObjectRenderer] Failed to load "${objectId}" from ${url}:`, err);
          })
      );
    }

    await Promise.all(fetchPromises);

    // 4. Mesh and place each object
    for (const placement of placements) {
      const def = defs.get(placement.objectId);
      if (!def) continue;

      // Get or create cached geometry
      let geometry = this.geometryCache.get(placement.objectId);
      if (geometry === undefined) {
        geometry = meshObjectDef(def);
        this.geometryCache.set(placement.objectId, geometry);
      }
      if (!geometry) continue;

      // Create mesh (share geometry across instances of the same object)
      const mesh = new THREE.Mesh(geometry, chunkMaterial);

      // Position: place the origin point at the placement position
      const ox = def.origin.x * def.voxelSize;
      const oy = def.origin.y * def.voxelSize;
      const oz = def.origin.z * def.voxelSize;
      mesh.position.set(
        placement.position.x - ox,
        placement.position.y - oy,
        placement.position.z - oz,
      );

      // Y-axis rotation
      mesh.rotation.y = (placement.rotation * Math.PI) / 180;

      // Shadows
      mesh.castShadow = true;
      mesh.receiveShadow = true;

      this.scene.add(mesh);
      this.placed.push({ def, placement, mesh });
    }

    console.log(
      `[VoxelObjectRenderer] Placed ${this.placed.length} objects (${defs.size} unique types)`
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
    for (const placement of placements) {
      const def = defs.get(placement.objectId);
      if (!def) continue;

      let geometry = this.geometryCache.get(placement.objectId);
      if (geometry === undefined) {
        geometry = meshObjectDef(def);
        this.geometryCache.set(placement.objectId, geometry);
      }
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
      this.placed.push({ def, placement, mesh });
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
  }
}
