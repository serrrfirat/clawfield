import * as THREE from 'three'
import { createDebrisLibrary, type DebrisLibrary, type MaterialType } from './debris-meshes'
import { ScorchDecalSystem } from './scorch-decal'
import { CameraShake } from './camera-shake'
import { ExplosionSmokeCloud } from './explosion-smoke-cloud'
import { FireEffectSystem } from './fire-effect'
import type { ParticleSystem } from './particle-system'
import { soundManager, SoundId } from '../audio/sound-manager'

/* ── Explosion Tiers ─────────────────────────────────────────────── */

export type ExplosionTier = 'small' | 'medium' | 'large'

interface TierConfig {
  radiusMin: number
  radiusMax: number
  debrisScale: number
  debrisCount: number
  durationBase: number
  flashSize: number
  fireballMaxSize: number
  dustCount: number
  shakeIntensity: number
  shakeDuration: number
  shakeFalloff: number
}

const TIER_CONFIGS: Record<ExplosionTier, TierConfig> = {
  small: {
    radiusMin: 2, radiusMax: 3,
    debrisScale: 0.7, debrisCount: 25,
    durationBase: 2,
    flashSize: 2.5, fireballMaxSize: 4,
    dustCount: 40,
    shakeIntensity: 0.15, shakeDuration: 0.3, shakeFalloff: 25,
  },
  medium: {
    radiusMin: 3, radiusMax: 5,
    debrisScale: 1.0, debrisCount: 35,
    durationBase: 3,
    flashSize: 3.5, fireballMaxSize: 6,
    dustCount: 50,
    shakeIntensity: 0.3, shakeDuration: 0.5, shakeFalloff: 40,
  },
  large: {
    radiusMin: 6, radiusMax: 10,
    debrisScale: 1.5, debrisCount: 40,
    durationBase: 5,
    flashSize: 5, fireballMaxSize: 9,
    dustCount: 60,
    shakeIntensity: 0.5, shakeDuration: 0.8, shakeFalloff: 60,
  },
}

/* ── Pool Limits ─────────────────────────────────────────────────── */

const MAX_ACTIVE_EXPLOSIONS = 6
const MAX_DEBRIS_PIECES = 60

/* ── Active Debris ───────────────────────────────────────────────── */

interface ActiveDebris {
  mesh: THREE.Mesh
  velocity: THREE.Vector3
  angularVelocity: THREE.Vector3
  life: number
  ttl: number
  bouncesLeft: number
  groundY: number
  isMetal: boolean
}

/* ── Active Explosion ────────────────────────────────────────────── */

interface ActiveExplosion {
  position: THREE.Vector3
  tier: TierConfig
  materialType: MaterialType
  impulseDir: THREE.Vector3
  elapsed: number
  // Phase tracking
  flashSprite: THREE.Sprite | null
  flashLight: THREE.PointLight | null
  fireballSprite: THREE.Sprite | null
  debrisSpawned: boolean
  smokeSpawned: boolean
  fireSpawned: boolean
  scorchPlaced: boolean
  done: boolean
}

/* ── Textures ────────────────────────────────────────────────────── */

function createFlashTexture(size = 64): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!
  const c = size * 0.5
  const grad = ctx.createRadialGradient(c, c, 0, c, c, c)
  grad.addColorStop(0.0, 'rgba(255,250,200,1)')
  grad.addColorStop(0.3, 'rgba(255,220,150,0.8)')
  grad.addColorStop(0.7, 'rgba(255,180,80,0.3)')
  grad.addColorStop(1.0, 'rgba(255,120,40,0)')
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, size, size)
  const tex = new THREE.CanvasTexture(canvas)
  tex.needsUpdate = true
  return tex
}

function createFireballTexture(size = 128): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!
  const c = size * 0.5
  const grad = ctx.createRadialGradient(c, c, 0, c, c, c)
  grad.addColorStop(0.0, 'rgba(255,230,120,0.95)')
  grad.addColorStop(0.2, 'rgba(255,170,50,0.85)')
  grad.addColorStop(0.5, 'rgba(200,80,20,0.6)')
  grad.addColorStop(0.75, 'rgba(100,50,30,0.3)')
  grad.addColorStop(1.0, 'rgba(50,40,35,0)')
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, size, size)
  const tex = new THREE.CanvasTexture(canvas)
  tex.needsUpdate = true
  return tex
}

