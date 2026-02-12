import { useRef, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import type { PlayerState } from '@clawfield/shared'
import { StateInterpolator } from './interpolation'

interface RemotePlayerEntityProps {
  state: PlayerState
  team: number
}

const TEAM_COLORS = [0x4488ff, 0xff6644] // Alpha=blue, Bravo=red

export default function RemotePlayerEntity({ state, team }: RemotePlayerEntityProps) {
  const groupRef = useRef<THREE.Group>(null!)
  const interpolator = useMemo(() => new StateInterpolator(), [])
  const lastKey = useRef('')

  // Push state into interpolator only when position actually changes
  const stateKey = `${state.position.x},${state.position.y},${state.position.z}`
  if (stateKey !== lastKey.current) {
    lastKey.current = stateKey
    interpolator.push(state)
  }

  useFrame(() => {
    const result = interpolator.getInterpolated()
    if (!result || !groupRef.current) return

    groupRef.current.position.set(result.position.x, result.position.y, result.position.z)
    groupRef.current.rotation.y = -result.yaw
    groupRef.current.visible = state.alive
  })

  const color = TEAM_COLORS[team] ?? 0x888888

  return (
    <group ref={groupRef}>
      {/* Player body */}
      <mesh castShadow>
        <sphereGeometry args={[0.4, 16, 16]} />
        <meshStandardMaterial color={color} />
      </mesh>

      {/* Weapon indicator */}
      <mesh position={[0, 0.1, -0.7]} castShadow>
        <boxGeometry args={[0.1, 0.1, 0.6]} />
        <meshStandardMaterial color="#333333" />
      </mesh>
    </group>
  )
}
