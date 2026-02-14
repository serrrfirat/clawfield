import { useMemo, useRef, useEffect, memo } from 'react'
import { useGLTF } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { SkeletonUtils } from 'three-stdlib'
import { createNoise2D } from 'simplex-noise'
import { generateChunkFoliage, type FoliageType } from './utils/foliageUtils'
import useStore from '../stores/useStore'
import { mulberry32 } from './utils/randomUtils'
import {
  type DitherUniforms,
  linkDitherUniformsFromTreeUniforms,
  patchMaterialWithDither,
} from '../render/dither-reveal'
import { computeWindSwayEuler } from '../render/wind-sway'

/**
 * Foliage types to scatter. Each references a GLB in public/models/props/natural/.
 * Weight controls relative frequency.
 */
const FOLIAGE_TYPES: (FoliageType & { path: string })[] = [
  // Natural
  { id: 'bushes', path: '/models/props/natural/Bushes.glb', weight: 3, minScale: 0.5, maxScale: 1.0 },
  { id: 'fern', path: '/models/props/natural/Fern.glb', weight: 2, minScale: 0.5, maxScale: 1.0 },
  { id: 'flower-group', path: '/models/props/natural/Flower Group.glb', weight: 2, minScale: 0.4, maxScale: 0.9 },
  { id: 'flowers', path: '/models/props/natural/Flowers.glb', weight: 2, minScale: 0.5, maxScale: 1.0 },
  { id: 'mushroom', path: '/models/props/natural/Mushroom.glb', weight: 1, minScale: 0.3, maxScale: 0.7 },
  // France countryside
  { id: 'lavender', path: '/models/props/france/Lavender 3D Model.glb', weight: 3, minScale: 0.02, maxScale: 0.05 },
  { id: 'sunflower', path: '/models/props/france/Sunflower 3D Model.glb', weight: 2, minScale: 0.02, maxScale: 0.04, cluster: [5, 10], clusterSpread: 1.2 },
  { id: 'sunflower-small', path: '/models/props/france/Sunflower 3D Model (1).glb', weight: 2, minScale: 0.03, maxScale: 0.06, cluster: [5, 8], clusterSpread: 1.0 },
]

const FOLIAGE_COUNT_PER_CHUNK = 8
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
  // Load all GLB scenes (useGLTF caches internally, hook order is constant)
  const modelsRef = useRef(new Map<string, THREE.Group>())
  for (const ft of FOLIAGE_TYPES) {
    const { scene } = useGLTF(ft.path)
    modelsRef.current.set(ft.id, scene)
  }

  // Build shared dithering uniforms by referencing tree material's uniform objects
  const ditherUniforms = useMemo<DitherUniforms>(() => {
    return linkDitherUniformsFromTreeUniforms(treeMaterialUniforms, noiseTexture)
  }, [treeMaterialUniforms, noiseTexture])

  return (
    <group>
      {activeChunks.map((chunk) => (
        <FoliageChunk
          key={chunk.key}
          chunkX={chunk.x}
          chunkZ={chunk.z}
          chunkSize={chunkSize}
          noise2D={noise2D}
          terrainScale={terrainScale}
          terrainAmplitude={terrainAmplitude}
          models={modelsRef.current}
          ditherUniforms={ditherUniforms}
        />
      ))}
    </group>
  )
}

/**
 * Per-chunk foliage renderer.
 * Keyed by chunk coordinates so React preserves instances across activeChunks changes.
 * Only chunks that actually enter/leave the 3x3 grid get mounted/unmounted.
 */
const FoliageChunk = memo(function FoliageChunkInner({
  chunkX,
  chunkZ,
  chunkSize,
  noise2D,
  terrainScale,
  terrainAmplitude,
  models,
  ditherUniforms,
}: {
  chunkX: number
  chunkZ: number
  chunkSize: number
  noise2D: (x: number, y: number) => number
  terrainScale: number
  terrainAmplitude: number
  models: Map<string, THREE.Group>
  ditherUniforms: DitherUniforms
}) {
  // Generate foliage for THIS chunk only (deps are all primitives → stable)
  const instancesByType = useMemo(() => {
    const occupied: [number, number, number][] = []
    const instances = generateChunkFoliage(
      chunkX, chunkZ, chunkSize, noise2D,
      { scale: terrainScale, amplitude: terrainAmplitude },
      FOLIAGE_TYPES,
      {
        count: FOLIAGE_COUNT_PER_CHUNK,
        noiseScale: FOLIAGE_NOISE_SCALE,
        noiseThreshold: FOLIAGE_NOISE_THRESHOLD,
        padding: FOLIAGE_PADDING,
        minSpacing: FOLIAGE_MIN_SPACING,
        occupied,
      },
    )

    const originX = chunkX * chunkSize
    const originZ = chunkZ * chunkSize

    const byType = new Map<string, { position: THREE.Vector3; scale: number; rotY: number }[]>()
    for (const inst of instances) {
      let list = byType.get(inst.typeId)
      if (!list) { list = []; byType.set(inst.typeId, list) }
      list.push({
        position: new THREE.Vector3(inst.localX + originX, inst.y, inst.localZ + originZ),
        scale: inst.scale,
        rotY: inst.rotY,
      })
    }
    return byType
  }, [chunkX, chunkZ, chunkSize, noise2D, terrainScale, terrainAmplitude])

  return (
    <group>
      {FOLIAGE_TYPES.map((ft) => {
        const instances = instancesByType.get(ft.id)
        const scene = models.get(ft.id)
        if (!scene || !instances || instances.length === 0) return null
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
})

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
    const {
      speed: windSpeed,
      strength: windStrength,
      direction: windDir,
      globalMultiplier = 1,
    } = state.windParameters
    const t = clock.elapsedTime
    const children = groupRef.current.children

    for (let i = 0; i < children.length && i < clones.length; i++) {
      const child = children[i]
      const inst = clones[i]
      if (!child || !inst) continue

      // ── WIND SWAY ──
      const sway = computeWindSwayEuler(
        inst.position,
        t,
        { speed: windSpeed, strength: windStrength * globalMultiplier, direction: windDir },
        windNoise2D,
      )
      child.rotation.x = sway.x
      child.rotation.z = sway.z
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
