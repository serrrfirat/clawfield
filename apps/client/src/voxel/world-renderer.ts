import * as THREE from 'three';
import { CHUNK_SIZE, chunkKeyToPosition } from '@clawfield/shared';
import { buildChunkGeometry, buildWaterGeometry } from './chunk-mesh';
import { getLodLevel } from './lod';
import { createTextureAtlas, ATLAS_COLS, ATLAS_ROWS } from './texture-atlas';
import { WaterFaceSorter } from './water-sort';

// Generate the texture atlas once at startup
const atlasTexture = createTextureAtlas();

// Store shader references for runtime uniform updates (fog, underwater toggle)
interface ShaderRef {
  uniforms: Record<string, THREE.IUniform>;
}
const shaderRefs: ShaderRef[] = [];

/** Fog configuration (can be updated at runtime via setFogUniforms) */
const fogConfig = {
  color: new THREE.Color(0xa9c2d0),
  near: 160,
  far: 420,
  heightDensity: 0.015,
  heightOrigin: 8,
};

/**
 * Patch a MeshStandardMaterial with atlas sampling, world-position UVs, and height fog.
 *
 * Vertex shader additions:
 * - vWorldPosition: world-space position for fog + UV projection
 * - vFlatNormal: world-space normal for face-plane UV projection
 *
 * Fragment shader additions:
 * - Atlas sampling using world-position-based UVs (fract(worldPos) projected onto face)
 * - Height + distance fog replacing Three.js built-in fog
 */
function patchMaterialWithAtlas(mat: THREE.MeshStandardMaterial): void {
  // Force Three.js to include the UV varying (vUv) in the compiled shader.
  mat.defines = { ...mat.defines, USE_UV: '' };
  // Prevent Three.js built-in fog from conflicting with our custom fog
  mat.fog = false;

  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uAtlas = { value: atlasTexture };
    shader.uniforms.uAtlasCols = { value: ATLAS_COLS };
    shader.uniforms.uAtlasRows = { value: ATLAS_ROWS };

    // Fog uniforms
    shader.uniforms.uFogColor = { value: fogConfig.color.clone() };
    shader.uniforms.uFogNear = { value: fogConfig.near };
    shader.uniforms.uFogFar = { value: fogConfig.far };
    shader.uniforms.uFogHeightDensity = { value: fogConfig.heightDensity };
    shader.uniforms.uFogHeightOrigin = { value: fogConfig.heightOrigin };

    // Store ref so we can update uniforms at runtime
    shaderRefs.push(shader);

    // --- Vertex shader: add vWorldPosition and vFlatNormal varyings ---
    shader.vertexShader = shader.vertexShader.replace(
      '#include <common>',
      /* glsl */ `
      #include <common>
      varying vec3 vWorldPosition;
      varying vec3 vFlatNormal;
      `,
    );

    // After worldpos_vertex, compute world position and flat normal
    shader.vertexShader = shader.vertexShader.replace(
      '#include <worldpos_vertex>',
      /* glsl */ `
      #include <worldpos_vertex>
      vec4 worldPos4 = modelMatrix * vec4(position, 1.0);
      vWorldPosition = worldPos4.xyz;
      vFlatNormal = normalize((modelMatrix * vec4(normal, 0.0)).xyz);
      `,
    );

    // --- Fragment shader: add uniforms and varyings ---
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <common>',
      /* glsl */ `
      #include <common>
      uniform sampler2D uAtlas;
      uniform float uAtlasCols;
      uniform float uAtlasRows;
      uniform vec3 uFogColor;
      uniform float uFogNear;
      uniform float uFogFar;
      uniform float uFogHeightDensity;
      uniform float uFogHeightOrigin;
      varying vec3 vWorldPosition;
      varying vec3 vFlatNormal;
      `,
    );

    // Replace the color fragment to sample atlas with world-position UVs
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <color_fragment>',
      /* glsl */ `
      #include <color_fragment>
      {
        // Decode packed UVs: floor = tile index, fract = position within tile
        vec2 tileBase = floor(vUv);

        // Project world position onto face plane to derive local UV
        vec3 absNorm = abs(vFlatNormal);
        vec2 localUV;
        if (absNorm.y > absNorm.x && absNorm.y > absNorm.z) {
          // Top/bottom face: use XZ
          localUV = fract(vWorldPosition.xz);
        } else if (absNorm.x > absNorm.z) {
          // X-facing side: use YZ
          localUV = fract(vWorldPosition.yz);
        } else {
          // Z-facing side: use XY
          localUV = fract(vWorldPosition.xy);
        }

        // Convert tile + local position to atlas UV
        vec2 atlasUV = (tileBase + localUV) / vec2(uAtlasCols, uAtlasRows);
        vec4 atlasColor = texture2D(uAtlas, atlasUV);
        // Multiply atlas texture color by vertex color (carries face shading)
        diffuseColor.rgb *= atlasColor.rgb;
      }
      `,
    );

    // Replace built-in fog with custom height + distance fog
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <fog_fragment>',
      /* glsl */ `
      {
        float fogDist = length(vWorldPosition - cameraPosition);
        // Distance fog: linear ramp
        float distFog = smoothstep(uFogNear, uFogFar, fogDist);
        // Height fog: exponential density below heightOrigin
        float heightDelta = uFogHeightOrigin - vWorldPosition.y;
        float heightFog = 1.0 - exp(-max(heightDelta, 0.0) * uFogHeightDensity);
        // Combine: max of distance and height fog
        float fogFactor = max(distFog, heightFog);
        fogFactor = clamp(fogFactor, 0.0, 1.0);
        gl_FragColor.rgb = mix(gl_FragColor.rgb, uFogColor, fogFactor);
      }
      `,
    );
  };
}

