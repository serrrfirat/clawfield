import { useRef, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import type { PlayerState } from '@clawfield/shared'
import { StateInterpolator } from './interpolation'
import SoldierModel from './SoldierModel'
import type { SoldierModelHandle } from './SoldierModel'
import { deriveRemoteAnimState } from './animation-state'

interface RemotePlayerEntityProps {
  state: PlayerState
  team: number
}

const TEAM_COLORS = [0x4488ff, 0xff6644] // Alpha=blue, Bravo=red

export default function RemotePlayerEntity({ state, team }: RemotePlayerEntityProps) {
  const groupRef = useRef<THREE.Group>(null!)
  const soldierRef = useRef<SoldierModelHandle>(null!)
  const interpolator = useMemo(() => new StateInterpolator(), [])
  const lastKey = useRef('')
  const prevPosRef = useRef<THREE.Vector3>(new THREE.Vector3())
  const prevTimeRef = useRef(0)

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
    groupRef.current.visible = state.alive || state.downed

    // Compute velocity from position deltas for animation derivation
    const now = performance.now()
    const dtMs = now - prevTimeRef.current
    let speed = 0
    let moveAngle: number | undefined
    if (dtMs > 0 && dtMs < 500) {
      const dtSec = dtMs / 1000
      const dx = result.position.x - prevPosRef.current.x
      const dz = result.position.z - prevPosRef.current.z
      speed = Math.sqrt(dx * dx + dz * dz) / dtSec
      if (speed > 0.5) {
        moveAngle = Math.atan2(dx, dz)
      }
    }
    prevPosRef.current.set(result.position.x, result.position.y, result.position.z)
    prevTimeRef.current = now

    // Derive and set animation state
    soldierRef.current?.setAnimState(deriveRemoteAnimState(state, speed, moveAngle))
  })

  const color = TEAM_COLORS[team] ?? 0x888888

  return (
    <group ref={groupRef}>
      <SoldierModel ref={soldierRef} teamColor={color} />
    </group>
  )
}