/* ── Main System ─────────────────────────────────────────────────── */

export class ExplosionVFXSystem {
  private scene: THREE.Scene
  private particles: ParticleSystem | null = null
  private cameraShake: CameraShake
  private scorchDecals: ScorchDecalSystem
  private debrisLibrary: DebrisLibrary
  private fireSystem: FireEffectSystem
  private heightGetter: ((x: number, z: number) => number) | null = null

  private explosions: ActiveExplosion[] = []
  private debris: ActiveDebris[] = []
  private smokeClouds: ExplosionSmokeCloud[] = []
  private static readonly MAX_SMOKE_CLOUDS = 6

  private flashTexture: THREE.CanvasTexture
  private fireballTexture: THREE.CanvasTexture
  private flashMaterial: THREE.SpriteMaterial
  private fireballMaterial: THREE.SpriteMaterial

  constructor(scene: THREE.Scene, cameraShake: CameraShake) {
    this.scene = scene
    this.cameraShake = cameraShake
    this.scorchDecals = new ScorchDecalSystem(scene)
    this.debrisLibrary = createDebrisLibrary()
    this.fireSystem = new FireEffectSystem(scene)

    this.flashTexture = createFlashTexture()
    this.fireballTexture = createFireballTexture()

    this.flashMaterial = new THREE.SpriteMaterial({
      map: this.flashTexture,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      transparent: true,
      opacity: 1,
    })
    this.fireballMaterial = new THREE.SpriteMaterial({
      map: this.fireballTexture,
      blending: THREE.NormalBlending,
      depthWrite: false,
      transparent: true,
      opacity: 0.9,
    })
  }

  setParticleSystem(ps: ParticleSystem | null): void {
    this.particles = ps
  }

  setHeightGetter(getter: ((x: number, z: number) => number) | null): void {
    this.heightGetter = getter
    this.scorchDecals.setHeightGetter(getter)
  }

  /**
   * Spawn a multi-phase explosion at the given position.
   * @param position - World position of the explosion center
   * @param tier - Weapon tier: 'small' (grenade), 'medium' (rocket), 'large' (artillery)
   * @param materialType - Material of the destroyed structure for debris coloring
   * @param impulse - Optional direction hint for debris scatter
   */
  spawnExplosion(
    position: THREE.Vector3 | { x: number; y: number; z: number },
    tier: ExplosionTier = 'small',
    materialType: MaterialType = 'concrete',
    impulse?: { x: number; y: number; z: number },
  ): void {
    const pos = position instanceof THREE.Vector3
      ? position.clone()
      : new THREE.Vector3(position.x, position.y, position.z)

    // Compute impulse direction (default: upward burst for grenades)
    const impulseDir = impulse
      ? new THREE.Vector3(impulse.x, impulse.y, impulse.z).normalize()
      : new THREE.Vector3(0, 1, 0)

    // Enforce pool limit
    if (this.explosions.length >= MAX_ACTIVE_EXPLOSIONS) {
      // Force-finish the oldest
      const oldest = this.explosions.shift()!
      this.cleanupExplosion(oldest)
    }

    const config = TIER_CONFIGS[tier]

    // Play sound
    soundManager.play3D(SoundId.Explosion, { x: pos.x, y: pos.y, z: pos.z })

    // --- Phase A: Flash sprite + point light ---
    const flashSprite = new THREE.Sprite(this.flashMaterial.clone())
    flashSprite.position.copy(pos)
    flashSprite.scale.setScalar(config.flashSize)
    this.scene.add(flashSprite)

    const flashLight = new THREE.PointLight(0xfff8dc, 4, config.radiusMax * 3)
    flashLight.position.copy(pos)
    this.scene.add(flashLight)

    // --- Phase A: Spark burst via particles ---
    if (this.particles) {
      this.particles.emit({
        position: { x: pos.x, y: pos.y, z: pos.z },
        count: Math.round(24 * config.debrisScale),
        speedMin: 8,
        speedMax: 22,
        spread: Math.PI * 2,
        lifetimeMin: 0.08,
        lifetimeMax: 0.25,
        sizeMin: 0.06 * config.debrisScale,
        sizeMax: 0.2 * config.debrisScale,
        colors: [[1, 0.95, 0.7], [1, 0.8, 0.4], [1, 1, 0.6]],
        gravityScale: 0.3,
      })
    }

    // --- Phase B: Fireball sprite (starts slightly delayed via update) ---
    const fireballSprite = new THREE.Sprite(this.fireballMaterial.clone())
    fireballSprite.position.copy(pos)
    fireballSprite.scale.setScalar(config.flashSize * 0.5) // starts small
    fireballSprite.visible = false // shown after 0.1s
    this.scene.add(fireballSprite)

    // Camera shake
    this.cameraShake.addShake(
      config.shakeIntensity,
      config.shakeDuration,
      config.shakeFalloff,
      pos,
    )

    this.explosions.push({
      position: pos,
      tier: config,
      materialType,
      impulseDir,
      elapsed: 0,
      flashSprite,
      flashLight,
      fireballSprite,
      debrisSpawned: false,
      smokeSpawned: false,
      fireSpawned: false,
      scorchPlaced: false,
      done: false,
    })
  }

