import { useMemo, useRef, useEffect } from 'react'
import { useGLTF } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { SkeletonUtils } from 'three-stdlib'
import { createNoise2D } from 'simplex-noise'
import { generateChunkFoliage, type FoliageType } from './utils/foliageUtils'
import useStore from '../stores/useStore'
import { mulberry32 } from './utils/randomUtils'

/**
 * Foliage types to scatter. Each references a GLB in public/models/props/natural/.
 * Weight controls relative frequency.
 */
const FOLIAGE_TYPES: (FoliageType & { path: string })[] = [
  { id: 'bushes', path: '/models/props/natural/Bushes.glb', weight: 3, minScale: 0.5, maxScale: 1.0 },
  { id: 'fern', path: '/models/props/natural/Fern.glb', weight: 2, minScale: 0.5, maxScale: 1.0 },
  { id: 'flower-group', path: '/models/props/natural/Flower Group.glb', weight: 2, minScale: 0.4, maxScale: 0.9 },
  { id: 'flowers', path: '/models/props/natural/Flowers.glb', weight: 2, minScale: 0.5, maxScale: 1.0 },
  { id: 'mushroom', path: '/models/props/natural/Mushroom.glb', weight: 1, minScale: 0.3, maxScale: 0.7 },
]

const FOLIAGE_COUNT_PER_CHUNK = 6
const FOLIAGE_NOISE_SCALE = 0.08
const FOLIAGE_NOISE_THRESHOLD = -0.2
const FOLIAGE_PADDING = 1.5
const FOLIAGE_MIN_SPACING = 1.5
const MAX_INSTANCES_PER_TYPE = 64

// Wind gust noise (separate seed from tree wind)
const WIND_NOISE_SEED = 55555
const windNoise2D = createNoise2D(mulberry32(WIND_NOISE_SEED))

/** Preload all foliage GLBs */
for (const ft of FOLIAGE_TYPES) {
  useGLTF.preload(ft.path)
}

// ── Dithering shader injection ──────────────────────────────────────────
// Same dithering logic as the tree fragment shader, injected via onBeforeCompile
// into each foliage GLB material so they respect the reveal circle.

const DITHER_VERTEX_HEADER = /* glsl */ `
varying vec3 vDitherWorldPos;
`

const DITHER_VERTEX_MAIN = /* glsl */ `
vDitherWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
`

const DITHER_FRAGMENT_HEADER = /* glsl */ `
uniform vec3 uDitherCircleCenter;
uniform float uDitherChunkSize;
uniform float uDitherRadiusFactor;
uniform float uDitherFadeOffset;
uniform float uDitherBorderMult;
uniform float uDitherPixSize;
uniform int uDitherModeVal;
uniform sampler2D uDitherNoiseTex;
uniform float uDitherNoiseStr;
uniform float uDitherNoiseScl;
varying vec3 vDitherWorldPos;

float foliageDiamondThreshold(vec2 fc, float ps) {
  vec2 uv = mod(fc + 0.01, ps);
  vec2 c = (uv / ps) * 2.0 - 1.0;
  return (abs(c.x) + abs(c.y)) / 2.0;
}

float foliageBayerThreshold(vec2 fc, float ps) {
  vec2 pc = floor(fc / ps);
  int x = int(mod(pc.x, 8.0));
  int y = int(mod(pc.y, 8.0));
  int M[64];
  M[0]=0;  M[1]=32; M[2]=8;  M[3]=40; M[4]=2;  M[5]=34; M[6]=10; M[7]=42;
  M[8]=48; M[9]=16; M[10]=56;M[11]=24;M[12]=50;M[13]=18;M[14]=58;M[15]=26;
  M[16]=12;M[17]=44;M[18]=4; M[19]=36;M[20]=14;M[21]=46;M[22]=6; M[23]=38;
  M[24]=60;M[25]=28;M[26]=52;M[27]=20;M[28]=62;M[29]=30;M[30]=54;M[31]=22;
  M[32]=3; M[33]=35;M[34]=11;M[35]=43;M[36]=1; M[37]=33;M[38]=9; M[39]=41;
  M[40]=51;M[41]=19;M[42]=59;M[43]=27;M[44]=49;M[45]=17;M[46]=57;M[47]=25;
  M[48]=15;M[49]=47;M[50]=7; M[51]=39;M[52]=13;M[53]=45;M[54]=5; M[55]=37;
  M[56]=63;M[57]=31;M[58]=55;M[59]=23;M[60]=61;M[61]=29;M[62]=53;M[63]=21;
  return float(M[y * 8 + x]) / 64.0;
}
`

