import { useRef, useEffect } from 'react'
import { useThree, useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { ProjectileRenderer } from './projectile-renderer'
import { ParticleSystem } from './particle-system'
import { GrenadeRenderer } from './grenade-renderer'
import { GunSmokeSystem } from './gun-smoke-system'
import { ImpactSystem } from './impact-system'
import { BillboardSmokeSystem } from './billboard-smoke-system'
import { ExplosionVFXSystem } from './explosion-vfx'
import { CameraShake } from './camera-shake'
import { soundManager, SoundId } from '../audio/sound-manager'
import useStore from '../stores/useStore'
import { placementDestructionView } from '../world/placement-destruction-view'

/**
 * Global refs to combat systems so PlayerController can spawn local projectiles.
 * Set on mount, cleared on unmount.
 */
export const combatSystems: {
  projectiles: ProjectileRenderer | null
  particles: ParticleSystem | null
  grenades: GrenadeRenderer | null
  gunSmoke: GunSmokeSystem | null
  impacts: ImpactSystem | null
  billboardSmoke: BillboardSmokeSystem | null
  explosionVFX: ExplosionVFXSystem | null
  cameraShake: CameraShake | null
} = {
  projectiles: null,
  particles: null,
  grenades: null,
  gunSmoke: null,
  impacts: null,
  billboardSmoke: null,
  explosionVFX: null,
  cameraShake: null,
}

/**
 * R3F component that wraps imperative Three.js combat renderers.
 * Uses useThree() to get the scene and useFrame() for per-frame updates.
 * Renders nothing declaratively — all visuals are added imperatively to the scene.
 */
export default function CombatEffects() {
  const { scene, camera, gl } = useThree()

  const particles = useRef<ParticleSystem | null>(null)
  const projectiles = useRef<ProjectileRenderer | null>(null)
  const grenades = useRef<GrenadeRenderer | null>(null)
  const gunSmoke = useRef<GunSmokeSystem | null>(null)
  const impacts = useRef<ImpactSystem | null>(null)
  const billboardSmoke = useRef<BillboardSmokeSystem | null>(null)
  const explosionVFX = useRef<ExplosionVFXSystem | null>(null)
  const cameraShakeRef = useRef<CameraShake | null>(null)

  // Initialize combat systems on mount
  useEffect(() => {
    const ps = new ParticleSystem(scene)
    particles.current = ps

    const pr = new ProjectileRenderer(scene)
    pr.setParticleSystem(ps)
    pr.setOnImpact((position, impulse) => {
      placementDestructionView.handleImpact(position, impulse)
    })
    projectiles.current = pr

    const impactSystem = new ImpactSystem(scene)
    impacts.current = impactSystem
    pr.setImpactSystem(impactSystem)

    const gr = new GrenadeRenderer(scene)
    gr.setParticleSystem(ps)
    grenades.current = gr

    const gs = new GunSmokeSystem(scene)
    gunSmoke.current = gs

    const bs = new BillboardSmokeSystem(scene)
    billboardSmoke.current = bs

    const shake = new CameraShake()
    cameraShakeRef.current = shake

    const expVFX = new ExplosionVFXSystem(scene, shake)
    expVFX.setParticleSystem(ps)
    explosionVFX.current = expVFX

    // Expose to other components (e.g. PlayerController for local projectile spawning)
    combatSystems.projectiles = pr
    combatSystems.particles = ps
    combatSystems.grenades = gr
    combatSystems.gunSmoke = gs
    combatSystems.impacts = impactSystem
    combatSystems.billboardSmoke = bs
    combatSystems.explosionVFX = expVFX
    combatSystems.cameraShake = shake
    placementDestructionView.setScene(scene)
    placementDestructionView.setParticleSystem(ps)
    placementDestructionView.setExplosionVFX(expVFX)

    // Initialize audio context on first interaction
    const initAudio = () => {
      soundManager.init()
      soundManager.loadPack('/sounds/gdc/')
      window.removeEventListener('click', initAudio)
      window.removeEventListener('keydown', initAudio)
    }
    window.addEventListener('click', initAudio)
    window.addEventListener('keydown', initAudio)

    return () => {
      combatSystems.projectiles = null
      combatSystems.particles = null
      combatSystems.grenades = null
      combatSystems.gunSmoke = null
      combatSystems.impacts = null
      combatSystems.billboardSmoke = null
      combatSystems.explosionVFX = null
      combatSystems.cameraShake = null
      pr.dispose()
      ps.dispose()
      gr.dispose()
      gs.dispose()
      impactSystem.dispose()
      bs.dispose()
      expVFX.dispose()
      placementDestructionView.setParticleSystem(null)
      placementDestructionView.setExplosionVFX(null)
      placementDestructionView.setScene(null)
      window.removeEventListener('click', initAudio)
      window.removeEventListener('keydown', initAudio)
    }
  }, [scene])

  // Set local player ID when it becomes available
  const myId = useStore((s) => s.myId)
  useEffect(() => {
    if (myId && projectiles.current) {
      projectiles.current.setLocalPlayerId(myId)
    }
  }, [myId])

  // Subscribe to server combat state changes (non-rendering subscriptions)
  useEffect(() => {
    const unsubs = [
      useStore.subscribe(
        (s: any) => s.serverProjectiles,
        (sp: any) => { projectiles.current?.updateFromServer(sp) },
      ),
      useStore.subscribe(
        (s: any) => s.serverGrenades,
        (sg: any) => { grenades.current?.updateFromServer(sg) },
      ),
      useStore.subscribe(
        (s: any) => s.serverSmokeGrenades,
        (sg: any) => { grenades.current?.updateSmokeGrenadesFromServer(sg) },
      ),
      useStore.subscribe(
        (s: any) => s.serverFlashGrenades,
        (sg: any) => { grenades.current?.updateFlashGrenadesFromServer(sg) },
      ),
    ]
    return () => unsubs.forEach((u) => u())
  }, [])

  // Per-frame update: advance all combat systems
  useFrame((_, dt) => {
    const clampedDt = Math.min(dt, 0.1)

    // Process pending explosions from the store
    const store = useStore.getState() as any
    const explosions = store.consumeExplosions()
    for (const exp of explosions) {
      // Use new explosion VFX system instead of old grenade-renderer explosions
      if (explosionVFX.current) {
        const pos = new THREE.Vector3(exp.position.x, exp.position.y, exp.position.z)
        // Infer tier from radius: small for grenades, medium for larger
        const tier = exp.radius > 6 ? 'large' as const : exp.radius > 4 ? 'medium' as const : 'small' as const
        explosionVFX.current.spawnExplosion(pos, tier)
      }
    }

    const flashes = store.consumeFlashDetonations ? store.consumeFlashDetonations() : []
    const localPos = store.ballPosition as any
    const hasLocalPos =
      localPos && Number.isFinite(localPos.x as number) &&
      Number.isFinite(localPos.y as number) &&
      Number.isFinite(localPos.z as number)
    let whiteoutToAdd = 0
    for (const flash of flashes) {
      if (particles.current) {
        particles.current.emit({
          position: flash.position,
          count: 46,
          speedMin: 1.5,
          speedMax: 6,
          spread: Math.PI * 2,
          lifetimeMin: 0.08,
          lifetimeMax: 0.28,
          sizeMin: 0.14,
          sizeMax: 0.44,
          colors: [[1, 1, 1], [1, 0.98, 0.82], [0.85, 0.95, 1]],
          gravityScale: 0,
        })
      }

      if (hasLocalPos) {
        const dx = flash.position.x - localPos.x
        const dy = flash.position.y - localPos.y
        const dz = flash.position.z - localPos.z
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz)
        const radius = Math.max(0.001, flash.radius)
        whiteoutToAdd = Math.max(whiteoutToAdd, THREE.MathUtils.clamp(1 - dist / radius, 0, 1))
      }

      if (!hasLocalPos && whiteoutToAdd <= 0) {
        whiteoutToAdd = 0.4
      }
    }

    if (whiteoutToAdd > 0 && typeof store.addFlashWhiteout === 'function') {
      store.addFlashWhiteout(whiteoutToAdd)
    }

    if (typeof store.decayFlashWhiteout === 'function') {
      store.decayFlashWhiteout(clampedDt)
    }

    const smokeDeploys = store.consumeSmokeDeploys ? store.consumeSmokeDeploys() : []
    for (const deploy of smokeDeploys) {
      // Old volumetric raymarched smoke disabled — using billboard particle system instead
      // grenades.current?.addSmokeCloud(deploy.position, deploy.radius, deploy.duration)
      billboardSmoke.current?.addCloud(deploy.position, deploy.radius, deploy.duration)
      if (particles.current) {
        const burstScale = Math.max(0.2, Math.min(0.45, deploy.radius / 30))
        particles.current.emit({
          position: deploy.position,
          count: 24,
          direction: { x: 0, y: 1, z: 0 },
          speedMin: 0.12,
          speedMax: 0.9,
          spread: Math.PI,
          lifetimeMin: 0.9,
          lifetimeMax: 2.1,
          sizeMin: 0.18 * burstScale,
          sizeMax: 0.62 * burstScale,
          colors: [[0.68, 0.67, 0.62], [0.62, 0.6, 0.56], [0.54, 0.5, 0.47]],
          gravityScale: -0.04,
        })
      }
    }

    const destroyedPlacements = store.consumePlacementDestroyed ? store.consumePlacementDestroyed() : []
    for (const event of destroyedPlacements) {
      placementDestructionView.handleDestroyedPlacement(event.colliderId, event.position, event.impulse)
    }

    // Process hit confirmations: play ding sound + emit hit particles at target
    const hitConfirms = store.consumeHitConfirms()
    for (const hit of hitConfirms) {
      // Only play ding for hits WE deal (we are the shooter, not the victim)
      const myId = store.myId
      if (myId && hit.targetId !== myId) {
        soundManager.play(SoundId.HitConfirmDing)

        // Emit red/orange hit burst at the target player's position
        if (particles.current) {
          const remotePlayers = store.remotePlayers as Map<string, any> | undefined
          const target = remotePlayers?.get(hit.targetId)
          if (target?.position) {
            particles.current.emit({
              position: target.position,
              count: 12,
              speedMin: 2,
              speedMax: 5,
              spread: Math.PI,
              lifetimeMin: 0.15,
              lifetimeMax: 0.35,
              sizeMin: 0.08,
              sizeMax: 0.2,
              colors: [[1, 0.3, 0.1], [1, 0.5, 0.1], [0.9, 0.2, 0.05]],
              gravityScale: 0.4,
            })
          }
        }
      }
    }

    if (particles.current) {
      particles.current.update(clampedDt)
    }

    if (projectiles.current) {
      projectiles.current.update(clampedDt, {
        x: camera.position.x,
        y: camera.position.y,
        z: camera.position.z,
      })
    }

    if (grenades.current) {
      grenades.current.update(clampedDt)
    }

    if (gunSmoke.current) {
      gunSmoke.current.update(clampedDt, gl, camera)
    }

    if (impacts.current) {
      impacts.current.update(clampedDt)
    }

    if (billboardSmoke.current) {
      billboardSmoke.current.update(clampedDt, camera)
    }

    if (explosionVFX.current) {
      explosionVFX.current.update(clampedDt, camera)
    }

    placementDestructionView.update(clampedDt, camera)

    // Update audio listener position
    soundManager.updateListener(
      { x: camera.position.x, y: camera.position.y, z: camera.position.z },
      {
        x: -Math.sin(camera.rotation.y),
        y: 0,
        z: -Math.cos(camera.rotation.y),
      },
      { x: 0, y: 1, z: 0 },
    )
  })

  return null // All rendering is imperative
}
