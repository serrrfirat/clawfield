import { useEffect, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import type { PlayerState } from '@clawfield/shared'
import SoldierModel from './SoldierModel'
import type { SoldierModelHandle } from './SoldierModel'
import { AnimState, deriveRemoteAnimState } from './animation-state'
import { StateInterpolator } from './interpolation'
import { SOLDIER_MODEL_Y_OFFSET } from './model-offset'

interface RemotePlayerEntityProps {
  state: PlayerState
  team: number
}

const TEAM_COLORS = [0x4488ff, 0xff6644] // Alpha=blue, Bravo=red

export default function RemotePlayerEntity({ state, team }: RemotePlayerEntityProps) {
  const color = TEAM_COLORS[team] ?? 0x888888
  const soldierRef = useRef<SoldierModelHandle>(null)
  const groupRef = useRef<THREE.Group>(null)
  const interpolatorRef = useRef(new StateInterpolator())
  const prevPosRef = useRef({ ...state.position })
  const prevTimeRef = useRef(performance.now())

  useEffect(() => {
    interpolatorRef.current.push(state)
  }, [state])

  useFrame(() => {
    const interp = interpolatorRef.current.getInterpolated()
    if (!interp || !groupRef.current) return

    // StateInterpolator already buffers and smooths network snapshots.
    // Keep transform authoritative to avoid extra render-lag when aiming at targets.
    groupRef.current.position.set(
      interp.position.x,
      interp.position.y,
      interp.position.z,
    )
    groupRef.current.rotation.set(0, -interp.yaw, 0)
  })

  useEffect(() => {
    const latest = interpolatorRef.current.latestState ?? state
    const now = performance.now()
    const prev = prevPosRef.current
    const dt = Math.max((now - prevTimeRef.current) / 1000, 1 / 120)

    const dx = latest.position.x - prev.x
    const dz = latest.position.z - prev.z
    const speed = Math.sqrt(dx * dx + dz * dz) / dt
    const moveAngle = speed > 0.01 ? Math.atan2(dx, dz) : undefined

    soldierRef.current?.setAnimState(deriveRemoteAnimState(latest, speed, moveAngle))

    prevPosRef.current = { ...latest.position }
    prevTimeRef.current = now
  }, [
    state.position.x,
    state.position.y,
    state.position.z,
    state.yaw,
    state.alive,
    state.downed,
    state.reloading,
    state.shooting,
  ])

  if (!state.alive && !state.downed) return null

  return (
    <group ref={groupRef}>
      <group position={[0, SOLDIER_MODEL_Y_OFFSET, 0]}>
        <SoldierModel
          ref={soldierRef}
          initialAnimState={AnimState.Idle}
          teamColor={color}
          weaponName={state.weaponName}
        />
      </group>
    </group>
  )
}
