import { useEffect, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import type { CollisionDisc, PlayerState } from '@clawfield/shared'
import SoldierModel from './SoldierModel'
import type { SoldierModelHandle } from './SoldierModel'
import { AnimState, deriveRemoteAnimState } from './animation-state'
import { StateInterpolator } from './interpolation'
import { SOLDIER_MODEL_Y_OFFSET } from './model-offset'
import useStore from '../stores/useStore'

interface RemotePlayerEntityProps {
  state: PlayerState
  team: number
}

const TEAM_COLORS = [0x4488ff, 0xff6644] // Alpha=blue, Bravo=red
const VISIBILITY_FOV_DEGREES = 185
const VISIBILITY_FOV_COS = Math.cos((VISIBILITY_FOV_DEGREES * Math.PI) / 360)
const LOS_FADE_IN_SPEED = 7.5
const LOS_FADE_OUT_SPEED = 4.2
const LOS_MEMORY_MS = 1200

function setGroupOpacity(group: THREE.Group, alpha: number): void {
  const clamped = Math.max(0, Math.min(1, alpha))
  group.traverse((obj) => {
    const mesh = obj as THREE.Mesh
    if (!mesh.isMesh || !mesh.material) return

    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    for (const mat of mats) {
      const basic = mat as THREE.Material & { opacity?: number; transparent?: boolean; userData?: Record<string, any> }
      if (typeof basic.opacity !== 'number') continue
      if (!basic.userData) basic.userData = {}
      if (typeof basic.userData.baseOpacity !== 'number') {
        basic.userData.baseOpacity = basic.opacity
      }
      const baseOpacity = Number(basic.userData.baseOpacity)
      basic.transparent = clamped < 0.999
      basic.opacity = baseOpacity * clamped
      basic.needsUpdate = true
    }
  })
}

function segmentBlockedByDisc(ox: number, oz: number, tx: number, tz: number, disc: CollisionDisc): boolean {
  const dx = tx - ox
  const dz = tz - oz
  const segLenSq = dx * dx + dz * dz
  if (segLenSq < 1e-6) return false

  const t = ((disc.x - ox) * dx + (disc.z - oz) * dz) / segLenSq
  if (t <= 0 || t >= 1) return false

  const closestX = ox + dx * t
  const closestZ = oz + dz * t
  const cx = disc.x - closestX
  const cz = disc.z - closestZ
  const distSq = cx * cx + cz * cz

  return distSq <= disc.r * disc.r
}

export default function RemotePlayerEntity({ state, team }: RemotePlayerEntityProps) {
  const color = TEAM_COLORS[team] ?? 0x888888
  const soldierRef = useRef<SoldierModelHandle>(null)
  const groupRef = useRef<THREE.Group>(null)
  const bodyGroupRef = useRef<THREE.Group>(null)
  const memoryMarkerRef = useRef<THREE.Mesh>(null)
  const interpolatorRef = useRef(new StateInterpolator())
  const prevPosRef = useRef({ ...state.position })
  const prevTimeRef = useRef(performance.now())
  const visibilityAlphaRef = useRef(1)
  const memoryUntilRef = useRef(0)

  useEffect(() => {
    interpolatorRef.current.push(state)
  }, [state])

  useFrame((_, dt) => {
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

    const store = useStore.getState() as any
    const localPos = store.ballPosition as THREE.Vector3 | undefined
    const localAimYaw = Number(store.localAimYaw ?? 0)
    const obstacleDiscs = (store.obstacleDiscs ?? []) as CollisionDisc[]

    let fullyVisible = true

    if (localPos) {
      const ox = localPos.x
      const oz = localPos.z
      const tx = interp.position.x
      const tz = interp.position.z
      const toX = tx - ox
      const toZ = tz - oz
      const distSq = toX * toX + toZ * toZ
      if (distSq >= 0.03) {
        const dist = Math.sqrt(distSq)
        const forwardX = Math.sin(localAimYaw)
        const forwardZ = -Math.cos(localAimYaw)
        const dot = (toX * forwardX + toZ * forwardZ) / dist
        fullyVisible = dot >= VISIBILITY_FOV_COS

        if (fullyVisible) {
          for (let i = 0; i < obstacleDiscs.length; i++) {
            const o = obstacleDiscs[i]
            const sourceInside = (ox - o.x) * (ox - o.x) + (oz - o.z) * (oz - o.z) <= o.r * o.r
            const targetInside = (tx - o.x) * (tx - o.x) + (tz - o.z) * (tz - o.z) <= o.r * o.r
            if (sourceInside || targetInside) continue
            if (segmentBlockedByDisc(ox, oz, tx, tz, o)) {
              fullyVisible = false
              break
            }
          }
        }
      }
    }

    const now = performance.now()
    if (fullyVisible) {
      memoryUntilRef.current = now + LOS_MEMORY_MS
    }

    const inMemory = now < memoryUntilRef.current
    const targetAlpha = fullyVisible ? 1 : inMemory ? 0.22 : 0
    const currentAlpha = visibilityAlphaRef.current
    const speed = targetAlpha > currentAlpha ? LOS_FADE_IN_SPEED : LOS_FADE_OUT_SPEED
    const nextAlpha = THREE.MathUtils.lerp(currentAlpha, targetAlpha, Math.min(1, speed * Math.min(dt, 0.1)))
    visibilityAlphaRef.current = nextAlpha

    const bodyGroup = bodyGroupRef.current
    if (bodyGroup) {
      setGroupOpacity(bodyGroup, nextAlpha)
    }

    const marker = memoryMarkerRef.current
    if (marker) {
      const markerAlpha = fullyVisible ? 0 : Math.max(0, Math.min(1, nextAlpha * 2.8))
      marker.visible = markerAlpha > 0.03
      const mat = marker.material as THREE.MeshBasicMaterial
      mat.opacity = markerAlpha
    }

    groupRef.current.visible = nextAlpha > 0.02
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
      <group ref={bodyGroupRef} position={[0, SOLDIER_MODEL_Y_OFFSET, 0]}>
        <SoldierModel
          ref={soldierRef}
          initialAnimState={AnimState.Idle}
          teamColor={color}
          weaponName={state.weaponName}
        />
      </group>
      <mesh ref={memoryMarkerRef} position={[0, 2.05, 0]} rotation-x={-Math.PI / 2} visible={false}>
        <ringGeometry args={[0.16, 0.24, 24]} />
        <meshBasicMaterial color={color} transparent opacity={0} depthTest={false} />
      </mesh>
    </group>
  )
}
