import { useRef, useMemo } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'

interface AimCursorProps {
  cursorWorldPos: THREE.Vector3
  playerPos: { x: number; y: number; z: number }
  weaponRange?: number
  teamColor?: number
  visible?: boolean
}

export default function AimCursor({ cursorWorldPos, playerPos, weaponRange = 50, teamColor, visible = true }: AimCursorProps) {
  const groupRef = useRef<THREE.Group>(null!)

  // Create crosshair line geometries
  const crosshairLines = useMemo(() => {
    const lines: { start: THREE.Vector3; end: THREE.Vector3 }[] = []
    const lineLen = 0.8
    const lineGap = 0.5
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

  useFrame(() => {
    if (!groupRef.current || !visible) return

    groupRef.current.position.set(cursorWorldPos.x, playerPos.y + 0.05, cursorWorldPos.z)

    if (ringRef.current) {
      ringRef.current.position.set(
        playerPos.x - cursorWorldPos.x,
        0,
        playerPos.z - cursorWorldPos.z,
      )
      ringRef.current.scale.setScalar(weaponRange)
    }
  })

  if (!visible) return null

  return (
    <group ref={groupRef} renderOrder={999}>
      {/* Central dot */}
      <mesh rotation-x={-Math.PI / 2}>
        <circleGeometry args={[0.3, 16]} />
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
      <line ref={ringRef}>
        <primitive object={ringGeo} attach="geometry" />
        <lineBasicMaterial color={0xffffff} transparent opacity={0.15} depthTest={false} />
      </line>
    </group>
  )
}