  update(dt: number, camera: THREE.Camera): void {
    const clamped = Math.min(dt, 0.05)

    // Update camera shake position for distance falloff
    this.cameraShake.setCameraPosition(camera.position)
    this.cameraShake.update(clamped)

    // Apply shake offset to camera
    const shakeOffset = this.cameraShake.getOffset()
    if (shakeOffset.lengthSq() > 1e-6) {
      camera.position.add(shakeOffset)
    }

    // --- Update active explosions ---
    for (let i = this.explosions.length - 1; i >= 0; i--) {
      const exp = this.explosions[i]
      exp.elapsed += clamped
      const t = exp.elapsed

      // Phase A: Flash (0-0.15s)
      if (exp.flashSprite) {
        if (t < 0.15) {
          const flashProgress = t / 0.15
          const flashScale = exp.tier.flashSize * (1 + flashProgress * 0.5)
          exp.flashSprite.scale.setScalar(flashScale)
          ;(exp.flashSprite.material as THREE.SpriteMaterial).opacity = 1 - flashProgress * 0.7
        } else {
          this.scene.remove(exp.flashSprite)
          ;(exp.flashSprite.material as THREE.SpriteMaterial).dispose()
          exp.flashSprite = null
        }
      }

      // Flash light ramp
      if (exp.flashLight) {
        if (t < 0.2) {
          const lightProgress = t / 0.2
          exp.flashLight.intensity = 4 * (1 - lightProgress)
        } else {
          this.scene.remove(exp.flashLight)
          exp.flashLight.dispose()
          exp.flashLight = null
        }
      }

      // Phase B: Fireball (0.1-0.6s)
      if (exp.fireballSprite) {
        if (t >= 0.1 && t < 0.7) {
          exp.fireballSprite.visible = true
          const fbProgress = (t - 0.1) / 0.6
          const fbSize = THREE.MathUtils.lerp(
            exp.tier.flashSize * 0.8,
            exp.tier.fireballMaxSize,
            fbProgress,
          )
          exp.fireballSprite.scale.setScalar(fbSize)
          // Color shift: bright -> dark (via opacity since sprite material)
          const mat = exp.fireballSprite.material as THREE.SpriteMaterial
          mat.opacity = 0.9 * (1 - fbProgress * fbProgress)
          // Tint darker over time
          mat.color.setRGB(
            1,
            THREE.MathUtils.lerp(0.85, 0.3, fbProgress),
            THREE.MathUtils.lerp(0.5, 0.15, fbProgress),
          )
        } else if (t >= 0.7) {
          this.scene.remove(exp.fireballSprite)
          ;(exp.fireballSprite.material as THREE.SpriteMaterial).dispose()
          exp.fireballSprite = null
        }
      }

      // Phase C: Debris burst (at t=0, spawned once)
      if (!exp.debrisSpawned) {
        exp.debrisSpawned = true
        this.spawnDebris(exp.position, exp.tier, exp.materialType, exp.impulseDir)
      }

      // Phase D: Explosion smoke cloud (at t>=0.1, spawned once)
      if (!exp.smokeSpawned && t >= 0.1) {
        exp.smokeSpawned = true
        this.spawnSmokeCloud(exp.position)
      }

      // Phase D2: Fire effect (at t>=0.1, spawned once)
      if (!exp.fireSpawned && t >= 0.1) {
        exp.fireSpawned = true
        const fireScale = (exp.tier.radiusMin + exp.tier.radiusMax) * 0.3
        const fireLifetime = 1.5 + Math.random() * 1.5
        this.fireSystem.spawn(exp.position, fireScale, fireLifetime)
      }

      // Phase E: Scorch mark (at t>=0.5, placed once)
      if (!exp.scorchPlaced && t >= 0.5) {
        exp.scorchPlaced = true
        const radius = (exp.tier.radiusMin + exp.tier.radiusMax) * 0.5
        this.scorchDecals.addScorch(exp.position, radius)
      }

      // Done when all phases complete
      const totalDuration = exp.tier.durationBase
      if (t >= totalDuration && !exp.flashSprite && !exp.fireballSprite && !exp.flashLight) {
        exp.done = true
      }

      if (exp.done) {
        this.cleanupExplosion(exp)
        this.explosions.splice(i, 1)
      }
    }

    // --- Update debris pieces ---
    for (let i = this.debris.length - 1; i >= 0; i--) {
      const d = this.debris[i]
      d.life += clamped

      // Simple euler integration
      d.velocity.y -= 9.8 * clamped
      d.mesh.position.addScaledVector(d.velocity, clamped)

      // Tumble rotation
      d.mesh.rotation.x += d.angularVelocity.x * clamped
      d.mesh.rotation.y += d.angularVelocity.y * clamped
      d.mesh.rotation.z += d.angularVelocity.z * clamped

      // Ground collision
      const groundY = this.heightGetter
        ? this.heightGetter(d.mesh.position.x, d.mesh.position.z)
        : d.groundY
      const floorY = Math.max(d.groundY, groundY + 0.05)

      if (d.mesh.position.y < floorY && d.velocity.y < 0) {
        d.mesh.position.y = floorY
        d.velocity.y *= -0.25 // Bounce factor
        d.velocity.x *= 0.65
        d.velocity.z *= 0.65
        d.angularVelocity.multiplyScalar(0.6)
        d.bouncesLeft--

        // Metal spark on bounce
        if (d.isMetal && d.bouncesLeft >= 0 && this.particles) {
          this.particles.emit({
            position: { x: d.mesh.position.x, y: d.mesh.position.y, z: d.mesh.position.z },
            count: 2,
            speedMin: 2,
            speedMax: 5,
            spread: Math.PI,
            lifetimeMin: 0.05,
            lifetimeMax: 0.15,
            sizeMin: 0.03,
            sizeMax: 0.08,
            colors: [[1, 0.9, 0.5], [1, 0.7, 0.3]],
            gravityScale: 0.5,
          })
        }

        if (d.bouncesLeft < 0) {
          d.velocity.set(0, 0, 0)
          d.angularVelocity.set(0, 0, 0)
        }
      }

      // Fade out near end of life
      if (d.life >= d.ttl) {
        this.scene.remove(d.mesh)
        this.debris.splice(i, 1)
      }
    }

    // Update explosion smoke clouds
    for (let i = this.smokeClouds.length - 1; i >= 0; i--) {
      const cloud = this.smokeClouds[i]
      cloud.update(clamped, camera)
      if (cloud.isExpired) {
        this.scene.remove(cloud.mesh)
        cloud.dispose()
        this.smokeClouds.splice(i, 1)
      }
    }

    // Update fire effects
    this.fireSystem.update(clamped)

    // Update scorch decals
    this.scorchDecals.update(clamped)
  }

