import * as THREE from 'three'
import type { Vec3 } from '@clawfield/shared'
import { InstancedParticlePool } from './instanced-particle-pool'
import { generateSmokeAtlas } from './smoke-texture-atlas'

const MAX_PARTICLES = 800

// Phase boundaries (seconds)
const BURST_END = 0.7
const SUSTAINED_END_RATIO = 0.85 // fraction of cloudLifetime
const DISSIPATION_RATIO = 1.0

// Burst phase params
const BURST_COUNT = 120
const BURST_SPEED_MIN = 4
const BURST_SPEED_MAX = 8
const BURST_DRAG = 3.5
const BURST_GRAVITY = -0.5
const BURST_START_SCALE_MIN = 0.67
const BURST_START_SCALE_MAX = 1.67
const BURST_END_SCALE_MIN = 2.0
const BURST_END_SCALE_MAX = 3.33
const BURST_LIFETIME_MIN = 18
const BURST_LIFETIME_MAX = 22
const BURST_ANGULAR_MIN = 0.35 // ~20 deg/s
const BURST_ANGULAR_MAX = 1.05 // ~60 deg/s

// Sustained phase params
const SUSTAINED_RATE = 30 // particles/sec
const SUSTAINED_SPEED_MIN = 0.3
const SUSTAINED_SPEED_MAX = 0.8
const SUSTAINED_DRAG = 1.5
const SUSTAINED_GRAVITY = 0.2 // upward buoyancy
const SUSTAINED_START_SCALE_MIN = 1.0
const SUSTAINED_START_SCALE_MAX = 2.0
const SUSTAINED_END_SCALE_MIN = 2.67
const SUSTAINED_END_SCALE_MAX = 4.0
const SUSTAINED_LIFETIME_MIN = 15
const SUSTAINED_LIFETIME_MAX = 20
const SUSTAINED_ANGULAR_MIN = 0.17 // ~10 deg/s
const SUSTAINED_ANGULAR_MAX = 0.52 // ~30 deg/s

// Shared atlas texture (lazy-init, singleton)
let sharedAtlas: THREE.CanvasTexture | null = null

function getAtlas(): THREE.CanvasTexture {
  if (!sharedAtlas) sharedAtlas = generateSmokeAtlas(512)
  return sharedAtlas
}

// Billboard shader material
function createSmokeMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uAtlas: { value: getAtlas() },
    },
    vertexShader: /* glsl */ `
      attribute float aOpacity;
      attribute float aAtlasIndex;
      attribute float aRotation;

      varying float vOpacity;
      varying vec2 vUv;

      void main() {
        vOpacity = aOpacity;

        // Atlas UV: 2x2 grid
        float idx = floor(aAtlasIndex);
        float col = mod(idx, 2.0);
        float row = floor(idx / 2.0);

        // Instance matrix encodes position (translation) and uniform scale
        vec4 worldPos4 = instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        float scale = length(vec3(instanceMatrix[0][0], instanceMatrix[0][1], instanceMatrix[0][2]));

        // Transform instance center to view space
        vec4 viewCenter = modelViewMatrix * worldPos4;

        // Apply per-instance rotation to quad offsets
        float c = cos(aRotation);
        float s = sin(aRotation);
        vec2 corner = position.xy; // -0.5..0.5 from PlaneGeometry
        vec2 rotated = vec2(
          corner.x * c - corner.y * s,
          corner.x * s + corner.y * c
        );

        // Offset in view space (billboard: X = screen right, Y = screen up)
        viewCenter.xy += rotated * scale;

        // Atlas UV mapping
        vUv = vec2(
          (position.x + 0.5) * 0.5 + col * 0.5,
          (position.y + 0.5) * 0.5 + row * 0.5
        );

        gl_Position = projectionMatrix * viewCenter;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D uAtlas;
      varying float vOpacity;
      varying vec2 vUv;

      void main() {
        vec4 texColor = texture2D(uAtlas, vUv);
        float alpha = texColor.a * vOpacity;
        if (alpha < 0.01) discard;
        // Tint to off-white smoke color
        gl_FragColor = vec4(0.85, 0.87, 0.84, alpha);
      }
    `,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.NormalBlending,
  })
}

/** Opacity curve: 0%→0, 10%→0.85, 60%→0.70, 90%→0.30, 100%→0 */
function opacityCurve(t: number): number {
  if (t < 0.1) return t / 0.1 * 0.85
  if (t < 0.6) return 0.85 - (t - 0.1) / 0.5 * 0.15
  if (t < 0.9) return 0.70 - (t - 0.6) / 0.3 * 0.40
  return 0.30 * (1 - (t - 0.9) / 0.1)
}

