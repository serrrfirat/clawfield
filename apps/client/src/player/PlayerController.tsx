import { useRef, useMemo, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { RigidBody, BallCollider } from '@react-three/rapier'
import type { RapierRigidBody } from '@react-three/rapier'
import {
  inputToVelocity,
  aimDirection,
  createTerrainHeight,
  WEAPONS,
  WeaponId,
  JUMP_VELOCITY,
  GRAVITY,
  GRENADE_THROW_SPEED,
  SMOKE_GRENADE_THROW_SPEED,
  PLAYER_HEIGHT,
  buildHeightmapObstacleDiscs,
  resolveDiscObstacleCollision,
  DEFAULT_HEIGHTMAP_CONFIG,
} from '@clawfield/shared'
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
import { sampleHeightDelta } from '../editor/heightmap-utils'

const BALL_RADIUS = 0.4
const MAX_AIM_DISTANCE = 45

function solveBallisticPitch(horizontalDistance: number, deltaY: number, speed: number): number {
  const d = Math.max(0.001, horizontalDistance)
  const g = Math.abs(GRAVITY)
  const v2 = speed * speed
  const rootTerm = v2 * v2 - g * (g * d * d + 2 * deltaY * v2)

  if (rootTerm > 0) {
    const root = Math.sqrt(rootTerm)
    const tanTheta = (v2 - root) / (g * d)
    return Math.max(0.22, Math.atan(tanTheta))
  }

  return Math.max(0.22, Math.atan2(deltaY, d))
}

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
  const grenadeEquipUntilRef = useRef(0)
  /** Cursor world position for AimCursor — updated each frame via .copy() */
  const cursorWorldPosRef = useRef(new THREE.Vector3())
  /** Player world position for AimCursor — updated each frame via .set() */
  const playerWorldPosRef = useRef(new THREE.Vector3(0, 5, 0))

  const setBallPosition = useStore((s) => s.setBallPosition)
  const setSmoothedCircleCenter = useStore((s) => s.setSmoothedCircleCenter)
  const setLandBallDistance = useStore((s) => s.setLandBallDistance)
  const consumeRespawnPosition = useStore((s: any) => s.consumeRespawnPosition)
  const matchConfig = useStore((s: any) => s.matchConfig)
  const mapTerrain = useStore((s: any) => s.mapTerrain)
  const connected = useStore((s: any) => s.connected)
  const placementColliders = useStore((s: any) => s.placementColliders)
  const obstacleDiscsFromServer = useStore((s: any) => s.obstacleDiscs)
  const alive = useStore((s) => s.alive)
  const downed = useStore((s) => s.downed)
  const reloading = useStore((s) => s.reloading)
  const weaponName = useStore((s: any) => s.weaponName)
  const [displayWeaponName, setDisplayWeaponName] = useState<string>(weaponName ?? 'Rifle')

  const heightGetter = useMemo(
    () => {
      const scale = matchConfig?.terrain?.scale ?? mapTerrain?.scale
      const amplitude = matchConfig?.terrain?.amplitude ?? mapTerrain?.amplitude
      const seed = matchConfig?.seed ?? mapTerrain?.seed
      const base = createTerrainHeight(scale, amplitude, seed)
      const heightmap = mapTerrain?.heightmap
      if (!heightmap?.cells?.length) return base

      const byKey: Record<string, number> = {}
      for (const c of heightmap.cells) {
        byKey[`${c.x},${c.z}`] = c.h
      }
      return (wx: number, wz: number) => base(wx, wz) + sampleHeightDelta(wx, wz, heightmap.cellSize, byKey)
    },
    [matchConfig?.terrain?.scale, matchConfig?.terrain?.amplitude, matchConfig?.seed, mapTerrain],
  )

  const obstacleDiscs = useMemo(() => {
    if (connected) {
      return obstacleDiscsFromServer ?? []
    }
    const cfg = matchConfig ?? DEFAULT_HEIGHTMAP_CONFIG
    return [...buildHeightmapObstacleDiscs(cfg), ...(placementColliders ?? [])]
  }, [
    connected,
    obstacleDiscsFromServer,
    matchConfig?.seed,
    matchConfig?.terrain?.scale,
    matchConfig?.terrain?.amplitude,
    matchConfig?.bounds?.minX,
    matchConfig?.bounds?.maxX,
    matchConfig?.bounds?.minZ,
    matchConfig?.bounds?.maxZ,
    placementColliders,
  ])

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
    // Keep this aggressive enough to avoid cross-client drift while still
    // smoothing small jitter from network cadence.
    const authoritativePos = (useStore.getState() as any).authoritativePosition as Vec3 | null
    if (authoritativePos) {
      const current = rb.translation()
      const dx = authoritativePos.x - current.x
      const dz = authoritativePos.z - current.z
      const horizontalDistSq = dx * dx + dz * dz

      // Large divergence: snap now.
      if (horizontalDistSq > 2.25) {
        rb.setTranslation({ x: authoritativePos.x, y: current.y, z: authoritativePos.z }, true)
      } else if (horizontalDistSq > 0.0004) {
        // Small/medium divergence: move toward server each frame, capped.
        const horizontalDist = Math.sqrt(horizontalDistSq)
        const alpha = 0.6
        const maxStep = 12 * clamped
        const desiredStep = horizontalDist * alpha
        const step = Math.min(maxStep, desiredStep)
        const invDist = 1 / Math.max(horizontalDist, 1e-6)
        rb.setTranslation(
          {
            x: current.x + dx * invDist * step,
            y: current.y,
            z: current.z + dz * invDist * step,
          },
          true,
        )
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

    let resolvedX = resolved.x
    let resolvedZ = resolved.z
    const playerY = newBodyY - BALL_RADIUS

    if (connected && obstacleDiscs.length > 0) {
      const corrected = resolveDiscObstacleCollision(
        { x: resolvedX, y: playerY, z: resolvedZ },
        BALL_RADIUS,
        obstacleDiscs,
      )
      resolvedX = corrected.x
      resolvedZ = corrected.z
    }

    rb.setTranslation({ x: resolvedX, y: newBodyY, z: resolvedZ }, true)

    // ── 3. Update posRef (ball-center Y for camera/shooting/store) ──
    posRef.current = { x: resolvedX, y: playerY, z: resolvedZ }

    // ── 4. Camera + input ──
    camera.update(posRef.current, clamped)
    const aimYaw = camera.getAimYaw(posRef.current)
    inputCapture.aimYaw = aimYaw
    inputCapture.yaw = aimYaw
    const input = inputCapture.consume()

    const grenadeVisualName = inputCapture.selectedGrenadeIndex === 1 ? 'smoke grenade' : 'frag grenade'
    const showGrenadeInHand = inputCapture.grenadeRadialMenuOpen || performance.now() < grenadeEquipUntilRef.current
    const desiredDisplayWeaponName = showGrenadeInHand ? grenadeVisualName : (weaponName ?? 'Rifle')
    if (desiredDisplayWeaponName !== displayWeaponName) {
      setDisplayWeaponName(desiredDisplayWeaponName)
    }

    // Update mutable positions for AimCursor (must mutate in-place, not reassign)
    {
      const raw = camera.getCursorWorldPos()
      const aimDx = raw.x - resolvedX
      const aimDz = raw.z - resolvedZ
      const aimDistance = Math.sqrt(aimDx * aimDx + aimDz * aimDz)

      if (aimDistance > MAX_AIM_DISTANCE && aimDistance > 1e-5) {
        const t = MAX_AIM_DISTANCE / aimDistance
        cursorWorldPosRef.current.set(
          resolvedX + aimDx * t,
          raw.y,
          resolvedZ + aimDz * t,
        )
      } else {
        cursorWorldPosRef.current.copy(raw)
      }
    }
    playerWorldPosRef.current.set(resolvedX, playerY, resolvedZ)

    if (!alive) {
      // Still update camera/store but skip movement
      const pos3 = new THREE.Vector3(resolvedX, playerY, resolvedZ)
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
      const muzzleOriginX = resolvedX
      const muzzleOriginZ = resolvedZ
      const muzzleY = playerY + eyeOffset

      const dx = cursorWP.x - muzzleOriginX
      const dz = cursorWP.z - muzzleOriginZ
      const dy = cursorWP.y - muzzleY
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz)
      const shootRange = Math.max(1, Math.min(MAX_AIM_DISTANCE, dist))

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

    if (input.throwGrenade) {
      grenadeEquipUntilRef.current = performance.now() + 450
      const eyeOffset = PLAYER_HEIGHT - 0.1
      const eyePos: Vec3 = {
        x: resolvedX,
        y: playerY + eyeOffset,
        z: resolvedZ,
      }
      const target = cursorWorldPosRef.current
      const throwDx = target.x - eyePos.x
      const throwDz = target.z - eyePos.z
      const horizontalDistance = Math.sqrt(throwDx * throwDx + throwDz * throwDz)
      const isSmokeGrenade = (input.grenadeIndex ?? 0) === 1
      const throwSpeed = isSmokeGrenade ? SMOKE_GRENADE_THROW_SPEED : GRENADE_THROW_SPEED
      const minArcPitch = isSmokeGrenade ? 0.45 : 0.22
      const throwPitch = Math.max(
        minArcPitch,
        solveBallisticPitch(horizontalDistance, target.y - eyePos.y, throwSpeed),
      )
      input.pitch = throwPitch

      const dir = aimDirection(aimYaw, throwPitch)
      const throwVelocity: Vec3 = {
        x: dir.x * throwSpeed,
        y: dir.y * throwSpeed,
        z: dir.z * throwSpeed,
      }

      if (combatSystems.grenades) {
        if (isSmokeGrenade) {
          // Smoke grenade motion/collision is server-authoritative.
          // Avoid local predicted smoke flight to prevent client/server divergence visuals.
        } else {
          combatSystems.grenades.spawnLocal(eyePos, throwVelocity)
        }
      }
    }

    // ── Derive animation state ──
    const vel = rb.linvel()
    const speed = Math.sqrt(vel.x * vel.x + vel.z * vel.z)
    soldierRef.current?.setAnimState(deriveAnimState(input, alive, downed, reloading, shootingRef.current, speed))

    // Update store for terrain chunks to follow
    const pos3 = new THREE.Vector3(resolvedX, playerY, resolvedZ)
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
          <SoldierModel ref={soldierRef} weaponName={displayWeaponName} />
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