  private spawnDebris(position: THREE.Vector3, tier: TierConfig, materialType: MaterialType, impulseDir: THREE.Vector3): void {
    const variants = this.debrisLibrary.getVariants(materialType)
    const count = Math.min(tier.debrisCount, MAX_DEBRIS_PIECES - this.debris.length)

    for (let i = 0; i < count; i++) {
      // Evict oldest if at limit
      if (this.debris.length >= MAX_DEBRIS_PIECES) {
        const oldest = this.debris.shift()!
        this.scene.remove(oldest.mesh)
      }

      const variant = variants[Math.floor(Math.random() * variants.length)]
      const mesh = new THREE.Mesh(variant.geometry, variant.material)
      mesh.castShadow = true

      // Scale by tier
      const s = tier.debrisScale * (0.7 + Math.random() * 0.6)
      mesh.scale.setScalar(s)

      // Spawn position with slight random offset
      mesh.position.set(
        position.x + (Math.random() - 0.5) * 1.2,
        position.y + (Math.random() - 0.2) * 0.8,
        position.z + (Math.random() - 0.5) * 1.2,
      )

      this.scene.add(mesh)

      // Directional debris: 60% impulse direction, 40% random spread
      const speed = 8 + Math.random() * 10
      const upSpeed = 3 + Math.random() * 6
      const randomAngle = Math.random() * Math.PI * 2
      const randomDir = new THREE.Vector3(Math.cos(randomAngle), 0, Math.sin(randomAngle))
      const dir = impulseDir.clone().multiplyScalar(0.6)
        .add(randomDir.multiplyScalar(0.4))
        .normalize()

      this.debris.push({
        mesh,
        velocity: new THREE.Vector3(
          dir.x * speed,
          upSpeed,
          dir.z * speed,
        ),
        angularVelocity: new THREE.Vector3(
          (Math.random() - 0.5) * 10,
          (Math.random() - 0.5) * 10,
          (Math.random() - 0.5) * 10,
        ),
        life: 0,
        ttl: tier.durationBase * (0.6 + Math.random() * 0.8),
        bouncesLeft: 2,
        groundY: position.y - 0.5,
        isMetal: materialType === 'metal',
      })
    }
  }

