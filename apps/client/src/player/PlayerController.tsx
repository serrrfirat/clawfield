import { useRef, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { RigidBody, BallCollider } from '@react-three/rapier'
import type { RapierRigidBody } from '@react-three/rapier'
import { inputToVelocity, createTerrainHeight, WEAPONS, WeaponId, JUMP_VELOCITY, GRAVITY, PLAYER_HEIGHT } from '@clawfield/shared'
import type { Vec3 } from '@clawfield/shared'

import { TopDownInputCapture } from './TopDownInput'
import { useTopDownCamera } from './useTopDownCamera'
import { useNetwork } from '../network/NetworkProvider'
import useStore from '../stores/useStore'
import { combatSystems } from '../combat/CombatEffects'
import { soundManager, SoundId } from '../audio/sound-manager'
import SoldierModel from './SoldierModel'
import type { SoldierModelHandle } from './SoldierModel'
import { SOLDIER_MODEL_Y_OFFSET } from './model-offset'
import { AnimState, deriveAnimState } from './animation-state'
import AimCursor from './AimCursor'

const heightGetter = createTerrainHeight()
const BALL_RADIUS = 0.4

/** Default weapon for client-predicted projectiles */
const DEFAULT_WEAPON = WEAPONS[WeaponId.AssaultRifle]

export default function PlayerController() {
  const inputCapture = useMemo(() => new TopDownInputCapture(), [])
  const camera = useTopDownCamera()
  const network = useNetwork()

  const posRef = useRef<Vec3>({ x: 0, y: 5, z: 0 })
  const vyRef = useRef(0)
  const groundedRef = useRef(true)
  const rigidBodyRef = useRef<RapierRigidBody>(null!)
  const meshRef = useRef<THREE.Group>(null!)
  const soldierRef = useRef<SoldierModelHandle>(null!)
  const seqRef = useRef(0)
  /** Fire rate limiter — tracks last shot time */
  const lastShotRef = useRef(0)
  /** Tracks whether we're actively shooting (for anim derivation) */
  const shootingRef = useRef(false)
  /** Cursor world position for AimCursor — updated each frame via .copy() */
  const cursorWorldPosRef = useRef(new THREE.Vector3())
  /** Player world position for AimCursor — updated each frame via .set() */
  const playerWorldPosRef = useRef(new THREE.Vector3(0, 5, 0))

  const setBallPosition = useStore((s) => s.setBallPosition)
  const setSmoothedCircleCenter = useStore((s) => s.setSmoothedCircleCenter)
  const setLandBallDistance = useStore((s) => s.setLandBallDistance)
  const consumeRespawnPosition = useStore((s: any) => s.consumeRespawnPosition)
  const alive = useStore((s) => s.alive)
  const downed = useStore((s) => s.downed)
  const reloading = useStore((s) => s.reloading)

  useFrame((_, dt) => {
    if (!rigidBodyRef.current) return

    const clamped = Math.min(dt, 0.1)
    const rb = rigidBodyRef.current

    // Apply server-authoritative spawn position on respawn.
    const respawnPos = consumeRespawnPosition?.()
    if (respawnPos) {
      rb.setTranslation(
        { x: respawnPos.x, y: respawnPos.y + BALL_RADIUS, z: respawnPos.z },
        true
      )
      rb.setLinvel({ x: 0, y: 0, z: 0 }, true)
      vyRef.current = 0
      groundedRef.current = false
      posRef.current = { ...respawnPos }
    }

    // Reconcile local predicted position to server-authoritative position.
    // Only snap on massive divergence (teleport/respawn). Gentle correction is
    // disabled until proper ack-based reconciliation is wired up — without it
    // the server position (which lags by one RTT) fights local prediction and
    // causes rubberbanding.
    const authoritativePos = (useStore.getState() as any).authoritativePosition as Vec3 | null
    if (authoritativePos) {
      const current = rb.translation()
      const dx = authoritativePos.x - current.x
      const dz = authoritativePos.z - current.z
      const horizontalDistSq = dx * dx + dz * dz

      // Big divergence only (>8m): snap immediately (teleport/respawn).
      if (horizontalDistSq > 64) {
        rb.setTranslation({ x: authoritativePos.x, y: current.y, z: authoritativePos.z }, true)
      }
    }

    // ── 1. Read collision-resolved position from last physics step ──
    const resolved = rb.translation()

    // ── 2. Vertical movement: gravity + jump + terrain snap ──
    const terrainY = heightGetter(resolved.x, resolved.z)
    const groundLevel = terrainY + BALL_RADIUS

    // Apply gravity to vertical velocity
    vyRef.current += GRAVITY * clamped

    // Advance Y by vertical velocity
    let newBodyY = resolved.y + vyRef.current * clamped

    // Ground check: if we've reached or passed terrain, snap and land
    if (newBodyY <= groundLevel) {
      newBodyY = groundLevel
      vyRef.current = 0
      groundedRef.current = true
    } else {
      groundedRef.current = false
    }

    rb.setTranslation({ x: resolved.x, y: newBodyY, z: resolved.z }, true)

    // ── 3. Update posRef (ball-center Y for camera/shooting/store) ──
    const playerY = newBodyY - BALL_RADIUS
    posRef.current = { x: resolved.x, y: playerY, z: resolved.z }

    // ── 4. Camera + input ──
    camera.update(posRef.current, clamped)
    const aimYaw = camera.getAimYaw(posRef.current)
    inputCapture.aimYaw = aimYaw
    inputCapture.yaw = aimYaw
    const input = inputCapture.consume()

    // Update mutable positions for AimCursor (must mutate in-place, not reassign)
    cursorWorldPosRef.current.copy(camera.getCursorWorldPos())
    playerWorldPosRef.current.set(resolved.x, playerY, resolved.z)

    if (!alive) {
      // Still update camera/store but skip movement
      const pos3 = new THREE.Vector3(resolved.x, playerY, resolved.z)
      setBallPosition(pos3)
      setSmoothedCircleCenter(pos3)
      setLandBallDistance(Math.abs(playerY - terrainY))

      // Derive death anim
      const vel = rb.linvel()
      const speed = Math.sqrt(vel.x * vel.x + vel.z * vel.z)
      soldierRef.current?.setAnimState(deriveAnimState(input, alive, downed, reloading, false, speed))
      return
    }

    // ── 5. Jump: apply upward velocity when grounded ──
    if (input.jump && groundedRef.current) {
      vyRef.current = JUMP_VELOCITY
      groundedRef.current = false
    }

    // ── 6. Set XZ velocity for next physics step (Rapier resolves collisions) ──
    const desiredVel = inputToVelocity(input, aimYaw)
    rb.setLinvel({ x: desiredVel.x, y: vyRef.current, z: desiredVel.z }, true)

    // Update mesh rotation (position is driven by RigidBody parent)
    if (meshRef.current) {
      meshRef.current.rotation.y = -aimYaw
    }

    // ── Shooting: spawn client-predicted projectile toward crosshair ──
    const now = performance.now()
    const fireInterval = 60000 / DEFAULT_WEAPON.rpm // ms between shots
    shootingRef.current = false
    if (input.shoot && now - lastShotRef.current >= fireInterval) {
      lastShotRef.current = now
      shootingRef.current = true

      // Match server eye offset: playerY (feet) + PLAYER_HEIGHT - 0.1
      const eyeOffset = PLAYER_HEIGHT - 0.1
      const cursorWP = cursorWorldPosRef.current

      // Direction from muzzle origin to cursor ground position
      const muzzleOriginX = resolved.x
      const muzzleOriginZ = resolved.z
      const muzzleY = playerY + eyeOffset

      const dx = cursorWP.x - muzzleOriginX
      const dz = cursorWP.z - muzzleOriginZ
      const dy = cursorWP.y - muzzleY
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz)
      const shootRange = Math.max(1, dist) // minimum 1m range

      // Normalize direction toward cursor
      let dirX: number, dirY: number, dirZ: number
      if (dist > 0.01) {
        dirX = dx / dist
        dirY = dy / dist
        dirZ = dz / dist
      } else {
        dirX = Math.sin(aimYaw)
        dirY = 0
        dirZ = -Math.cos(aimYaw)
      }

      // Offset muzzle slightly forward from player center
      const muzzlePos: Vec3 = {
        x: muzzleOriginX + dirX * 0.7,
        y: muzzleY + dirY * 0.7,
        z: muzzleOriginZ + dirZ * 0.7,
      }

      if (combatSystems.projectiles) {
        combatSystems.projectiles.spawnLocal(
          muzzlePos,
          { x: dirX, y: dirY, z: dirZ },
          DEFAULT_WEAPON.projectileSpeed,
          shootRange,
          { x: cursorWP.x, y: cursorWP.y, z: cursorWP.z },
        )
      }

      // Layered weapon sound: main crack + bass punch + delayed tail
      const shotPitch = 0.94 + Math.random() * 0.12
      soundManager.play(SoundId.ShootRifle, { pitch: shotPitch })
      setTimeout(() => soundManager.play(SoundId.ShootBass, { pitch: 0.9 + Math.random() * 0.2, volume: 0.35 }), 10)
      setTimeout(() => soundManager.play(SoundId.ShootTail, { pitch: 0.92 + Math.random() * 0.16, volume: 0.2 }), 50)
    }

    // ── Derive animation state ──
    const vel = rb.linvel()
    const speed = Math.sqrt(vel.x * vel.x + vel.z * vel.z)
    soldierRef.current?.setAnimState(deriveAnimState(input, alive, downed, reloading, shootingRef.current, speed))

    // Update store for terrain chunks to follow
    const pos3 = new THREE.Vector3(resolved.x, playerY, resolved.z)
    setBallPosition(pos3)
    setSmoothedCircleCenter(pos3)
    setLandBallDistance(Math.abs(playerY - terrainY))

    // Send input to server
    seqRef.current++
    network?.send({
      type: 'input',
      seq: seqRef.current,
      input,
      dt: clamped,
    })
  })

  return (
    <>
      <RigidBody
        ref={rigidBodyRef}
        type="dynamic"
        gravityScale={0}
        lockRotations
        canSleep={false}
        position={[0, 5, 0]}
        linearDamping={0}
        colliders={false}
        ccd
      >
        <BallCollider args={[0.4]} />
        <group ref={meshRef} position={[0, SOLDIER_MODEL_Y_OFFSET, 0]}>
          <SoldierModel ref={soldierRef} />
        </group>
      </RigidBody>
      <AimCursor
        cursorWorldPos={cursorWorldPosRef.current}
        playerPos={playerWorldPosRef.current}
        visible={alive}
      />
    </>
  )
}
