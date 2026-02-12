import { useRef, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { RigidBody, BallCollider } from '@react-three/rapier'
import type { RapierRigidBody } from '@react-three/rapier'
import { inputToVelocity, createTerrainHeight, WEAPONS, WeaponId, JUMP_VELOCITY, GRAVITY } from '@clawfield/shared'
import type { Vec3 } from '@clawfield/shared'

import { TopDownInputCapture } from './TopDownInput'
import { useTopDownCamera } from './useTopDownCamera'
import { useNetwork } from '../network/NetworkProvider'
import useStore from '../stores/useStore'
import { combatSystems } from '../combat/CombatEffects'
import { soundManager, SoundId } from '../audio/sound-manager'

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
  const weaponRef = useRef<THREE.Mesh>(null!)
  const seqRef = useRef(0)
  /** Fire rate limiter — tracks last shot time */
  const lastShotRef = useRef(0)

  const setBallPosition = useStore((s) => s.setBallPosition)
  const setSmoothedCircleCenter = useStore((s) => s.setSmoothedCircleCenter)
  const setLandBallDistance = useStore((s) => s.setLandBallDistance)
  const alive = useStore((s) => s.alive)

  useFrame((_, dt) => {
    if (!alive) return
    if (!rigidBodyRef.current) return

    const clamped = Math.min(dt, 0.1)
    const rb = rigidBodyRef.current

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

    // ── Shooting: spawn client-predicted projectile ──
    const now = performance.now()
    const fireInterval = 60000 / DEFAULT_WEAPON.rpm // ms between shots
    if (input.shoot && now - lastShotRef.current >= fireInterval) {
      lastShotRef.current = now

      const shootDirX = Math.sin(aimYaw)
      const shootDirZ = -Math.cos(aimYaw)

      const muzzlePos: Vec3 = {
        x: resolved.x + shootDirX * 0.7,
        y: playerY + 0.5,
        z: resolved.z + shootDirZ * 0.7,
      }

      if (combatSystems.projectiles) {
        combatSystems.projectiles.spawnLocal(
          muzzlePos,
          { x: shootDirX, y: 0, z: shootDirZ },
          DEFAULT_WEAPON.projectileSpeed,
          DEFAULT_WEAPON.maxRange,
        )
      }

      soundManager.play(SoundId.ShootRifle)
    }

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
      <group ref={meshRef}>
        {/* Player body - sphere */}
        <mesh castShadow>
          <sphereGeometry args={[0.4, 16, 16]} />
          <meshStandardMaterial color="#4488ff" />
        </mesh>

        {/* Weapon indicator - box pointing forward (toward aimYaw) */}
        <mesh ref={weaponRef} position={[0, 0.1, -0.7]} castShadow>
          <boxGeometry args={[0.1, 0.1, 0.6]} />
          <meshStandardMaterial color="#333333" />
        </mesh>
      </group>
    </RigidBody>
  )
}
