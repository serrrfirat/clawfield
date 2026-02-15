import * as THREE from 'three'
import type { Vec3 } from '@clawfield/shared'
import { InstancedParticlePool } from './instanced-particle-pool'
import { generateSmokeAtlas } from './smoke-texture-atlas'

const MAX_PARTICLES = 200

// Burst phase params — all particles in 0.15s, explosive not gentle
const BURST_DURATION = 0.15
const BURST_COUNT = 100
const BURST_SPEED_MIN = 6
const BURST_SPEED_MAX = 14
const BURST_DRAG = 5.0
const BURST_GRAVITY = -0.8 // upward buoyancy (stronger than smoke grenade)
const BURST_START_SCALE_MIN = 0.8
const BURST_START_SCALE_MAX = 2.0
const BURST_END_SCALE_MIN = 3.0
const BURST_END_SCALE_MAX = 5.0
const BURST_LIFETIME_MIN = 3
const BURST_LIFETIME_MAX = 6
const BURST_ANGULAR_MIN = 0.35
const BURST_ANGULAR_MAX = 1.05

// Rising column params — mushroom stem after main burst
const COLUMN_COUNT = 30
const COLUMN_SPEED_MIN = 2
const COLUMN_SPEED_MAX = 4
const COLUMN_DRAG = 2.0
const COLUMN_GRAVITY = -1.2
const COLUMN_START_SCALE_MIN = 0.6
const COLUMN_START_SCALE_MAX = 1.2
const COLUMN_END_SCALE_MIN = 2.0
const COLUMN_END_SCALE_MAX = 3.5
const COLUMN_LIFETIME_MIN = 2.5
const COLUMN_LIFETIME_MAX = 5
const COLUMN_ANGULAR_MIN = 0.17
const COLUMN_ANGULAR_MAX = 0.52

// Shared atlas texture (lazy-init, singleton)
let sharedAtlas: THREE.CanvasTexture | null = null

function getAtlas(): THREE.CanvasTexture {
  if (!sharedAtlas) sharedAtlas = generateSmokeAtlas(512)
  return sharedAtlas
}

// Billboard shader material — same as BillboardSmokeCloud but with dark tint
function createExplosionSmokeMaterial(): THREE.ShaderMaterial {
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
        vec2 corner = position.xy;
        vec2 rotated = vec2(
          corner.x * c - corner.y * s,
          corner.x * s + corner.y * c
        );

        viewCenter.xy += rotated * scale;

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
        // Dark smoke: black core fading to gray as opacity drops
        vec3 col = mix(vec3(0.15, 0.14, 0.13), vec3(0.45, 0.43, 0.40), vOpacity);
        gl_FragColor = vec4(col, alpha);
      }
    `,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.NormalBlending,
  })
}

/** Opacity curve for explosion smoke: fast peak, aggressive fade
 *  0%→0, 10%→0.75, 40%→0.55, 80%→0, 100%→0 */
function opacityCurve(t: number): number {
  if (t < 0.1) return t / 0.1 * 0.75
  if (t < 0.4) return 0.75 - (t - 0.1) / 0.3 * 0.2
  if (t < 0.8) return 0.55 * (1 - (t - 0.4) / 0.4)
  return 0
}

function randRange(min: number, max: number): number {
  return min + Math.random() * (max - min)
}

export class ExplosionSmokeCloud {
  readonly pool: InstancedParticlePool
  readonly mesh: THREE.InstancedMesh

  private opacityArr: Float32Array
  private atlasArr: Float32Array
  private rotationArr: Float32Array
  private slotAtlas: Float32Array
  private opacityAttr: THREE.InstancedBufferAttribute
  private atlasAttr: THREE.InstancedBufferAttribute
  private rotationAttr: THREE.InstancedBufferAttribute

  private cloudAge = 0
  private center: Vec3
  private burstEmitted = 0
  private columnEmitted = 0
  private disposed = false

  private tempPos: Vec3 = { x: 0, y: 0, z: 0 }
  private tempMatrix = new THREE.Matrix4()

  constructor(center: Vec3) {
    this.center = { ...center }

    this.pool = new InstancedParticlePool(MAX_PARTICLES)

    const geo = new THREE.PlaneGeometry(1, 1)
    const mat = createExplosionSmokeMaterial()
    this.mesh = new THREE.InstancedMesh(geo, mat, MAX_PARTICLES)
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    this.mesh.count = 0
    this.mesh.frustumCulled = false

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
    if (this.cloudAge < BURST_LIFETIME_MAX + 1) return false
    let alive = false
    this.pool.forEachAlive(() => { alive = true })
    return !alive
  }

  update(dt: number, _camera: THREE.Camera): void {
    if (this.disposed) return

    this.cloudAge += dt

    // Burst phase: all particles in BURST_DURATION
    if (this.cloudAge <= BURST_DURATION + 0.05) {
      const targetCount = Math.min(BURST_COUNT, Math.floor((this.cloudAge / BURST_DURATION) * BURST_COUNT))
      while (this.burstEmitted < targetCount) {
        this.spawnBurstParticle()
        this.burstEmitted++
      }
    }

    // Rising column: emit after burst, over ~0.3s
    const columnStart = BURST_DURATION + 0.05
    const columnEnd = columnStart + 0.3
    if (this.cloudAge >= columnStart && this.cloudAge <= columnEnd + 0.05) {
      const columnProgress = Math.min(1, (this.cloudAge - columnStart) / 0.3)
      const targetColumn = Math.floor(columnProgress * COLUMN_COUNT)
      while (this.columnEmitted < targetColumn) {
        this.spawnColumnParticle()
        this.columnEmitted++
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

  private nextSlot = 0

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
        y: Math.sin(elev) * speed + 2.0,
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

  private spawnColumnParticle(): void {
    // Narrow upward spread for the mushroom stem
    const angle = Math.random() * Math.PI * 2
    const spread = 0.5 // narrow lateral spread
    const speed = randRange(COLUMN_SPEED_MIN, COLUMN_SPEED_MAX)

    this.spawnWithAtlas({
      position: {
        x: this.center.x + (Math.random() - 0.5) * spread,
        y: this.center.y + 0.3,
        z: this.center.z + (Math.random() - 0.5) * spread,
      },
      velocity: {
        x: Math.cos(angle) * 0.3,
        y: speed,
        z: Math.sin(angle) * 0.3,
      },
      lifetime: randRange(COLUMN_LIFETIME_MIN, COLUMN_LIFETIME_MAX),
      gravity: COLUMN_GRAVITY,
      drag: COLUMN_DRAG,
      startScale: randRange(COLUMN_START_SCALE_MIN, COLUMN_START_SCALE_MAX),
      endScale: randRange(COLUMN_END_SCALE_MIN, COLUMN_END_SCALE_MAX),
      rotation: Math.random() * Math.PI * 2,
      angularVelocity: randRange(COLUMN_ANGULAR_MIN, COLUMN_ANGULAR_MAX) * (Math.random() > 0.5 ? 1 : -1),
    })
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.mesh.geometry.dispose()
    ;(this.mesh.material as THREE.ShaderMaterial).dispose()
  }
}