const DITHER_FRAGMENT_MAIN = /* glsl */ `
{
  vec2 dwXZ = vDitherWorldPos.xz;
  vec2 dcXZ = uDitherCircleCenter.xz;
  float dDist = length(dwXZ - dcXZ) * uDitherBorderMult;
  vec2 dnUV = dwXZ * uDitherNoiseScl * 0.1;
  float dnVal = texture2D(uDitherNoiseTex, dnUV).r;
  float dnOff = (dnVal * 2.0 - 1.0) * uDitherNoiseStr;
  float dRad = uDitherChunkSize * uDitherRadiusFactor * (1.0 + dnOff);
  float dFade = 1.0 - (1.0 - smoothstep(dRad - uDitherFadeOffset, dRad, dDist));
  if (dFade > 0.0) {
    float dThr;
    if (uDitherModeVal == 0) {
      dThr = foliageDiamondThreshold(gl_FragCoord.xy, uDitherPixSize + 4.0);
    } else {
      dThr = foliageBayerThreshold(gl_FragCoord.xy, uDitherPixSize);
    }
    if (dThr < dFade) discard;
  }
}
`

/** Shared uniform objects — created once, updated by reference each frame */
type DitherUniforms = {
  uDitherCircleCenter: { value: THREE.Vector3 }
  uDitherChunkSize: { value: number }
  uDitherRadiusFactor: { value: number }
  uDitherFadeOffset: { value: number }
  uDitherBorderMult: { value: number }
  uDitherPixSize: { value: number }
  uDitherModeVal: { value: number }
  uDitherNoiseTex: { value: THREE.Texture | null }
  uDitherNoiseStr: { value: number }
  uDitherNoiseScl: { value: number }
}

function patchMaterialWithDither(mat: THREE.Material, uniforms: DitherUniforms) {
  const m = mat as THREE.MeshStandardMaterial
  m.onBeforeCompile = (shader) => {
    // Inject shared dither uniforms
    shader.uniforms.uDitherCircleCenter = uniforms.uDitherCircleCenter
    shader.uniforms.uDitherChunkSize = uniforms.uDitherChunkSize
    shader.uniforms.uDitherRadiusFactor = uniforms.uDitherRadiusFactor
    shader.uniforms.uDitherFadeOffset = uniforms.uDitherFadeOffset
    shader.uniforms.uDitherBorderMult = uniforms.uDitherBorderMult
    shader.uniforms.uDitherPixSize = uniforms.uDitherPixSize
    shader.uniforms.uDitherModeVal = uniforms.uDitherModeVal
    shader.uniforms.uDitherNoiseTex = uniforms.uDitherNoiseTex
    shader.uniforms.uDitherNoiseStr = uniforms.uDitherNoiseStr
    shader.uniforms.uDitherNoiseScl = uniforms.uDitherNoiseScl

    // Vertex: add world-position varying
    shader.vertexShader = DITHER_VERTEX_HEADER + shader.vertexShader
    shader.vertexShader = shader.vertexShader.replace(
      '#include <project_vertex>',
      DITHER_VERTEX_MAIN + '\n#include <project_vertex>',
    )

    // Fragment: add dithering discard
    shader.fragmentShader = DITHER_FRAGMENT_HEADER + shader.fragmentShader
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <dithering_fragment>',
      DITHER_FRAGMENT_MAIN + '\n#include <dithering_fragment>',
    )
  }
  m.customProgramCacheKey = () => 'foliage-dither'
  m.needsUpdate = true
}

interface FoliageProps {
  activeChunks: { x: number; z: number; key: string }[]
  chunkSize: number
  noise2D: (x: number, y: number) => number
  stoneParameters: any
  terrainScale: number
  terrainAmplitude: number
  /** Tree material uniforms — shared by reference for dithering sync */
  treeMaterialUniforms: Record<string, { value: any }>
  noiseTexture: THREE.Texture
}