  private spawnSmokeCloud(position: THREE.Vector3): void {
    // Enforce smoke cloud pool limit
    while (this.smokeClouds.length >= ExplosionVFXSystem.MAX_SMOKE_CLOUDS) {
      const oldest = this.smokeClouds.shift()!
      this.scene.remove(oldest.mesh)
      oldest.dispose()
    }

    const cloud = new ExplosionSmokeCloud({ x: position.x, y: position.y, z: position.z })
    this.scene.add(cloud.mesh)
    this.smokeClouds.push(cloud)
  }

  private cleanupExplosion(exp: ActiveExplosion): void {
    if (exp.flashSprite) {
      this.scene.remove(exp.flashSprite)
      ;(exp.flashSprite.material as THREE.SpriteMaterial).dispose()
    }
    if (exp.flashLight) {
      this.scene.remove(exp.flashLight)
      exp.flashLight.dispose()
    }
    if (exp.fireballSprite) {
      this.scene.remove(exp.fireballSprite)
      ;(exp.fireballSprite.material as THREE.SpriteMaterial).dispose()
    }
  }

  dispose(): void {
    for (const exp of this.explosions) {
      this.cleanupExplosion(exp)
    }
    this.explosions.length = 0

    for (const d of this.debris) {
      this.scene.remove(d.mesh)
    }
    this.debris.length = 0

    for (const cloud of this.smokeClouds) {
      this.scene.remove(cloud.mesh)
      cloud.dispose()
    }
    this.smokeClouds.length = 0

    this.fireSystem.dispose()
    this.scorchDecals.dispose()
    this.debrisLibrary.dispose()
    this.flashTexture.dispose()
    this.fireballTexture.dispose()
    this.flashMaterial.dispose()
    this.fireballMaterial.dispose()
    this.cameraShake.dispose()
  }
}
