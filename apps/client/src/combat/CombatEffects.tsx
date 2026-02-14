import { useRef, useEffect } from 'react'
import { useThree, useFrame } from '@react-three/fiber'
import { ProjectileRenderer } from './projectile-renderer'
import { ParticleSystem } from './particle-system'
import { GrenadeRenderer } from './grenade-renderer'
import { GunSmokeSystem } from './gun-smoke-system'
import { ImpactSystem } from './impact-system'
import { soundManager, SoundId } from '../audio/sound-manager'
import useStore from '../stores/useStore'

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
} = {
  projectiles: null,
  particles: null,
  grenades: null,
  gunSmoke: null,
  impacts: null,
}

/**
 * R3F component that wraps imperative Three.js combat renderers.
 * Uses useThree() to get the scene and useFrame() for per-frame updates.
 * Renders nothing declaratively — all visuals are added imperatively to the scene.
 */
export default function CombatEffects() {
  const { scene, camera } = useThree()

  const particles = useRef<ParticleSystem | null>(null)
  const projectiles = useRef<ProjectileRenderer | null>(null)
  const grenades = useRef<GrenadeRenderer | null>(null)
  const gunSmoke = useRef<GunSmokeSystem | null>(null)
  const impacts = useRef<ImpactSystem | null>(null)

  // Initialize combat systems on mount
  useEffect(() => {
    const ps = new ParticleSystem(scene)
    particles.current = ps

    const pr = new ProjectileRenderer(scene)
    pr.setParticleSystem(ps)
    projectiles.current = pr

    const impactSystem = new ImpactSystem(scene)
    impacts.current = impactSystem
    pr.setImpactSystem(impactSystem)

    const gr = new GrenadeRenderer(scene)
    gr.setParticleSystem(ps)
    grenades.current = gr

    const gs = new GunSmokeSystem(scene)
    gunSmoke.current = gs

    // Expose to other components (e.g. PlayerController for local projectile spawning)
    combatSystems.projectiles = pr
    combatSystems.particles = ps
    combatSystems.grenades = gr
    combatSystems.gunSmoke = gs
    combatSystems.impacts = impactSystem

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
      pr.dispose()
      ps.dispose()
      gr.dispose()
      gs.dispose()
      impactSystem.dispose()
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
      grenades.current?.addExplosion(exp.position, exp.radius)
    }

    const flashes = store.consumeFlashDetonations ? store.consumeFlashDetonations() : []
    for (const flash of flashes) {
      if (particles.current) {
        particles.current.emit({
          position: flash.position,
          count: 34,
          speedMin: 1.5,
          speedMax: 6,
          spread: Math.PI * 2,
          lifetimeMin: 0.08,
          lifetimeMax: 0.28,
          sizeMin: 0.08,
          sizeMax: 0.26,
          colors: [[1, 1, 1], [1, 0.98, 0.82], [0.85, 0.95, 1]],
          gravityScale: 0,
        })
      }
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
      gunSmoke.current.update(clampedDt)
    }

    if (impacts.current) {
      impacts.current.update(clampedDt)
    }

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