/**
 * Update fog uniforms on all patched materials at runtime.
 * Called from the game loop for underwater/normal transitions.
 */
export function setFogUniforms(params: {
  color?: THREE.Color;
  near?: number;
  far?: number;
  heightDensity?: number;
  heightOrigin?: number;
}): void {
  if (params.color) fogConfig.color.copy(params.color);
  if (params.near !== undefined) fogConfig.near = params.near;
  if (params.far !== undefined) fogConfig.far = params.far;
  if (params.heightDensity !== undefined) fogConfig.heightDensity = params.heightDensity;
  if (params.heightOrigin !== undefined) fogConfig.heightOrigin = params.heightOrigin;

  for (const shader of shaderRefs) {
    if (params.color) (shader.uniforms.uFogColor.value as THREE.Color).copy(params.color);
    if (params.near !== undefined) shader.uniforms.uFogNear.value = params.near;
    if (params.far !== undefined) shader.uniforms.uFogFar.value = params.far;
    if (params.heightDensity !== undefined) shader.uniforms.uFogHeightDensity.value = params.heightDensity;
    if (params.heightOrigin !== undefined) shader.uniforms.uFogHeightOrigin.value = params.heightOrigin;
  }
}

export const chunkMaterial = new THREE.MeshStandardMaterial({
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
  waterSorter: WaterFaceSorter | null;
  lodLevel: number;
  voxels: Uint8Array;
}

/**
 * Manages chunk meshes in the Three.js scene.
 * Adds/removes/updates chunk meshes as chunk data changes.
 * Supports distance-based LOD, transparent water meshes, and water face sorting.
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
    let waterSorter: WaterFaceSorter | null = null;

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

      // Create face sorter for transparent water
      waterSorter = WaterFaceSorter.fromGeometry(waterGeom);
    }

    this.entries.set(key, { mesh, waterMesh, waterSorter, lodLevel, voxels });
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

  /** Sort water faces back-to-front for correct transparency. Call each frame. */
  sortWater(cameraPos: { x: number; y: number; z: number }): void {
    for (const [_key, entry] of this.entries) {
      if (entry.waterMesh && entry.waterSorter) {
        const origin = entry.waterMesh.position;
        // Transform camera to chunk-local space
        const localCam = {
          x: cameraPos.x - origin.x,
          y: cameraPos.y - origin.y,
          z: cameraPos.z - origin.z,
        };
        entry.waterSorter.sort(localCam, entry.waterMesh.geometry);
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