export default function Foliage({
  activeChunks,
  chunkSize,
  noise2D,
  stoneParameters,
  terrainScale,
  terrainAmplitude,
  treeMaterialUniforms,
  noiseTexture,
}: FoliageProps) {
  // Load all GLB scenes
  const models = new Map<string, THREE.Group>()
  for (const ft of FOLIAGE_TYPES) {
    const { scene } = useGLTF(ft.path)
    models.set(ft.id, scene)
  }

  // Build shared dithering uniforms by referencing tree material's uniform objects
  const ditherUniforms = useMemo<DitherUniforms>(() => {
    const u = treeMaterialUniforms
    return {
      uDitherCircleCenter: u.uCircleCenter,
      uDitherChunkSize: u.uChunkSize,
      uDitherRadiusFactor: u.uCircleRadiusFactor,
      uDitherFadeOffset: u.uGrassFadeOffset,
      uDitherBorderMult: u.uBorderTreesMultiplier,
      uDitherPixSize: u.uPixelSize,
      uDitherModeVal: u.uDitherMode,
      uDitherNoiseTex: u.uNoiseTexture ?? { value: noiseTexture },
      uDitherNoiseStr: u.uNoiseStrength,
      uDitherNoiseScl: u.uNoiseScale,
    }
  }, [treeMaterialUniforms, noiseTexture])

  // Generate foliage instances for all active chunks
  const allInstances = useMemo(() => {
    if (!activeChunks || activeChunks.length === 0) return new Map<string, { position: THREE.Vector3; scale: number; rotY: number }[]>()

    const byType = new Map<string, { position: THREE.Vector3; scale: number; rotY: number }[]>()
    for (const ft of FOLIAGE_TYPES) {
      byType.set(ft.id, [])
    }

    for (const chunk of activeChunks) {
      const occupied: [number, number, number][] = []

      const instances = generateChunkFoliage(
        chunk.x,
        chunk.z,
        chunkSize,
        noise2D,
        { scale: terrainScale, amplitude: terrainAmplitude },
        FOLIAGE_TYPES,
        {
          count: FOLIAGE_COUNT_PER_CHUNK,
          noiseScale: FOLIAGE_NOISE_SCALE,
          noiseThreshold: FOLIAGE_NOISE_THRESHOLD,
          padding: FOLIAGE_PADDING,
          minSpacing: FOLIAGE_MIN_SPACING,
          occupied,
        }
      )

      const originX = chunk.x * chunkSize
      const originZ = chunk.z * chunkSize

      for (const inst of instances) {
        const list = byType.get(inst.typeId)
        if (list) {
          list.push({
            position: new THREE.Vector3(inst.localX + originX, inst.y, inst.localZ + originZ),
            scale: inst.scale,
            rotY: inst.rotY,
          })
        }
      }
    }

    return byType
  }, [activeChunks, chunkSize, noise2D, terrainScale, terrainAmplitude])

  return (
    <group>
      {FOLIAGE_TYPES.map((ft) => {
        const instances = allInstances.get(ft.id) ?? []
        const scene = models.get(ft.id)
        if (!scene || instances.length === 0) return null
        return (
          <FoliageTypeRenderer
            key={ft.id}
            scene={scene}
            instances={instances}
            ditherUniforms={ditherUniforms}
          />
        )
      })}
    </group>
  )
}

/** Renders all instances of a single foliage type with wind sway + shader dithering reveal */
function FoliageTypeRenderer({
  scene,
  instances,
  ditherUniforms,
}: {
  scene: THREE.Group
  instances: { position: THREE.Vector3; scale: number; rotY: number }[]
  ditherUniforms: DitherUniforms
}) {
  const groupRef = useRef<THREE.Group>(null!)
  const patchedMatsRef = useRef<THREE.Material[]>([])

  const clones = useMemo(() => {
    const patched: THREE.Material[] = []
    const result = instances.slice(0, MAX_INSTANCES_PER_TYPE).map((inst) => {
      const clone = SkeletonUtils.clone(scene)
      // Clone and patch each mesh's material with dithering
      clone.traverse((child) => {
        const mesh = child as THREE.Mesh
        if (!mesh.isMesh) return
        if (Array.isArray(mesh.material)) {
          mesh.material = mesh.material.map((m) => {
            const cloned = m.clone()
            patchMaterialWithDither(cloned, ditherUniforms)
            patched.push(cloned)
            return cloned
          })
        } else {
          const cloned = mesh.material.clone()
          patchMaterialWithDither(cloned, ditherUniforms)
          patched.push(cloned)
          mesh.material = cloned
        }
      })
      return { clone, ...inst }
    })
    patchedMatsRef.current = patched
    return result
  }, [scene, instances, ditherUniforms])

  // Dispose patched materials on unmount
  useEffect(() => {
    return () => {
      for (const mat of patchedMatsRef.current) mat.dispose()
      patchedMatsRef.current = []
    }
  }, [clones])

  useFrame(({ clock }) => {
    if (!groupRef.current) return

    const state = useStore.getState()
    const { speed: windSpeed, strength: windStrength, direction: windDir } = state.windParameters
    const t = clock.elapsedTime
    const children = groupRef.current.children

    for (let i = 0; i < children.length && i < clones.length; i++) {
      const child = children[i]
      const inst = clones[i]
      if (!child || !inst) continue

      // ── WIND SWAY ──
      const wx = inst.position.x
      const wz = inst.position.z
      const phase = (wx * 0.37 + wz * 0.71) * 2.0
      const gust = windNoise2D(wx * 0.05 + t * 0.3, wz * 0.05) * 0.5 + 0.5
      const swayAmount = windStrength * 0.12 * (1 + gust * 0.5)
      const swayAngle = Math.sin(t * windSpeed * 1.2 + phase) * swayAmount
      child.rotation.x = swayAngle * Math.sin(windDir)
      child.rotation.z = swayAngle * Math.cos(windDir)
      child.rotation.y = inst.rotY
    }
  })

  return (
    <group ref={groupRef}>
      {clones.map((c, i) => (
        <primitive
          key={i}
          object={c.clone}
          position={[c.position.x, c.position.y, c.position.z]}
          rotation={[0, c.rotY, 0]}
          scale={[c.scale, c.scale, c.scale]}
        />
      ))}
    </group>
  )
}
