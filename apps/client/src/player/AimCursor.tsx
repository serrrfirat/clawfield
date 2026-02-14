import { useRef, useMemo } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import type { CollisionDisc } from '@clawfield/shared'

interface AimCursorProps {
  cursorWorldPos: THREE.Vector3
  playerPos: { x: number; y: number; z: number }
  aimOriginPos?: { x: number; y: number; z: number }
  weaponRange?: number
  teamColor?: number
  visible?: boolean
  obstacleDiscs?: CollisionDisc[]
}

const CONE_HALF_ANGLE = THREE.MathUtils.degToRad(9)
const CONE_RAY_SAMPLES = 18

function rayDiscHitDistance(ox: number, oz: number, dx: number, dz: number, disc: CollisionDisc): number | null {
  const lx = ox - disc.x
  const lz = oz - disc.z
  const b = 2 * (dx * lx + dz * lz)
  const c = lx * lx + lz * lz - disc.r * disc.r
  const discriminant = b * b - 4 * c
  if (discriminant < 0) return null

  const sqrt = Math.sqrt(discriminant)
  const t1 = (-b - sqrt) * 0.5
  const t2 = (-b + sqrt) * 0.5
  if (t1 > 0) return t1
  if (t2 > 0) return t2
  return null
}

export default function AimCursor({ cursorWorldPos, playerPos, aimOriginPos, weaponRange = 50, teamColor, visible = true, obstacleDiscs = [] }: AimCursorProps) {
  const groupRef = useRef<THREE.Group>(null!)
  const coneMeshRef = useRef<THREE.Mesh>(null!)

  // Create crosshair line geometries
  const crosshairLines = useMemo(() => {
    const lines: { start: THREE.Vector3; end: THREE.Vector3 }[] = []
    const lineLen = 0.3
    const lineGap = 0.15
    for (let i = 0; i < 4; i++) {
      const angle = (i * Math.PI) / 2
      const cos = Math.cos(angle)
      const sin = Math.sin(angle)
      lines.push({
        start: new THREE.Vector3(cos * lineGap, 0, sin * lineGap),
        end: new THREE.Vector3(cos * (lineGap + lineLen), 0, sin * (lineGap + lineLen)),
      })
    }
    return lines
  }, [])

  // Range ring geometry
  const ringGeo = useMemo(() => {
    const segments = 64
    const pts = new Float32Array((segments + 1) * 3)
    for (let i = 0; i <= segments; i++) {
      const a = (i / segments) * Math.PI * 2
      pts[i * 3] = Math.cos(a)
      pts[i * 3 + 1] = 0
      pts[i * 3 + 2] = Math.sin(a)
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(pts, 3))
    return geo
  }, [])

  const ringRef = useRef<THREE.Line>(null!)
  const coneGeo = useMemo(() => {
    const geo = new THREE.BufferGeometry()
    const positions = new Float32Array((CONE_RAY_SAMPLES + 2) * 3)
    const indices = new Uint16Array(CONE_RAY_SAMPLES * 3)
    for (let i = 0; i < CONE_RAY_SAMPLES; i++) {
      indices[i * 3 + 0] = 0
      indices[i * 3 + 1] = i + 1
      indices[i * 3 + 2] = i + 2
    }
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geo.setIndex(new THREE.BufferAttribute(indices, 1))
    return geo
  }, [])

  const coneMat = useMemo(
    () => new THREE.MeshBasicMaterial({ color: teamColor ?? 0xffffff, transparent: true, opacity: 0.11, depthWrite: false, depthTest: false, side: THREE.DoubleSide }),
    [teamColor],
  )

  useFrame(() => {
    if (!groupRef.current || !visible) return

    const origin = aimOriginPos ?? playerPos
    const planeY = cursorWorldPos.y + 0.05

    groupRef.current.position.set(cursorWorldPos.x, planeY, cursorWorldPos.z)

    if (ringRef.current) {
      ringRef.current.position.set(
        origin.x - cursorWorldPos.x,
        0,
        origin.z - cursorWorldPos.z,
      )
      ringRef.current.scale.setScalar(weaponRange)
    }

    const coneMesh = coneMeshRef.current
    if (!coneMesh) return

    const dx = cursorWorldPos.x - origin.x
    const dz = cursorWorldPos.z - origin.z
    const aimLen = Math.sqrt(dx * dx + dz * dz)
    if (aimLen < 1e-4) {
      coneMesh.visible = false
      return
    }

    const dirX = dx / aimLen
    const dirZ = dz / aimLen
    let clippedRange = weaponRange

    for (let i = 0; i < obstacleDiscs.length; i++) {
      const o = obstacleDiscs[i]
      const ox = origin.x - o.x
      const oz = origin.z - o.z
      if (ox * ox + oz * oz < (o.r * o.r)) continue
      const hit = rayDiscHitDistance(origin.x, origin.z, dirX, dirZ, o)
      if (hit !== null && hit < clippedRange) clippedRange = hit
    }

    clippedRange = Math.max(0.6, clippedRange - 0.1)
    const attr = coneGeo.getAttribute('position') as THREE.BufferAttribute
    attr.setXYZ(0, origin.x, planeY - 0.02, origin.z)

    const heading = Math.atan2(dirZ, dirX)
    for (let i = 0; i <= CONE_RAY_SAMPLES; i++) {
      const t = i / CONE_RAY_SAMPLES
      const angle = heading - CONE_HALF_ANGLE + t * (CONE_HALF_ANGLE * 2)
      const rayDx = Math.cos(angle)
      const rayDz = Math.sin(angle)

      let rayRange = clippedRange
      for (let j = 0; j < obstacleDiscs.length; j++) {
        const o = obstacleDiscs[j]
        const ox = origin.x - o.x
        const oz = origin.z - o.z
        if (ox * ox + oz * oz < (o.r * o.r)) continue
        const hit = rayDiscHitDistance(origin.x, origin.z, rayDx, rayDz, o)
        if (hit !== null && hit < rayRange) rayRange = hit
      }

      rayRange = Math.max(0.6, rayRange - 0.08)
      attr.setXYZ(
        i + 1,
        origin.x + rayDx * rayRange,
        planeY - 0.02,
        origin.z + rayDz * rayRange,
      )
    }

    attr.needsUpdate = true
    coneGeo.computeBoundingSphere()
    coneMesh.visible = true
  })

  if (!visible) return null

  return (
    <>
      <mesh ref={coneMeshRef} geometry={coneGeo} material={coneMat} renderOrder={995} />
      <group ref={groupRef} renderOrder={999}>
      {/* Central dot */}
      <mesh rotation-x={-Math.PI / 2}>
        <circleGeometry args={[0.1, 12]} />
        <meshBasicMaterial
          color={teamColor ?? 0xffffff}
          transparent
          opacity={0.85}
          depthTest={false}
          side={THREE.DoubleSide}
        />
      </mesh>

      {/* Crosshair lines */}
      {crosshairLines.map((line, i) => (
        <line key={i}>
          <bufferGeometry>
            <bufferAttribute
              attach="attributes-position"
              count={2}
              array={new Float32Array([
                line.start.x, line.start.y, line.start.z,
                line.end.x, line.end.y, line.end.z,
              ])}
              itemSize={3}
            />
          </bufferGeometry>
          <lineBasicMaterial color={0xffffff} transparent opacity={0.6} depthTest={false} />
        </line>
      ))}

      {/* Range ring */}
      <line ref={ringRef as any}>
        <primitive object={ringGeo} attach="geometry" />
        <lineBasicMaterial color={0xffffff} transparent opacity={0.15} depthTest={false} />
      </line>
      </group>
    </>
  )
}