function randRange(min: number, max: number): number {
  return min + Math.random() * (max - min)
}

export class BillboardSmokeCloud {
  readonly pool: InstancedParticlePool
  readonly mesh: THREE.InstancedMesh

  private opacityArr: Float32Array
  private atlasArr: Float32Array
  private rotationArr: Float32Array
  /** Per-pool-slot atlas index (assigned at spawn, stable over lifetime) */
  private slotAtlas: Float32Array
  private opacityAttr: THREE.InstancedBufferAttribute
  private atlasAttr: THREE.InstancedBufferAttribute
  private rotationAttr: THREE.InstancedBufferAttribute

  private cloudAge = 0
  private cloudLifetime: number
  private center: Vec3
  private radius: number
  private emitAccum = 0
  private burstEmitted = 0
  private disposed = false

  private tempPos: Vec3 = { x: 0, y: 0, z: 0 }
  private tempMatrix = new THREE.Matrix4()

  constructor(center: Vec3, radius: number, duration: number) {
    this.center = { ...center }
    this.radius = radius
    this.cloudLifetime = duration

    this.pool = new InstancedParticlePool(MAX_PARTICLES)

    // Instanced mesh: billboard quads
    const geo = new THREE.PlaneGeometry(1, 1)
    const mat = createSmokeMaterial()
    this.mesh = new THREE.InstancedMesh(geo, mat, MAX_PARTICLES)
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    this.mesh.count = 0
    this.mesh.frustumCulled = false

    // Per-instance attributes
    this.opacityArr = new Float32Array(MAX_PARTICLES)
    this.atlasArr = new Float32Array(MAX_PARTICLES)
    this.rotationArr = new Float32Array(MAX_PARTICLES)
    this.slotAtlas = new Float32Array(MAX_PARTICLES)

    this.opacityAttr = new THREE.InstancedBufferAttribute(this.opacityArr, 1)
    this.opacityAttr.setUsage(THREE.DynamicDrawUsage)
    this.atlasAttr = new THREE.InstancedBufferAttribute(this.atlasArr, 1)
    this.atlasAttr.setUsage(THREE.DynamicDrawUsage)
    this.rotationAttr = new THREE.InstancedBufferAttribute(this.rotationArr, 1)
    this.rotationAttr.setUsage(THREE.DynamicDrawUsage)

    geo.setAttribute('aOpacity', this.opacityAttr)
    geo.setAttribute('aAtlasIndex', this.atlasAttr)
    geo.setAttribute('aRotation', this.rotationAttr)
  }

  get isExpired(): boolean {
    if (this.cloudAge < this.cloudLifetime) return false
    // Check if any particles still alive
    let alive = false
    this.pool.forEachAlive(() => { alive = true })
    return !alive
  }

  update(dt: number, _camera: THREE.Camera): void {
    if (this.disposed) return

    this.cloudAge += dt
    const sustainedEnd = this.cloudLifetime * SUSTAINED_END_RATIO

    // --- Spawn particles based on phase ---
    if (this.cloudAge <= BURST_END) {
      // Burst phase: spawn ~BURST_COUNT total over 0.7s
      const targetCount = Math.floor((this.cloudAge / BURST_END) * BURST_COUNT)
      while (this.burstEmitted < targetCount) {
        this.spawnBurstParticle()
        this.burstEmitted++
      }
    } else if (this.cloudAge <= sustainedEnd) {
      // Sustained phase
      const dissipStart = this.cloudLifetime * SUSTAINED_END_RATIO
      const rate = this.cloudAge < dissipStart ? SUSTAINED_RATE : 0
      this.emitAccum += rate * dt
      while (this.emitAccum >= 1) {
        this.spawnSustainedParticle()
        this.emitAccum -= 1
      }
    } else if (this.cloudAge <= this.cloudLifetime) {
      // Dissipation: lerp rate to 0
      const dissipT = (this.cloudAge - sustainedEnd) / (this.cloudLifetime * (DISSIPATION_RATIO - SUSTAINED_END_RATIO))
      const rate = SUSTAINED_RATE * (1 - Math.min(1, dissipT))
      this.emitAccum += rate * dt
      while (this.emitAccum >= 1) {
        this.spawnSustainedParticle()
        this.emitAccum -= 1
      }
    }

    // Update particle physics
    this.pool.update(dt)

    // Write instance data
    let count = 0
    this.pool.forEachAlive((index, lifeT) => {
      this.pool.getPosition(index, this.tempPos)
      const scale = this.pool.getScale(index, lifeT)
      const rotation = this.pool.getRotation(index)

      // Instance matrix: just translation + uniform scale
      // Billboard orientation is handled in the shader
      this.tempMatrix.makeScale(scale, scale, scale)
      this.tempMatrix.setPosition(this.tempPos.x, this.tempPos.y, this.tempPos.z)
      this.mesh.setMatrixAt(count, this.tempMatrix)

      this.opacityArr[count] = opacityCurve(lifeT)
      this.rotationArr[count] = rotation
      this.atlasArr[count] = this.slotAtlas[index]
      count++
    })

    this.mesh.count = count
    this.mesh.instanceMatrix.needsUpdate = true
    this.opacityAttr.needsUpdate = true
    this.atlasAttr.needsUpdate = true
    this.rotationAttr.needsUpdate = true
  }

