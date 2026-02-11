import * as THREE from 'three';
import {
  CHUNK_SIZE, chunkKeyToPosition,
  MAT_GRASS, MAT_DIRT, MAT_STONE, MAT_WALL, MAT_ROOF,
  MAT_SAND_LIGHT, MAT_SAND_DARK, MAT_GRASS_DARK, MAT_STONE_DARK,
  MAT_CONCRETE, MAT_CONCRETE_DARK, MAT_WOOD, MAT_WOOD_DARK,
  MAT_BRICK, MAT_ROOF_TILE, MAT_ROAD, MAT_WINDOW, MAT_METAL,
} from '@clawfield/shared';
import { buildChunkGeometry, buildWaterGeometry } from './chunk-mesh';
import { getLodLevel } from './lod';
import { createTextureAtlas, createNormalAtlas, ATLAS_COLS, ATLAS_ROWS } from './texture-atlas';
import { WaterFaceSorter } from './water-sort';
import { DetailPropSystem } from './detail-props';

// Generate the texture atlases once at startup
const atlasTexture = createTextureAtlas();
const normalAtlasTexture = createNormalAtlas();

// --- PBR Lookup Texture (256x1 RGBA) ---
// Maps material ID → [roughness, metalness, emissive, edgeDarkening]

interface PBREntry { roughness: number; metalness: number; emissive: number; edgeDark: number }

const PBR_TABLE: Record<number, PBREntry> = {
  [MAT_GRASS]:          { roughness: 0.95, metalness: 0.0,  emissive: 0.0,  edgeDark: 0.3 },
  [MAT_DIRT]:           { roughness: 0.95, metalness: 0.0,  emissive: 0.0,  edgeDark: 0.3 },
  [MAT_STONE]:          { roughness: 0.80, metalness: 0.0,  emissive: 0.0,  edgeDark: 0.5 },
  [MAT_WALL]:           { roughness: 0.85, metalness: 0.0,  emissive: 0.0,  edgeDark: 0.6 },
  [MAT_ROOF]:           { roughness: 0.70, metalness: 0.05, emissive: 0.0,  edgeDark: 0.5 },
  [MAT_SAND_LIGHT]:     { roughness: 0.95, metalness: 0.0,  emissive: 0.0,  edgeDark: 0.2 },
  [MAT_SAND_DARK]:      { roughness: 0.95, metalness: 0.0,  emissive: 0.0,  edgeDark: 0.2 },
  [MAT_GRASS_DARK]:     { roughness: 0.95, metalness: 0.0,  emissive: 0.0,  edgeDark: 0.3 },
  [MAT_STONE_DARK]:     { roughness: 0.80, metalness: 0.0,  emissive: 0.0,  edgeDark: 0.5 },
  [MAT_CONCRETE]:       { roughness: 0.80, metalness: 0.0,  emissive: 0.0,  edgeDark: 0.6 },
  [MAT_CONCRETE_DARK]:  { roughness: 0.80, metalness: 0.0,  emissive: 0.0,  edgeDark: 0.6 },
  [MAT_WOOD]:           { roughness: 0.75, metalness: 0.0,  emissive: 0.0,  edgeDark: 0.5 },
  [MAT_WOOD_DARK]:      { roughness: 0.75, metalness: 0.0,  emissive: 0.0,  edgeDark: 0.5 },
  [MAT_BRICK]:          { roughness: 0.80, metalness: 0.0,  emissive: 0.0,  edgeDark: 0.6 },
  [MAT_ROOF_TILE]:      { roughness: 0.65, metalness: 0.0,  emissive: 0.0,  edgeDark: 0.5 },
  [MAT_ROAD]:           { roughness: 0.70, metalness: 0.0,  emissive: 0.0,  edgeDark: 0.4 },
  [MAT_WINDOW]:         { roughness: 0.10, metalness: 0.2,  emissive: 0.15, edgeDark: 0.8 },
  [MAT_METAL]:          { roughness: 0.35, metalness: 0.7,  emissive: 0.0,  edgeDark: 0.7 },
};

const PBR_DEFAULT: PBREntry = { roughness: 0.85, metalness: 0.0, emissive: 0.0, edgeDark: 0.4 };

