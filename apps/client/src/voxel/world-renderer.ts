import * as THREE from 'three';
import { CHUNK_SIZE, chunkKeyToPosition } from '@clawfield/shared';
import { buildChunkGeometry } from './chunk-mesh';
import { getLodLevel } from './lod';

const chunkMaterial = new THREE.MeshStandardMaterial({
  vertexColors: true,
  roughness: 0.85,
  metalness: 0.0,
});

interface ChunkEntry {
  mesh: THREE.Mesh | null;
  lodLevel: number;
  voxels: Uint8Array;
}

/**
 * Manages chunk meshes in the Three.js scene.
 * Adds/removes/updates chunk meshes as chunk data changes.
 * Supports distance-based LOD: chunks further from the camera are rendered
 * at lower detail (fewer triangles) to improve performance.
 */
export class WorldRenderer {
  private entries = new Map<string, ChunkEntry>();
  private scene: THREE.Scene;

  /** Max chunks to rebuild per LOD update frame to avoid stalls */
  private static readonly MAX_REBUILDS_PER_FRAME = 8;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  /** Set or update a chunk's mesh from voxel data (initial load at LOD 0) */
  setChunk(key: string, voxels: Uint8Array): void {
    this.setChunkWithLod(key, voxels, 0);
  }

  /** Set a chunk with a specific LOD level */
  private setChunkWithLod(key: string, voxels: Uint8Array, lodLevel: number): void {
    // Remove old mesh if present
    const existing = this.entries.get(key);
    if (existing?.mesh) {
      this.scene.remove(existing.mesh);
      existing.mesh.geometry.dispose();
    }

    const geometry = buildChunkGeometry(voxels, lodLevel);
    let mesh: THREE.Mesh | null = null;

    if (geometry) {
      mesh = new THREE.Mesh(geometry, chunkMaterial);
      const origin = chunkKeyToPosition(key);
      mesh.position.set(origin.x, origin.y, origin.z);
      mesh.name = `chunk_${key}`;
      mesh.castShadow = lodLevel === 0;
      mesh.receiveShadow = true;
      this.scene.add(mesh);
    }

    this.entries.set(key, { mesh, lodLevel, voxels });
  }

  /** Remove a chunk mesh from the scene */
  removeChunk(key: string): void {
    const existing = this.entries.get(key);
    if (existing) {
      if (existing.mesh) {
        this.scene.remove(existing.mesh);
        existing.mesh.geometry.dispose();
      }
      this.entries.delete(key);
    }
  }

  /** Load all chunks from a chunk map */
  loadAll(chunks: Map<string, Uint8Array>): void {
    for (const [key, voxels] of chunks) {
      this.setChunk(key, voxels);
    }
  }

  /**
   * Recalculate LOD levels for all loaded chunks based on distance to the player.
   * Rebuilds meshes whose LOD level has changed, up to MAX_REBUILDS_PER_FRAME
   * per call to avoid frame stalls.
   */
  updateLod(playerPos: { x: number; y: number; z: number }): void {
    const pcx = Math.floor(playerPos.x / CHUNK_SIZE);
    const pcy = Math.floor(playerPos.y / CHUNK_SIZE);
    const pcz = Math.floor(playerPos.z / CHUNK_SIZE);

    let rebuilds = 0;

    for (const [key, entry] of this.entries) {
      if (rebuilds >= WorldRenderer.MAX_REBUILDS_PER_FRAME) break;

      const [cx, cy, cz] = key.split(',').map(Number);
      const dx = cx - pcx;
      const dy = cy - pcy;
      const dz = cz - pcz;
      const distSq = dx * dx + dy * dy + dz * dz;

      const desiredLod = getLodLevel(distSq);
      if (desiredLod !== entry.lodLevel) {
        this.setChunkWithLod(key, entry.voxels, desiredLod);
        rebuilds++;
      }
    }
  }

  /** Remove chunks too far from the given world position. Returns removed keys. */
  pruneDistant(playerPos: { x: number; y: number; z: number }, maxChunkDist: number): string[] {
    const pcx = Math.floor(playerPos.x / CHUNK_SIZE);
    const pcy = Math.floor(playerPos.y / CHUNK_SIZE);
    const pcz = Math.floor(playerPos.z / CHUNK_SIZE);
    const maxDistSq = maxChunkDist * maxChunkDist;
    const removed: string[] = [];

    for (const [key] of this.entries) {
      const [cx, cy, cz] = key.split(',').map(Number);
      const dx = cx - pcx;
      const dy = cy - pcy;
      const dz = cz - pcz;
      if (dx * dx + dy * dy + dz * dz > maxDistSq) {
        this.removeChunk(key);
        removed.push(key);
      }
    }

    return removed;
  }

  /** Dispose all chunk meshes */
  dispose(): void {
    for (const [key] of this.entries) {
      this.removeChunk(key);
    }
  }
}