  /**
   * Pool cursor mirror — tracks which slot the pool will write to next.
   * This mirrors InstancedParticlePool's internal cursor (starts at 0, wraps at capacity).
   */
  private nextSlot = 0

  /** Spawn a particle and assign a stable atlas index to its pool slot. */
  private spawnWithAtlas(params: Parameters<InstancedParticlePool['spawn']>[0]): void {
    const slot = this.nextSlot
    this.pool.spawn(params)
    this.slotAtlas[slot] = Math.floor(Math.random() * 4)
    this.nextSlot = (this.nextSlot + 1) % MAX_PARTICLES
  }

  private spawnBurstParticle(): void {
    const angle = Math.random() * Math.PI * 2
    const elev = (Math.random() - 0.3) * Math.PI * 0.5
    const speed = randRange(BURST_SPEED_MIN, BURST_SPEED_MAX)
    const cosElev = Math.cos(elev)

    this.spawnWithAtlas({
      position: { ...this.center },
      velocity: {
        x: Math.cos(angle) * cosElev * speed,
        y: Math.sin(elev) * speed + 1.5,
        z: Math.sin(angle) * cosElev * speed,
      },
      lifetime: randRange(BURST_LIFETIME_MIN, BURST_LIFETIME_MAX),
      gravity: BURST_GRAVITY,
      drag: BURST_DRAG,
      startScale: randRange(BURST_START_SCALE_MIN, BURST_START_SCALE_MAX),
      endScale: randRange(BURST_END_SCALE_MIN, BURST_END_SCALE_MAX),
      rotation: Math.random() * Math.PI * 2,
      angularVelocity: randRange(BURST_ANGULAR_MIN, BURST_ANGULAR_MAX) * (Math.random() > 0.5 ? 1 : -1),
    })
  }

  private spawnSustainedParticle(): void {
    // Spawn within cylinder of given radius
    const angle = Math.random() * Math.PI * 2
    const dist = Math.random() * this.radius * 0.8
    const ox = Math.cos(angle) * dist
    const oz = Math.sin(angle) * dist
    const oy = Math.random() * 2 // random height offset within cloud

    this.spawnWithAtlas({
      position: {
        x: this.center.x + ox,
        y: this.center.y + oy,
        z: this.center.z + oz,
      },
      velocity: {
        x: (Math.random() - 0.5) * 0.5,
        y: randRange(SUSTAINED_SPEED_MIN, SUSTAINED_SPEED_MAX),
        z: (Math.random() - 0.5) * 0.5,
      },
      lifetime: randRange(SUSTAINED_LIFETIME_MIN, SUSTAINED_LIFETIME_MAX),
      gravity: SUSTAINED_GRAVITY,
      drag: SUSTAINED_DRAG,
      startScale: randRange(SUSTAINED_START_SCALE_MIN, SUSTAINED_START_SCALE_MAX),
      endScale: randRange(SUSTAINED_END_SCALE_MIN, SUSTAINED_END_SCALE_MAX),
      rotation: Math.random() * Math.PI * 2,
      angularVelocity: randRange(SUSTAINED_ANGULAR_MIN, SUSTAINED_ANGULAR_MAX) * (Math.random() > 0.5 ? 1 : -1),
    })
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.mesh.geometry.dispose()
    ;(this.mesh.material as THREE.ShaderMaterial).dispose()
  }
}
