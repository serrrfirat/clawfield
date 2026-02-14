import { useMemo, useEffect } from 'react'
import { useTexture } from '@react-three/drei'
import * as THREE from 'three'
import type { RoadSpline } from '../editor/editor-types'

const ROAD_TEXTURE_URLS = {
  road_1: '/textures/roads/road_1.png',
  road_2: '/textures/roads/road_2.png',
} as const

interface RoadLayerProps {
  roads: RoadSpline[]
  heightGetter: (x: number, z: number) => number
}

function buildRoadGeometry(road: RoadSpline, heightGetter: (x: number, z: number) => number): THREE.BufferGeometry | null {
  if (!road.points || road.points.length < 2) return null

  const curvePoints = road.points.map(([x, z]) => new THREE.Vector3(x, 0, z))
  const curve = new THREE.CatmullRomCurve3(curvePoints, false, 'centripetal', 0.5)
  const segments = Math.max(16, road.points.length * 18)
  const width = Math.max(0.5, road.width)
  const halfWidth = width * 0.5

  const positions: number[] = []
  const normals: number[] = []
  const uvs: number[] = []
  const indices: number[] = []

  let accLen = 0
  let prev = curve.getPoint(0)

  for (let i = 0; i <= segments; i++) {
    const t = i / segments
    const p = curve.getPoint(t)
    const tangent = curve.getTangent(t)
    const lateral = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize()

    if (i > 0) accLen += p.distanceTo(prev)
    prev = p

    const yCenter = heightGetter(p.x, p.z) + 0.02
    const leftX = p.x + lateral.x * halfWidth
    const leftZ = p.z + lateral.z * halfWidth
    const rightX = p.x - lateral.x * halfWidth
    const rightZ = p.z - lateral.z * halfWidth

    const yLeft = heightGetter(leftX, leftZ) + 0.02
    const yRight = heightGetter(rightX, rightZ) + 0.02

    positions.push(leftX, Math.max(yCenter, yLeft), leftZ)
    positions.push(rightX, Math.max(yCenter, yRight), rightZ)

    normals.push(0, 1, 0)
    normals.push(0, 1, 0)

    const v = accLen / Math.max(1, width * 1.4)
    uvs.push(0, v)
    uvs.push(1, v)
  }

  for (let i = 0; i < segments; i++) {
    const a = i * 2
    const b = a + 1
    const c = a + 2
    const d = a + 3
    indices.push(a, b, c)
    indices.push(b, d, c)
  }

  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  geo.setIndex(indices)
  geo.computeBoundingSphere()
  return geo
}

function RoadMesh({ road, texture, heightGetter }: { road: RoadSpline; texture: THREE.Texture; heightGetter: (x: number, z: number) => number }) {
  const geometry = useMemo(() => buildRoadGeometry(road, heightGetter), [road, heightGetter])

  if (!geometry) return null

  return (
    <mesh geometry={geometry} renderOrder={4}>
      <meshStandardMaterial map={texture} transparent={false} polygonOffset polygonOffsetFactor={-2} polygonOffsetUnits={-2} />
    </mesh>
  )
}

export default function RoadLayer({ roads, heightGetter }: RoadLayerProps) {
  const textures = useTexture([ROAD_TEXTURE_URLS.road_1, ROAD_TEXTURE_URLS.road_2])
  const texById = useMemo(() => ({ road_1: textures[0], road_2: textures[1] }), [textures])

  useEffect(() => {
    for (const tex of textures) {
      tex.wrapS = THREE.RepeatWrapping
      tex.wrapT = THREE.RepeatWrapping
      tex.anisotropy = 8
      tex.needsUpdate = true
    }
  }, [textures])

  if (!roads?.length) return null

  return (
    <group>
      {roads.map((road) => {
        const tex = texById[road.textureId] ?? texById.road_1
        return <RoadMesh key={road.id} road={road} texture={tex} heightGetter={heightGetter} />
      })}
    </group>
  )
}
