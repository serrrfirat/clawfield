import * as THREE from 'three';
import { CHUNK_SIZE, chunkKeyToPosition } from '@clawfield/shared';
import { buildChunkGeometry, buildWaterGeometry } from './chunk-mesh';
import { getLodLevel } from './lod';
import { createTextureAtlas, createNormalAtlas, ATLAS_COLS, ATLAS_ROWS } from './texture-atlas';
import { WaterFaceSorter } from './water-sort';
import { DetailPropSystem } from './detail-props';

// Generate the texture atlases once at startup
const atlasTexture = createTextureAtlas();
const normalAtlasTexture = createNormalAtlas();

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
  edgeMin: new THREE.Vector2(-99999, -99999),
  edgeMax: new THREE.Vector2(99999, 99999),
  edgeFadeDistance: 0,
  edgeStrength: 0,
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
    shader.uniforms.uNormalAtlas = { value: normalAtlasTexture };
    shader.uniforms.uAtlasCols = { value: ATLAS_COLS };
    shader.uniforms.uAtlasRows = { value: ATLAS_ROWS };

    // Fog uniforms
    shader.uniforms.uFogColor = { value: fogConfig.color.clone() };
    shader.uniforms.uFogNear = { value: fogConfig.near };
    shader.uniforms.uFogFar = { value: fogConfig.far };
    shader.uniforms.uFogHeightDensity = { value: fogConfig.heightDensity };
    shader.uniforms.uFogHeightOrigin = { value: fogConfig.heightOrigin };
    shader.uniforms.uEdgeMin = { value: fogConfig.edgeMin.clone() };
    shader.uniforms.uEdgeMax = { value: fogConfig.edgeMax.clone() };
    shader.uniforms.uEdgeFadeDistance = { value: fogConfig.edgeFadeDistance };
    shader.uniforms.uEdgeStrength = { value: fogConfig.edgeStrength };

    // Store ref so we can update uniforms at runtime
    shaderRefs.push(shader);

    // --- Vertex shader: add vWorldPosition, vFlatNormal, and vAO varyings ---
    shader.vertexShader = shader.vertexShader.replace(
      '#include <common>',
      /* glsl */ `
      #include <common>
      attribute float ao;
      varying vec3 vWorldPosition;
      varying vec3 vFlatNormal;
      varying float vAO;
      `,
    );

    // After worldpos_vertex, compute world position, flat normal, and pass AO
    shader.vertexShader = shader.vertexShader.replace(
      '#include <worldpos_vertex>',
      /* glsl */ `
      #include <worldpos_vertex>
      vec4 worldPos4 = modelMatrix * vec4(position, 1.0);
      vWorldPosition = worldPos4.xyz;
      vFlatNormal = normalize((modelMatrix * vec4(normal, 0.0)).xyz);
      vAO = ao;
      `,
    );

    // --- Fragment shader: add uniforms and varyings ---
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <common>',
      /* glsl */ `
      #include <common>
      uniform sampler2D uAtlas;
      uniform sampler2D uNormalAtlas;
      uniform float uAtlasCols;
      uniform float uAtlasRows;
      uniform vec3 uFogColor;
      uniform float uFogNear;
      uniform float uFogFar;
      uniform float uFogHeightDensity;
      uniform float uFogHeightOrigin;
      uniform vec2 uEdgeMin;
      uniform vec2 uEdgeMax;
      uniform float uEdgeFadeDistance;
      uniform float uEdgeStrength;
      varying vec3 vWorldPosition;
      varying vec3 vFlatNormal;
      varying float vAO;
      // Shared between color_fragment and normal_fragment_maps patches
      vec2 computedAtlasUV;
      vec3 computedAbsNorm;
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
        // Store for normal map sampling in normal_fragment_maps
        computedAtlasUV = atlasUV;
        computedAbsNorm = absNorm;

        // Per-vertex ambient occlusion: darken corners/edges
        // vAO ranges from 0 (fully occluded) to 1 (fully lit)
        // Mix between dark factor (0.4) and full brightness (1.0)
        float aoFactor = mix(0.4, 1.0, vAO);
        diffuseColor.rgb *= aoFactor;
      }
      `,
    );

    // Replace normal_fragment_maps to apply our atlas normal map
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <normal_fragment_maps>',
      /* glsl */ `
      {
        // Sample normal from atlas normal map at the same UV computed in color_fragment
        vec3 normalSample = texture2D(uNormalAtlas, computedAtlasUV).rgb * 2.0 - 1.0;
        // Build TBN matrix from flat face normal
        vec3 N = normalize(vFlatNormal);
        vec3 T, B;
        if (computedAbsNorm.y > computedAbsNorm.x && computedAbsNorm.y > computedAbsNorm.z) {
          // Y face: tangent=X, bitangent=Z
          T = vec3(1.0, 0.0, 0.0);
          B = vec3(0.0, 0.0, sign(N.y));
        } else if (computedAbsNorm.x > computedAbsNorm.z) {
          // X face: tangent=Y, bitangent=Z
          T = vec3(0.0, 1.0, 0.0);
          B = vec3(0.0, 0.0, sign(N.x));
        } else {
          // Z face: tangent=X, bitangent=Y
          T = vec3(1.0, 0.0, 0.0);
          B = vec3(0.0, sign(N.z), 0.0);
        }
        mat3 TBN = mat3(T, B, N);
        normal = normalize(TBN * normalSample);
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

        // Edge fog: ramps up toward map borders in XZ to hide hard world cutoff.
        float edgeDistX = min(vWorldPosition.x - uEdgeMin.x, uEdgeMax.x - vWorldPosition.x);
        float edgeDistZ = min(vWorldPosition.z - uEdgeMin.y, uEdgeMax.y - vWorldPosition.z);
        float edgeDist = min(edgeDistX, edgeDistZ);
        float edgeFog = 0.0;
        if (uEdgeFadeDistance > 0.0 && uEdgeStrength > 0.0) {
          float edgeT = 1.0 - smoothstep(0.0, uEdgeFadeDistance, edgeDist);
          edgeFog = clamp(edgeT * uEdgeStrength, 0.0, 1.0);
        }

        fogFactor = max(fogFactor, edgeFog);
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
  edgeMin?: { x: number; z: number };
  edgeMax?: { x: number; z: number };
  edgeFadeDistance?: number;
  edgeStrength?: number;
}): void {
  if (params.color) fogConfig.color.copy(params.color);
  if (params.near !== undefined) fogConfig.near = params.near;
  if (params.far !== undefined) fogConfig.far = params.far;
  if (params.heightDensity !== undefined) fogConfig.heightDensity = params.heightDensity;
  if (params.heightOrigin !== undefined) fogConfig.heightOrigin = params.heightOrigin;
  if (params.edgeMin) fogConfig.edgeMin.set(params.edgeMin.x, params.edgeMin.z);
  if (params.edgeMax) fogConfig.edgeMax.set(params.edgeMax.x, params.edgeMax.z);
  if (params.edgeFadeDistance !== undefined) fogConfig.edgeFadeDistance = params.edgeFadeDistance;
  if (params.edgeStrength !== undefined) fogConfig.edgeStrength = params.edgeStrength;

  for (const shader of shaderRefs) {
    if (params.color) (shader.uniforms.uFogColor.value as THREE.Color).copy(params.color);
    if (params.near !== undefined) shader.uniforms.uFogNear.value = params.near;
    if (params.far !== undefined) shader.uniforms.uFogFar.value = params.far;
    if (params.heightDensity !== undefined) shader.uniforms.uFogHeightDensity.value = params.heightDensity;
    if (params.heightOrigin !== undefined) shader.uniforms.uFogHeightOrigin.value = params.heightOrigin;
    if (params.edgeMin) (shader.uniforms.uEdgeMin.value as THREE.Vector2).set(params.edgeMin.x, params.edgeMin.z);
    if (params.edgeMax) (shader.uniforms.uEdgeMax.value as THREE.Vector2).set(params.edgeMax.x, params.edgeMax.z);
    if (params.edgeFadeDistance !== undefined) shader.uniforms.uEdgeFadeDistance.value = params.edgeFadeDistance;
    if (params.edgeStrength !== undefined) shader.uniforms.uEdgeStrength.value = params.edgeStrength;
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
  private detailProps: DetailPropSystem;

  /** Max chunks to rebuild per LOD update frame to avoid stalls */
  private static readonly MAX_REBUILDS_PER_FRAME = 8;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.detailProps = new DetailPropSystem(scene);
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

  /**
   * Update detail props (grass, rocks, rubble) near the camera.
   * Call periodically from the game loop (e.g. alongside updateLod).
   */
  updateDetailProps(cameraPos: { x: number; y: number; z: number }): void {
    // Build a lightweight map of chunk key → { voxels } for the prop system
    const chunkMap = new Map<string, { voxels: Uint8Array }>();
    for (const [key, entry] of this.entries) {
      chunkMap.set(key, { voxels: entry.voxels });
    }
    this.detailProps.update(cameraPos, chunkMap);
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

  /** Dispose all chunk meshes and detail props */
  dispose(): void {
    for (const [key] of this.entries) {
      this.removeChunk(key);
    }
    this.detailProps.dispose();
  }
}
