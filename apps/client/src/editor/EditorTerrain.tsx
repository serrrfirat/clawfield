import { useState, useMemo, useEffect } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { createSeededNoise2D } from '../world/utils/worldNoise'
import StylizedWaterPlane from '../world/StylizedWaterPlane'
import useEditorStore from './useEditorStore'
import { sampleHeightDelta } from './heightmap-utils'

const ENABLE_STYLIZED_WATER = (import.meta.env.VITE_ENABLE_STYLIZED_WATER ?? '0') === '1'

const CHUNK_SIZE = 10
const SEGMENTS = 16
const GRID_RADIUS = 2 // 5x5 grid
const noiseBySeed = new Map<number, ReturnType<typeof createSeededNoise2D>>()

function getNoise(seed: number) {
  const existing = noiseBySeed.get(seed)
  if (existing) return existing
  const next = createSeededNoise2D(seed)
  noiseBySeed.set(seed, next)
  return next
}

/** Get terrain height at a world position (for placing objects) */
export function getTerrainHeight(wx: number, wz: number): number {
  const s = useEditorStore.getState()
  const noise = getNoise(s.terrainSeed)
  const base = noise(wx * s.terrainScale, wz * s.terrainScale) * s.terrainAmplitude
  const delta = sampleHeightDelta(wx, wz, s.heightCellSize, s.heightCells)
  return base + delta
}

function EditorTerrainChunk({ cx, cz }: { cx: number; cz: number }) {
  const terrainSeed = useEditorStore((s) => s.terrainSeed)
  const terrainScale = useEditorStore((s) => s.terrainScale)
  const terrainAmplitude = useEditorStore((s) => s.terrainAmplitude)
  const heightCellSize = useEditorStore((s) => s.heightCellSize)
  const heightCells = useEditorStore((s) => s.heightCells)
  const heightRevision = useEditorStore((s) => s.heightRevision)

  const geometry = useMemo(() => {
    const noise2D = getNoise(terrainSeed)
    const geo = new THREE.PlaneGeometry(CHUNK_SIZE, CHUNK_SIZE, SEGMENTS, SEGMENTS)
    const posAttr = geo.attributes.position
    const worldX0 = cx * CHUNK_SIZE
    const worldZ0 = cz * CHUNK_SIZE

    for (let i = 0; i < posAttr.count; i++) {
      const wx = posAttr.getX(i) + worldX0
      const wz = -posAttr.getY(i) + worldZ0
      const base = noise2D(wx * terrainScale, wz * terrainScale) * terrainAmplitude
      const delta = sampleHeightDelta(wx, wz, heightCellSize, heightCells)
      posAttr.setZ(i, base + delta)
    }
    geo.computeVertexNormals()
    return geo
  }, [cx, cz, terrainSeed, terrainScale, terrainAmplitude, heightCellSize, heightCells, heightRevision])

  useEffect(() => () => geometry.dispose(), [geometry])

  return (
    <mesh
      geometry={geometry as any}
      rotation-x={-Math.PI / 2}
      position={[cx * CHUNK_SIZE, 0, cz * CHUNK_SIZE]}
      userData={{ editorTerrain: true }}
    >
      <meshStandardMaterial color={'#908343'} flatShading />
    </mesh>
  )
}

export default function EditorTerrain() {
  const waterLevel = useEditorStore((s) => s.waterLevel)
  const [chunks, setChunks] = useState(() => {
    const list: { cx: number; cz: number; key: string }[] = []
    for (let x = -GRID_RADIUS; x <= GRID_RADIUS; x++) {
      for (let z = -GRID_RADIUS; z <= GRID_RADIUS; z++) {
        list.push({ cx: x, cz: z, key: `${x},${z}` })
      }
    }
    return list
  })

  const lastCenter = useMemo(() => ({ x: 0, z: 0 }), [])

  useFrame(() => {
    const [tx, , tz] = useEditorStore.getState().cameraTarget
    const ncx = Math.round(tx / CHUNK_SIZE)
    const ncz = Math.round(tz / CHUNK_SIZE)
    if (ncx !== lastCenter.x || ncz !== lastCenter.z) {
      lastCenter.x = ncx
      lastCenter.z = ncz
      const newChunks: { cx: number; cz: number; key: string }[] = []
      for (let x = -GRID_RADIUS; x <= GRID_RADIUS; x++) {
        for (let z = -GRID_RADIUS; z <= GRID_RADIUS; z++) {
          const cx = ncx + x
          const cz = ncz + z
          newChunks.push({ cx, cz, key: `${cx},${cz}` })
        }
      }
      setChunks(newChunks)
    }
  })

  return (
    <group>
      {ENABLE_STYLIZED_WATER && <StylizedWaterPlane waterLevel={waterLevel} size={1400} />}
      {chunks.map((c) => (
        <EditorTerrainChunk key={c.key} cx={c.cx} cz={c.cz} />
      ))}
    </group>
  )
}
