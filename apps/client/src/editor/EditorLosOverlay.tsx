import { useMemo } from 'react'
import * as THREE from 'three'
import { buildPlacementColliders, type PlacementLike } from '@clawfield/shared'
import useEditorStore from './useEditorStore'
import { getTerrainHeight } from './EditorTerrain'

function intersectRayDisc(
  ox: number,
  oz: number,
  dx: number,
  dz: number,
  maxDist: number,
  cx: number,
  cz: number,
  r: number,
): number {
  const a = dx * dx + dz * dz
  if (a < 1e-8) return Infinity

  const fx = ox - cx
  const fz = oz - cz
  const rr = Math.max(0.05, r)
  const b = 2 * (fx * dx + fz * dz)
  const c = fx * fx + fz * fz - rr * rr
  const disc = b * b - 4 * a * c
  if (disc < 0) return Infinity

  const sqrtDisc = Math.sqrt(disc)
  const t1 = (-b - sqrtDisc) / (2 * a)
  const t2 = (-b + sqrtDisc) / (2 * a)
  const t = t1 >= 0 ? t1 : (t2 >= 0 ? t2 : Infinity)
  if (t < 0 || t > maxDist) return Infinity
  return t
}

export default function EditorLosOverlay() {
  const enabled = useEditorStore((s) => s.showLosProbe)
  const placements = useEditorStore((s) => s.placements)
  const origin = useEditorStore((s) => s.losProbeOrigin)
  const aim = useEditorStore((s) => s.losProbeAim)
  const range = useEditorStore((s) => s.losProbeRange)
  const fovDeg = useEditorStore((s) => s.losProbeFovDeg)

  const colliders = useMemo(() => {
    const placementLike: PlacementLike[] = placements.map((p) => ({
      componentId: p.assetId,
      position: p.position,
      scale: p.scale,
      metadata: p.metadata,
    }))
    return buildPlacementColliders(placementLike)
  }, [placements])

  const coneData = useMemo(() => {
    if (!enabled || !origin || !aim) return null

    const ox = origin[0]
    const oz = origin[2]
    const oy = getTerrainHeight(ox, oz) + 0.08

    const dx = aim[0] - ox
    const dz = aim[2] - oz
    const baseYaw = Math.atan2(dx, dz)
    const rays = 72
    const halfFov = THREE.MathUtils.degToRad(Math.max(5, Math.min(175, fovDeg))) * 0.5

    const perimeter: THREE.Vector3[] = []
    for (let i = 0; i <= rays; i++) {
      const t = i / rays
      const a = baseYaw - halfFov + t * (halfFov * 2)
      const dirX = Math.sin(a)
      const dirZ = Math.cos(a)

      let d = Math.max(2, range)
      for (const c of colliders) {
        const hit = intersectRayDisc(ox, oz, dirX, dirZ, d, c.x, c.z, c.r)
        if (hit < d) d = hit
      }

      const px = ox + dirX * d
      const pz = oz + dirZ * d
      const py = getTerrainHeight(px, pz) + 0.08
      perimeter.push(new THREE.Vector3(px, py, pz))
    }

    const verts: number[] = [ox, oy, oz]
    for (const p of perimeter) {
      verts.push(p.x, p.y, p.z)
    }

    const indices: number[] = []
    for (let i = 1; i < perimeter.length; i++) {
      indices.push(0, i, i + 1)
    }

    const edgeVerts: number[] = []
    for (const p of perimeter) {
      edgeVerts.push(p.x, p.y + 0.02, p.z)
    }

    return {
      coneVerts: new Float32Array(verts),
      coneIndices: new Uint16Array(indices),
      edgeVerts: new Float32Array(edgeVerts),
      origin: [ox, oy, oz] as [number, number, number],
    }
  }, [enabled, origin, aim, range, fovDeg, colliders])

  if (!enabled || !coneData) return null

  return (
    <group renderOrder={900}>
      <mesh>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[coneData.coneVerts, 3]} />
          <bufferAttribute attach="index" args={[coneData.coneIndices, 1]} />
        </bufferGeometry>
        <meshBasicMaterial color="#6fd9ff" transparent opacity={0.24} depthWrite={false} toneMapped={false} side={THREE.DoubleSide} />
      </mesh>

      <line>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[coneData.edgeVerts, 3]} />
        </bufferGeometry>
        <lineBasicMaterial color="#9ce8ff" transparent opacity={0.86} depthWrite={false} toneMapped={false} />
      </line>

      <mesh position={coneData.origin}>
        <sphereGeometry args={[0.22, 8, 8]} />
        <meshBasicMaterial color="#9ce8ff" transparent opacity={0.92} depthWrite={false} toneMapped={false} />
      </mesh>
    </group>
  )
}
