import { useRef, useMemo, useState, useEffect } from 'react'
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
  FLASH_GRENADE_THROW_SPEED,
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
const AIM_ORIGIN_FORWARD_OFFSET = 0

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

function applyDirectionalSpread(dir: Vec3, spread: number): Vec3 {
  if (spread <= 0) return { ...dir }

  const angle = Math.random() * spread
  const rotation = Math.random() * Math.PI * 2

  let upX = 0
  let upY = 1
  let upZ = 0
  if (Math.abs(dir.y) > 0.99) {
    upX = 1
    upY = 0
    upZ = 0
  }

  const rightX = dir.y * upZ - dir.z * upY
  const rightY = dir.z * upX - dir.x * upZ
  const rightZ = dir.x * upY - dir.y * upX
  const rightLen = Math.sqrt(rightX * rightX + rightY * rightY + rightZ * rightZ)
  if (rightLen < 1e-8) return { ...dir }

  const rx = rightX / rightLen
  const ry = rightY / rightLen
  const rz = rightZ / rightLen

  const ax = ry * dir.z - rz * dir.y
  const ay = rz * dir.x - rx * dir.z
  const az = rx * dir.y - ry * dir.x

  const sinA = Math.sin(angle)
  const cosR = Math.cos(rotation)
  const sinR = Math.sin(rotation)

  const offsetX = sinA * (cosR * rx + sinR * ax)
  const offsetY = sinA * (cosR * ry + sinR * ay)
  const offsetZ = sinA * (cosR * rz + sinR * az)

  const cosA = Math.cos(angle)
  const newX = dir.x * cosA + offsetX
  const newY = dir.y * cosA + offsetY
  const newZ = dir.z * cosA + offsetZ

  const len = Math.sqrt(newX * newX + newY * newY + newZ * newZ)
  if (len < 1e-8) return { ...dir }
  return { x: newX / len, y: newY / len, z: newZ / len }
}

const WEAPON_NAME_TO_ID: Record<string, WeaponId> = {
  rifle: WeaponId.AssaultRifle,
  'assault rifle': WeaponId.AssaultRifle,
  smg: WeaponId.SMG_Assault,
  'medic smg': WeaponId.SMG_Medic,
  shotgun: WeaponId.Shotgun,
  carbine: WeaponId.Carbine,
  pdw: WeaponId.PDW,
  'sniper rifle': WeaponId.SniperRifle,
  dmr: WeaponId.DMR,
  pistol: WeaponId.Pistol,
  'rocket launcher': WeaponId.RocketLauncher,
}

function resolveWeaponForName(weaponName?: string) {
  const normalized = weaponName?.trim().toLowerCase() ?? ''
  const id = WEAPON_NAME_TO_ID[normalized]
  if (!id) return DEFAULT_WEAPON
  return WEAPONS[id] ?? DEFAULT_WEAPON
}

function getVisualEffectiveSpreadForWeapon(
  weapon: { spread: number; adsSpreadMultiplier: number; recoilRandom: number },
  adsActive: boolean,
  bloom: number,
): number {
  const hipSpread = weapon.spread + bloom
  const hipFirePenalty = adsActive ? 1 : 1.4
  const adsMultiplier = adsActive ? weapon.adsSpreadMultiplier : 1
  const recoilChaos = 1 + Math.min(0.75, weapon.recoilRandom * 30)
  const stanceChaos = adsActive ? 1.05 : 1.45
  return hipSpread * hipFirePenalty * adsMultiplier * recoilChaos * stanceChaos
}

/** Default weapon for client-predicted projectiles */
const DEFAULT_WEAPON = WEAPONS[WeaponId.AssaultRifle]