function createPBRLookup(): THREE.DataTexture {
  const data = new Uint8Array(256 * 4); // 256 entries, 4 channels each
  for (let i = 0; i < 256; i++) {
    const entry = PBR_TABLE[i] ?? PBR_DEFAULT;
    const off = i * 4;
    data[off]     = Math.round(entry.roughness * 255);
    data[off + 1] = Math.round(entry.metalness * 255);
    data[off + 2] = Math.round(entry.emissive * 255);
    data[off + 3] = Math.round(entry.edgeDark * 255);
  }
  const tex = new THREE.DataTexture(data, 256, 1, THREE.RGBAFormat);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  return tex;
}

const pbrLookupTexture = createPBRLookup();

// Store shader references for runtime uniform updates (fog, underwater toggle)
interface ShaderRef {
  uniforms: Record<string, THREE.IUniform>;
}
const shaderRefs: ShaderRef[] = [];

/** Max point lights that can scatter through fog */
const MAX_FOG_LIGHTS = 8;

/** Fog configuration (can be updated at runtime via setFogUniforms) */
const fogConfig = {
  color: new THREE.Color(0xa9c2d0),
  density: 0.004,           // exponential² fog density
  heightDensity: 0.015,
  heightOrigin: 8,
  edgeMin: new THREE.Vector2(-99999, -99999),
  edgeMax: new THREE.Vector2(99999, 99999),
  edgeFadeDistance: 0,
  edgeStrength: 0,
  // Sun inscattering
  sunDirection: new THREE.Vector3(0.4, 0.6, 0.3).normalize(),
  sunInscatterColor: new THREE.Color(0xffe0a0),
  sunInscatterPower: 8.0,    // sharpness of sun glow cone
  sunInscatterIntensity: 0.4,
  // Point light fog scattering (ijdykeman closed-form integral)
  fogLightCount: 0,
  fogLightPositions: Array.from({ length: MAX_FOG_LIGHTS }, () => new THREE.Vector3()),
  fogLightColors: Array.from({ length: MAX_FOG_LIGHTS }, () => new THREE.Color()),
  fogLightRanges: new Float32Array(MAX_FOG_LIGHTS),
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
    shader.uniforms.uPBRLookup = { value: pbrLookupTexture };

    // Fog uniforms
    shader.uniforms.uFogColor = { value: fogConfig.color.clone() };
    shader.uniforms.uFogDensity = { value: fogConfig.density };
    shader.uniforms.uFogHeightDensity = { value: fogConfig.heightDensity };
    shader.uniforms.uFogHeightOrigin = { value: fogConfig.heightOrigin };
    shader.uniforms.uEdgeMin = { value: fogConfig.edgeMin.clone() };
    shader.uniforms.uEdgeMax = { value: fogConfig.edgeMax.clone() };
    shader.uniforms.uEdgeFadeDistance = { value: fogConfig.edgeFadeDistance };
    shader.uniforms.uEdgeStrength = { value: fogConfig.edgeStrength };
    // Sun inscattering
    shader.uniforms.uSunDirection = { value: fogConfig.sunDirection.clone() };
    shader.uniforms.uSunInscatterColor = { value: fogConfig.sunInscatterColor.clone() };
    shader.uniforms.uSunInscatterPower = { value: fogConfig.sunInscatterPower };
    shader.uniforms.uSunInscatterIntensity = { value: fogConfig.sunInscatterIntensity };
    // Point light fog scattering
    shader.uniforms.uFogLightCount = { value: fogConfig.fogLightCount };
    shader.uniforms.uFogLightPositions = { value: fogConfig.fogLightPositions.map(v => v.clone()) };
    shader.uniforms.uFogLightColors = { value: fogConfig.fogLightColors.map(c => c.clone()) };
    shader.uniforms.uFogLightRanges = { value: new Float32Array(fogConfig.fogLightRanges) };

    // Store ref so we can update uniforms at runtime
    shaderRefs.push(shader);

    // --- Vertex shader: add vWorldPosition, vFlatNormal, vAO, and vMaterialId varyings ---
    shader.vertexShader = shader.vertexShader.replace(
      '#include <common>',
      /* glsl */ `
      #include <common>
      attribute float ao;
      attribute float materialId;
      varying vec3 vWorldPosition;
      varying vec3 vFlatNormal;
      varying float vAO;
      varying float vMaterialId;
      `,
    );

    // After worldpos_vertex, compute world position, flat normal, pass AO + materialId
    shader.vertexShader = shader.vertexShader.replace(
      '#include <worldpos_vertex>',
      /* glsl */ `
      #include <worldpos_vertex>
      vec4 worldPos4 = modelMatrix * vec4(position, 1.0);
      vWorldPosition = worldPos4.xyz;
      vFlatNormal = normalize((modelMatrix * vec4(normal, 0.0)).xyz);
      vAO = ao;
      vMaterialId = materialId;
      `,
    );

    // --- Fragment shader: add uniforms and varyings ---
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <common>',
      /* glsl */ `
      #include <common>
      uniform sampler2D uAtlas;
      uniform sampler2D uNormalAtlas;
      uniform sampler2D uPBRLookup;
      uniform float uAtlasCols;
      uniform float uAtlasRows;
      uniform vec3 uFogColor;
      uniform float uFogDensity;
      uniform float uFogHeightDensity;
      uniform float uFogHeightOrigin;
      uniform vec2 uEdgeMin;
      uniform vec2 uEdgeMax;
      uniform float uEdgeFadeDistance;
      uniform float uEdgeStrength;
      // Sun inscattering
      uniform vec3 uSunDirection;
      uniform vec3 uSunInscatterColor;
      uniform float uSunInscatterPower;
      uniform float uSunInscatterIntensity;
      // Point light fog scattering (ijdykeman analytic integral)
      uniform int uFogLightCount;
      uniform vec3 uFogLightPositions[${MAX_FOG_LIGHTS}];
      uniform vec3 uFogLightColors[${MAX_FOG_LIGHTS}];
      uniform float uFogLightRanges[${MAX_FOG_LIGHTS}];
      varying vec3 vWorldPosition;
      varying vec3 vFlatNormal;
      varying float vAO;
      varying float vMaterialId;
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

        // Voxel edge darkening: darken pixels near voxel boundaries for chamfered look
        {
          vec4 pbrEdge = texture2D(uPBRLookup, vec2((vMaterialId + 0.5) / 256.0, 0.5));
          float edgeStrength = pbrEdge.a;
          vec3 voxelUV = fract(vWorldPosition);
          vec3 edgeDist = min(voxelUV, 1.0 - voxelUV);
          float edgeFactor;
          if (computedAbsNorm.y > computedAbsNorm.x && computedAbsNorm.y > computedAbsNorm.z) {
            edgeFactor = min(edgeDist.x, edgeDist.z);
          } else if (computedAbsNorm.x > computedAbsNorm.z) {
            edgeFactor = min(edgeDist.y, edgeDist.z);
          } else {
            edgeFactor = min(edgeDist.x, edgeDist.y);
          }
          float edgeDark = smoothstep(0.0, 0.06, edgeFactor);
          diffuseColor.rgb *= mix(1.0 - edgeStrength * 0.25, 1.0, edgeDark);
        }
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

    // Replace roughnessmap_fragment with per-material roughness from PBR lookup
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <roughnessmap_fragment>',
      /* glsl */ `
      float roughnessFactor = roughness;
      {
        vec4 pbr = texture2D(uPBRLookup, vec2((vMaterialId + 0.5) / 256.0, 0.5));
        roughnessFactor = pbr.r;
      }
      `,
    );

    // Replace metalnessmap_fragment with per-material metalness from PBR lookup
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <metalnessmap_fragment>',
      /* glsl */ `
      float metalnessFactor = metalness;
      {
        vec4 pbr = texture2D(uPBRLookup, vec2((vMaterialId + 0.5) / 256.0, 0.5));
        metalnessFactor = pbr.g;
      }
      `,
    );

    // Replace emissivemap_fragment with per-material emissive from PBR lookup
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <emissivemap_fragment>',
      /* glsl */ `
      {
        vec4 pbr = texture2D(uPBRLookup, vec2((vMaterialId + 0.5) / 256.0, 0.5));
        totalEmissiveRadiance = emissive + vec3(pbr.b * 0.3);
      }
      `,
    );

    // Replace built-in fog with exponential fog + sun inscattering + point light scattering
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <fog_fragment>',
      /* glsl */ `
      {
        vec3 ray = vWorldPosition - cameraPosition;
        float fogDist = length(ray);
        vec3 viewDir = ray / max(fogDist, 1e-4);

        // Exponential² distance fog (much softer than linear)
        float distFog = 1.0 - exp(-pow(fogDist * uFogDensity, 2.0));

        // Height fog: exponential density below heightOrigin
        float heightDelta = uFogHeightOrigin - vWorldPosition.y;
        float heightFog = 1.0 - exp(-max(heightDelta, 0.0) * uFogHeightDensity);

        // Combine: max of distance and height fog
        float fogFactor = max(distFog, heightFog);

        // Edge fog: ramps up toward map borders in XZ
        float edgeDistX = min(vWorldPosition.x - uEdgeMin.x, uEdgeMax.x - vWorldPosition.x);
        float edgeDistZ = min(vWorldPosition.z - uEdgeMin.y, uEdgeMax.y - vWorldPosition.z);
        float edgeDist = min(edgeDistX, edgeDistZ);
        if (uEdgeFadeDistance > 0.0 && uEdgeStrength > 0.0) {
          float edgeT = 1.0 - smoothstep(0.0, uEdgeFadeDistance, edgeDist);
          fogFactor = max(fogFactor, clamp(edgeT * uEdgeStrength, 0.0, 1.0));
        }
        fogFactor = clamp(fogFactor, 0.0, 1.0);

        // Sun inscattering: warm glow when looking toward the sun through fog
        float sunDot = max(dot(viewDir, uSunDirection), 0.0);
        float sunPhase = pow(sunDot, uSunInscatterPower);
        vec3 fogCol = mix(uFogColor, uSunInscatterColor, sunPhase * uSunInscatterIntensity);

        // Point light fog scattering — analytic closed-form line integral
        // (ijdykeman technique: integral of 1/(h²+x²) dx = atan(x/h)/h)
        vec3 inscatter = vec3(0.0);
        for (int i = 0; i < ${MAX_FOG_LIGHTS}; i++) {
          if (i >= uFogLightCount) break;
          vec3 lightPos = uFogLightPositions[i];
          vec3 lightCol = uFogLightColors[i];
          float lightRange = uFogLightRanges[i];

          // Project into light space: view ray is x-axis, light perpendicular distance is h
          vec3 m = cameraPosition - lightPos;
          float bProj = dot(viewDir, m);
          float hSq = max(dot(m, m) - bProj * bProj, 0.01);
          float h = sqrt(hSq);

          // Evaluate integral from camera (x=0) to fragment (x=fogDist)
          float integral = (atan((fogDist + bProj) / h) - atan(bProj / h)) / h;

          // Range attenuation so light doesn't bleed everywhere
          float fragToLight = length(vWorldPosition - lightPos);
          float rangeFade = 1.0 - smoothstep(lightRange * 0.5, lightRange, fragToLight);

          inscatter += lightCol * integral * rangeFade;
        }

        // Apply fog: blend scene color toward lit fog color, then add inscattered light
        gl_FragColor.rgb = mix(gl_FragColor.rgb, fogCol, fogFactor);
        gl_FragColor.rgb += inscatter * fogFactor;
      }
      `,
    );
  };
}

/** Fog light descriptor for setFogUniforms */
export interface FogLight {
  position: { x: number; y: number; z: number };
  color: THREE.Color;
  range: number;
}

/**
 * Update fog uniforms on all patched materials at runtime.
 * Called from the game loop for underwater/normal transitions.
 */
export function setFogUniforms(params: {
  color?: THREE.Color;
  density?: number;
  heightDensity?: number;
  heightOrigin?: number;
  edgeMin?: { x: number; z: number };
  edgeMax?: { x: number; z: number };
  edgeFadeDistance?: number;
  edgeStrength?: number;
  sunDirection?: THREE.Vector3;
  sunInscatterColor?: THREE.Color;
  sunInscatterPower?: number;
  sunInscatterIntensity?: number;
  fogLights?: FogLight[];
}): void {
  if (params.color) fogConfig.color.copy(params.color);
  if (params.density !== undefined) fogConfig.density = params.density;
  if (params.heightDensity !== undefined) fogConfig.heightDensity = params.heightDensity;
  if (params.heightOrigin !== undefined) fogConfig.heightOrigin = params.heightOrigin;
  if (params.edgeMin) fogConfig.edgeMin.set(params.edgeMin.x, params.edgeMin.z);
  if (params.edgeMax) fogConfig.edgeMax.set(params.edgeMax.x, params.edgeMax.z);
  if (params.edgeFadeDistance !== undefined) fogConfig.edgeFadeDistance = params.edgeFadeDistance;
  if (params.edgeStrength !== undefined) fogConfig.edgeStrength = params.edgeStrength;
  if (params.sunDirection) fogConfig.sunDirection.copy(params.sunDirection).normalize();
  if (params.sunInscatterColor) fogConfig.sunInscatterColor.copy(params.sunInscatterColor);
  if (params.sunInscatterPower !== undefined) fogConfig.sunInscatterPower = params.sunInscatterPower;
  if (params.sunInscatterIntensity !== undefined) fogConfig.sunInscatterIntensity = params.sunInscatterIntensity;
  if (params.fogLights) {
    fogConfig.fogLightCount = Math.min(params.fogLights.length, MAX_FOG_LIGHTS);
    for (let i = 0; i < fogConfig.fogLightCount; i++) {
      const l = params.fogLights[i];
      fogConfig.fogLightPositions[i].set(l.position.x, l.position.y, l.position.z);
      fogConfig.fogLightColors[i].copy(l.color);
      fogConfig.fogLightRanges[i] = l.range;
    }
  }

  for (const shader of shaderRefs) {
    if (params.color) (shader.uniforms.uFogColor.value as THREE.Color).copy(params.color);
    if (params.density !== undefined) shader.uniforms.uFogDensity.value = params.density;
    if (params.heightDensity !== undefined) shader.uniforms.uFogHeightDensity.value = params.heightDensity;
    if (params.heightOrigin !== undefined) shader.uniforms.uFogHeightOrigin.value = params.heightOrigin;
    if (params.edgeMin) (shader.uniforms.uEdgeMin.value as THREE.Vector2).set(params.edgeMin.x, params.edgeMin.z);
    if (params.edgeMax) (shader.uniforms.uEdgeMax.value as THREE.Vector2).set(params.edgeMax.x, params.edgeMax.z);
    if (params.edgeFadeDistance !== undefined) shader.uniforms.uEdgeFadeDistance.value = params.edgeFadeDistance;
    if (params.edgeStrength !== undefined) shader.uniforms.uEdgeStrength.value = params.edgeStrength;
    if (params.sunDirection) (shader.uniforms.uSunDirection.value as THREE.Vector3).copy(fogConfig.sunDirection);
    if (params.sunInscatterColor) (shader.uniforms.uSunInscatterColor.value as THREE.Color).copy(params.sunInscatterColor);
    if (params.sunInscatterPower !== undefined) shader.uniforms.uSunInscatterPower.value = params.sunInscatterPower;
    if (params.sunInscatterIntensity !== undefined) shader.uniforms.uSunInscatterIntensity.value = params.sunInscatterIntensity;
    if (params.fogLights) {
      shader.uniforms.uFogLightCount.value = fogConfig.fogLightCount;
      const positions = shader.uniforms.uFogLightPositions.value as THREE.Vector3[];
      const colors = shader.uniforms.uFogLightColors.value as THREE.Color[];
      const ranges = shader.uniforms.uFogLightRanges.value as Float32Array;
      for (let i = 0; i < fogConfig.fogLightCount; i++) {
        positions[i].copy(fogConfig.fogLightPositions[i]);
        colors[i].copy(fogConfig.fogLightColors[i]);
        ranges[i] = fogConfig.fogLightRanges[i];
      }
    }
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
      mesh.receiveShadow = lodLevel <= 1;
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

    // Chunks beyond fog distance are hidden. Use ~80% opacity threshold
    // instead of 95% — fog covers the pop-in and we save many draw calls.
    const effectiveFar = fogConfig.density > 0 ? 1.0 / fogConfig.density : 300;
    const cullDistChunks = Math.ceil(effectiveFar / CHUNK_SIZE) + 1;
    const cullDistSq = cullDistChunks * cullDistChunks;

    let rebuilds = 0;

    for (const [key, entry] of this.entries) {
      const [cx, cy, cz] = key.split(',').map(Number);
      const dx = cx - pcx;
      const dy = cy - pcy;
      const dz = cz - pcz;
      const distSq = dx * dx + dy * dy + dz * dz;

      // Hide chunks completely obscured by fog
      const visible = distSq <= cullDistSq;
      if (entry.mesh) entry.mesh.visible = visible;
      if (entry.waterMesh) entry.waterMesh.visible = visible;
      if (!visible) continue;

      if (rebuilds >= WorldRenderer.MAX_REBUILDS_PER_FRAME) continue;

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
