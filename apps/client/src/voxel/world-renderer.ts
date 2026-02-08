import * as THREE from 'three';
import { CHUNK_SIZE, chunkKeyToPosition } from '@clawfield/shared';
import { buildChunkGeometry, buildWaterGeometry } from './chunk-mesh';
import { getLodLevel } from './lod';
import { createTextureAtlas, ATLAS_COLS, ATLAS_ROWS } from './texture-atlas';

// Generate the texture atlas once at startup
const atlasTexture = createTextureAtlas();

/**
 * Patch a MeshStandardMaterial to sample a texture atlas in the fragment shader.
 *
 * UV encoding from the mesher: uv = (tileCol + voxelU, tileRow + voxelV)
 * The shader extracts the tile base via floor() and uses fract() to tile within
 * each atlas cell, then samples the atlas texture and multiplies by vertex color
 * (which carries the per-face directional shading).
 */
function patchMaterialWithAtlas(mat: THREE.MeshStandardMaterial): void {
  // Force Three.js to include the UV varying (vUv) in the compiled shader.
  // Without this, vUv is stripped out because no built-in texture property (map, etc.) is set.
  mat.defines = { ...mat.defines, USE_UV: '' };

  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uAtlas = { value: atlasTexture };
    shader.uniforms.uAtlasCols = { value: ATLAS_COLS };
    shader.uniforms.uAtlasRows = { value: ATLAS_ROWS };

    // Add uniforms to the fragment shader
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <common>',
      /* glsl */ `
      #include <common>
      uniform sampler2D uAtlas;
      uniform float uAtlasCols;
      uniform float uAtlasRows;
      `,
    );

    // Replace the color/map fragment to sample the atlas
    // The default map_fragment reads from the 'map' texture; we override it
    // to read from our atlas using the packed UVs.
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <color_fragment>',
      /* glsl */ `
      #include <color_fragment>
      {
        // Decode packed UVs: floor = tile index, fract = position within tile
        vec2 tileBase = floor(vUv);
        vec2 localUV = fract(vUv);
        // Convert tile + local position to atlas UV
        vec2 atlasUV = (tileBase + localUV) / vec2(uAtlasCols, uAtlasRows);
        vec4 atlasColor = texture2D(uAtlas, atlasUV);
        // Multiply atlas texture color by vertex color (carries face shading)
        diffuseColor.rgb *= atlasColor.rgb;
      }
      `,
    );
  };
}

const chunkMaterial = new THREE.MeshStandardMaterial({
  vertexColors: true,
  roughness: 0.85,
  metalness: 0.0,
});
patchMaterialWithAtlas(chunkMaterial);

const waterMaterial = new THREE.MeshStandardMaterial({
  vertexColors: true,
  transparent: true,
  opacity: 0.55,
  roughness: 0.15,
  metalness: 0.1,
  depthWrite: false,
  side: THREE.DoubleSide,
});
patchMaterialWithAtlas(waterMaterial);

interface ChunkEntry {
  mesh: THREE.Mesh | null;
  waterMesh: THREE.Mesh | null;
  lodLevel: number;
  voxels: Uint8Array;
}

/**
 * Manages chunk meshes in the Three.js scene.
 * Adds/removes/updates chunk meshes as chunk data changes.
 * Supports distance-based LOD and transparent water meshes.
 */
export class WorldRenderer {
  private entries = new Map<string, ChunkEntry>();
  private scene: THREE.Scene;
  private elapsedTime = 0;

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
    // Remove old meshes if present
    const existing = this.entries.get(key);
    if (existing) {
      if (existing.mesh) {
        this.scene.remove(existing.mesh);
        existing.mesh.geometry.dispose();
      }
      if (existing.waterMesh) {
        this.scene.remove(existing.waterMesh);
        existing.waterMesh.geometry.dispose();
      }
    }

    const origin = chunkKeyToPosition(key);
    let mesh: THREE.Mesh | null = null;
    let waterMesh: THREE.Mesh | null = null;

    // Solid terrain mesh
    const geometry = buildChunkGeometry(voxels, lodLevel);
    if (geometry) {
      mesh = new THREE.Mesh(geometry, chunkMaterial);
      mesh.position.set(origin.x, origin.y, origin.z);
      mesh.name = `chunk_${key}`;
      mesh.castShadow = lodLevel === 0;
      mesh.receiveShadow = true;
      this.scene.add(mesh);
    }

    // Water mesh (transparent, no shadows)
    const waterGeom = buildWaterGeometry(voxels, lodLevel);
    if (waterGeom) {
      waterMesh = new THREE.Mesh(waterGeom, waterMaterial);
      waterMesh.position.set(origin.x, origin.y, origin.z);
      waterMesh.name = `water_${key}`;
      waterMesh.castShadow = false;
      waterMesh.receiveShadow = true;
      waterMesh.renderOrder = 1; // render after opaque
      this.scene.add(waterMesh);
    }

    this.entries.set(key, { mesh, waterMesh, lodLevel, voxels });
  }

  /** Remove a chunk mesh from the scene */
  removeChunk(key: string): void {
    const existing = this.entries.get(key);
    if (existing) {
      if (existing.mesh) {
        this.scene.remove(existing.mesh);
        existing.mesh.geometry.dispose();
      }
      if (existing.waterMesh) {
        this.scene.remove(existing.waterMesh);
        existing.waterMesh.geometry.dispose();
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

  /** Animate water — call each frame with dt */
  update(dt: number): void {
    this.elapsedTime += dt;
    // Gentle vertical bob for water surface
    const bob = Math.sin(this.elapsedTime * 1.5) * 0.04;
    for (const [key, entry] of this.entries) {
      if (entry.waterMesh) {
        const origin = chunkKeyToPosition(key);
        entry.waterMesh.position.y = origin.y + bob;
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
