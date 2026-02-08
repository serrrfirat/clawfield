import * as THREE from 'three';
import { CHUNK_SIZE, chunkKeyToPosition } from '@clawfield/shared';
import { buildChunkGeometry } from './chunk-mesh';

const chunkMaterial = new THREE.MeshLambertMaterial({ vertexColors: true });

/**
 * Manages chunk meshes in the Three.js scene.
 * Adds/removes/updates chunk meshes as chunk data changes.
 */
export class WorldRenderer {
  private meshes = new Map<string, THREE.Mesh>();
  private scene: THREE.Scene;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  /** Set or update a chunk's mesh from voxel data */
  setChunk(key: string, voxels: Uint8Array): void {
    // Remove old mesh if present
    this.removeChunk(key);

    const geometry = buildChunkGeometry(voxels);
    if (!geometry) return;

    const mesh = new THREE.Mesh(geometry, chunkMaterial);
    const origin = chunkKeyToPosition(key);
    mesh.position.set(origin.x, origin.y, origin.z);
    mesh.name = `chunk_${key}`;

    this.scene.add(mesh);
    this.meshes.set(key, mesh);
  }

  /** Remove a chunk mesh from the scene */
  removeChunk(key: string): void {
    const existing = this.meshes.get(key);
    if (existing) {
      this.scene.remove(existing);
      existing.geometry.dispose();
      this.meshes.delete(key);
    }
  }

  /** Load all chunks from a chunk map */
  loadAll(chunks: Map<string, Uint8Array>): void {
    for (const [key, voxels] of chunks) {
      this.setChunk(key, voxels);
    }
  }

  /** Remove chunks too far from the given world position. Returns removed keys. */
  pruneDistant(playerPos: { x: number; y: number; z: number }, maxChunkDist: number): string[] {
    const pcx = Math.floor(playerPos.x / CHUNK_SIZE);
    const pcy = Math.floor(playerPos.y / CHUNK_SIZE);
    const pcz = Math.floor(playerPos.z / CHUNK_SIZE);
    const maxDistSq = maxChunkDist * maxChunkDist;
    const removed: string[] = [];

    for (const [key] of this.meshes) {
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
    for (const [key] of this.meshes) {
      this.removeChunk(key);
    }
  }
}