export default function PlayerController() {
  const inputCapture = useMemo(() => new TopDownInputCapture(), [])
  const camera = useTopDownCamera()
  const network = useNetwork()

  useEffect(() => {
    return () => {
      inputCapture.dispose()
    }
  }, [inputCapture])

  const posRef = useRef<Vec3>({ x: 0, y: 5, z: 0 })
  const vyRef = useRef(0)
  const groundedRef = useRef(true)
  const rigidBodyRef = useRef<RapierRigidBody>(null!)
  const meshRef = useRef<THREE.Group>(null!)
  const soldierRef = useRef<SoldierModelHandle>(null!)
  const seqRef = useRef(0)
  /** Fire rate limiter — tracks last shot time */
  const lastShotRef = useRef(0)
  const localBloomRef = useRef(0)
  const prevWeaponNameRef = useRef('')
  /** Tracks whether we're actively shooting (for anim derivation) */
  const shootingRef = useRef(false)
  const grenadeEquipUntilRef = useRef(0)
  /** Cursor world position for AimCursor — updated each frame via .copy() */
  const cursorWorldPosRef = useRef(new THREE.Vector3())
  /** Player world position for AimCursor — updated each frame via .set() */
  const playerWorldPosRef = useRef(new THREE.Vector3(0, 5, 0))
  /** Projected muzzle origin (XZ) used to align LOS cone */
  const aimOriginPosRef = useRef(new THREE.Vector3(0, 5, 0))
  const screenProjectRef = useRef(new THREE.Vector3())

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
  const ammo = useStore((s: any) => s.ammo)
  const weaponName = useStore((s: any) => s.weaponName)
  const [displayWeaponName, setDisplayWeaponName] = useState<string>(weaponName ?? 'Rifle')
  const [adsVisual, setAdsVisual] = useState(false)
  const adsVisualRef = useRef(false)

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

  useFrame((frameState, dt) => {
    if (!rigidBodyRef.current) return

    const clamped = Math.min(dt, 0.1)
    const rb = rigidBodyRef.current
    const activeWeapon = resolveWeaponForName(weaponName)

    if (weaponName !== prevWeaponNameRef.current) {
      localBloomRef.current = 0
      prevWeaponNameRef.current = weaponName ?? ''
    }

    if (localBloomRef.current > 0) {
      localBloomRef.current = Math.max(0, localBloomRef.current - activeWeapon.spreadRecovery * clamped)
    }

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
      localBloomRef.current = 0
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

    {
      const p = screenProjectRef.current
      p.set(resolvedX, playerY + PLAYER_HEIGHT * 0.5, resolvedZ)
      p.project(frameState.camera)
      const xPct = Math.max(0, Math.min(100, (p.x * 0.5 + 0.5) * 100))
      const yPct = Math.max(0, Math.min(100, (-p.y * 0.5 + 0.5) * 100))
      useStore.setState({ localScreenPos: { xPct, yPct } })
    }

    // ── 4. Camera + input ──
    camera.update(posRef.current, clamped)
    const aimYaw = camera.getAimYaw(posRef.current)
    inputCapture.aimYaw = aimYaw
    inputCapture.yaw = aimYaw
    useStore.setState({ localAimYaw: aimYaw })
    const input = inputCapture.consume()
    const aimAdsActive = !!(input.scope && !reloading)
    if (aimAdsActive !== adsVisualRef.current) {
      adsVisualRef.current = aimAdsActive
      setAdsVisual(aimAdsActive)
    }

    useStore.setState({ selectedGrenadeIndex: inputCapture.selectedGrenadeIndex })

    const grenadeVisualName = inputCapture.selectedGrenadeIndex === 1
      ? 'smoke grenade'
      : inputCapture.selectedGrenadeIndex === 2
        ? 'flash grenade'
        : 'frag grenade'
    const showGrenadeInHand = inputCapture.grenadeRadialMenuOpen || performance.now() < grenadeEquipUntilRef.current
    const desiredDisplayWeaponName = showGrenadeInHand ? grenadeVisualName : (weaponName ?? 'Rifle')
    if (desiredDisplayWeaponName !== displayWeaponName) {
      setDisplayWeaponName(desiredDisplayWeaponName)
    }

    const aimOriginX = resolvedX + Math.sin(aimYaw) * AIM_ORIGIN_FORWARD_OFFSET
    const aimOriginZ = resolvedZ - Math.cos(aimYaw) * AIM_ORIGIN_FORWARD_OFFSET

    // Update mutable positions for AimCursor (must mutate in-place, not reassign)
    {
      const raw = camera.getCursorWorldPos()
      const aimDx = raw.x - aimOriginX
      const aimDz = raw.z - aimOriginZ
      const aimDistance = Math.sqrt(aimDx * aimDx + aimDz * aimDz)

      if (aimDistance > MAX_AIM_DISTANCE && aimDistance > 1e-5) {
        const t = MAX_AIM_DISTANCE / aimDistance
        cursorWorldPosRef.current.set(
          aimOriginX + aimDx * t,
          raw.y,
          aimOriginZ + aimDz * t,
        )
      } else {
        cursorWorldPosRef.current.copy(raw)
      }

      const cursorTerrainY = heightGetter(cursorWorldPosRef.current.x, cursorWorldPosRef.current.z)
      cursorWorldPosRef.current.y = cursorTerrainY
    }
    playerWorldPosRef.current.set(resolvedX, playerY, resolvedZ)
    aimOriginPosRef.current.set(aimOriginX, playerY, aimOriginZ)

    if (!alive || downed) {
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
    const fireInterval = 60000 / activeWeapon.rpm // ms between shots
    const canFire = ammo > 0 && !reloading
    shootingRef.current = false
    if (input.shoot && canFire && now - lastShotRef.current >= fireInterval) {
      lastShotRef.current = now
      shootingRef.current = true

      useStore.setState((state: any) => ({
        ammo: Math.max(0, Number(state.ammo ?? 0) - 1),
      }))

      // Match server eye offset: playerY (feet) + PLAYER_HEIGHT - 0.1
      const eyeOffset = PLAYER_HEIGHT - 0.1
      const cursorWP = cursorWorldPosRef.current

      // Direction from muzzle origin to cursor ground position
      const muzzleOriginX = aimOriginX
      const muzzleOriginZ = aimOriginZ
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

      const visualSpread = getVisualEffectiveSpreadForWeapon(activeWeapon, aimAdsActive, localBloomRef.current)
      const spreadDir = applyDirectionalSpread({ x: dirX, y: dirY, z: dirZ }, visualSpread)
      dirX = spreadDir.x
      dirY = spreadDir.y
      dirZ = spreadDir.z
      localBloomRef.current += activeWeapon.spreadBloom

      // Offset muzzle slightly forward from player center
      const muzzlePos: Vec3 = {
        x: muzzleOriginX + dirX * 0.7,
        y: muzzleY + dirY * 0.7,
        z: muzzleOriginZ + dirZ * 0.7,
      }

      const tracerTargetPos: Vec3 = {
        x: muzzlePos.x + dirX * shootRange,
        y: muzzlePos.y + dirY * shootRange,
        z: muzzlePos.z + dirZ * shootRange,
      }

      if (combatSystems.gunSmoke) {
        combatSystems.gunSmoke.spawnBurst(muzzlePos, { x: dirX, y: dirY, z: dirZ })
      }

      if (combatSystems.projectiles) {
        combatSystems.projectiles.spawnLocal(
          muzzlePos,
          { x: dirX, y: dirY, z: dirZ },
          activeWeapon.projectileSpeed,
          shootRange,
          tracerTargetPos,
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
      const grenadeIndex = input.grenadeIndex ?? 0
      const isSmokeGrenade = grenadeIndex === 1
      const isFlashGrenade = grenadeIndex === 2
      const throwSpeed = isSmokeGrenade
        ? SMOKE_GRENADE_THROW_SPEED
        : isFlashGrenade
          ? FLASH_GRENADE_THROW_SPEED
          : GRENADE_THROW_SPEED
      const minArcPitch = isSmokeGrenade ? 0.45 : isFlashGrenade ? 0.34 : 0.22
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
        } else if (isFlashGrenade) {
          // Flash grenade motion/collision is server-authoritative.
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
        aimOriginPos={aimOriginPosRef.current}
        weaponRange={MAX_AIM_DISTANCE}
        adsActive={adsVisual}
        obstacleDiscs={obstacleDiscs}
        visible={alive && !downed}
      />
    </>
  )
}
