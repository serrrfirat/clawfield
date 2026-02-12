import { useState, useMemo, useEffect } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { sharedNoise2D } from '../world/utils/worldNoise'
import useEditorStore from './useEditorStore'

const CHUNK_SIZE = 10
const SEGMENTS = 16
const TERRAIN_SCALE = 0.05
const TERRAIN_AMPLITUDE = 2
const GRID_RADIUS = 2 // 5x5 grid

/** Get terrain height at a world position (for placing objects) */
export function getTerrainHeight(wx: number, wz: number): number {
  return sharedNoise2D(wx * TERRAIN_SCALE, wz * TERRAIN_SCALE) * TERRAIN_AMPLITUDE
}

function EditorTerrainChunk({ cx, cz }: { cx: number; cz: number }) {
  const geometry = useMemo(() => {
    const geo = new THREE.PlaneGeometry(CHUNK_SIZE, CHUNK_SIZE, SEGMENTS, SEGMENTS)
    const posAttr = geo.attributes.position
    const worldX0 = cx * CHUNK_SIZE
    const worldZ0 = cz * CHUNK_SIZE

    for (let i = 0; i < posAttr.count; i++) {
      const wx = posAttr.getX(i) + worldX0
      const wz = -posAttr.getY(i) + worldZ0
      posAttr.setZ(i, sharedNoise2D(wx * TERRAIN_SCALE, wz * TERRAIN_SCALE) * TERRAIN_AMPLITUDE)
    }
    geo.computeVertexNormals()
    return geo
  }, [cx, cz])

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
      {chunks.map((c) => (
        <EditorTerrainChunk key={c.key} cx={c.cx} cz={c.cz} />
      ))}
    </group>
  )
}
