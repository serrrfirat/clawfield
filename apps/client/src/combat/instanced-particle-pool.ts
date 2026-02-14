import type { Vec3 } from '@clawfield/shared'

export interface InstancedParticleSpawn {
  position: Vec3
  velocity: Vec3
  lifetime: number
  gravity: number
  drag: number
  startScale: number
  endScale: number
  rotation: number
  angularVelocity: number
}

export class InstancedParticlePool {
  readonly capacity: number

  private alive: Uint8Array
  private age: Float32Array
  private lifetime: Float32Array

  private px: Float32Array
  private py: Float32Array
  private pz: Float32Array

  private vx: Float32Array
  private vy: Float32Array
  private vz: Float32Array

  private gravity: Float32Array
  private drag: Float32Array
  private startScale: Float32Array
  private endScale: Float32Array
  private rotation: Float32Array
  private angularVelocity: Float32Array

  private cursor = 0
  private aliveCount = 0

  constructor(capacity: number) {
    this.capacity = Math.max(1, Math.floor(capacity))
    this.alive = new Uint8Array(this.capacity)
    this.age = new Float32Array(this.capacity)
    this.lifetime = new Float32Array(this.capacity)
    this.px = new Float32Array(this.capacity)
    this.py = new Float32Array(this.capacity)
    this.pz = new Float32Array(this.capacity)
    this.vx = new Float32Array(this.capacity)
    this.vy = new Float32Array(this.capacity)
    this.vz = new Float32Array(this.capacity)
    this.gravity = new Float32Array(this.capacity)
    this.drag = new Float32Array(this.capacity)
    this.startScale = new Float32Array(this.capacity)
    this.endScale = new Float32Array(this.capacity)
    this.rotation = new Float32Array(this.capacity)
    this.angularVelocity = new Float32Array(this.capacity)
  }

  spawn(p: InstancedParticleSpawn): void {
    const i = this.cursor
    this.cursor = (this.cursor + 1) % this.capacity

    if (this.alive[i] === 0) this.aliveCount++

    this.alive[i] = 1
    this.age[i] = 0
    this.lifetime[i] = Math.max(0.01, p.lifetime)

    this.px[i] = p.position.x
    this.py[i] = p.position.y
    this.pz[i] = p.position.z

    this.vx[i] = p.velocity.x
    this.vy[i] = p.velocity.y
    this.vz[i] = p.velocity.z

    this.gravity[i] = p.gravity
    this.drag[i] = p.drag
    this.startScale[i] = p.startScale
    this.endScale[i] = p.endScale
    this.rotation[i] = p.rotation
    this.angularVelocity[i] = p.angularVelocity
  }

  update(dt: number): void {
    if (this.aliveCount === 0) return
    const clampedDt = Math.min(0.1, Math.max(0, dt))

    let aliveNow = 0
    for (let i = 0; i < this.capacity; i++) {
      if (this.alive[i] === 0) continue

      const nextAge = this.age[i] + clampedDt
      this.age[i] = nextAge
      if (nextAge >= this.lifetime[i]) {
        this.alive[i] = 0
        continue
      }

      const dragFactor = Math.max(0, 1 - this.drag[i] * clampedDt)
      this.vx[i] *= dragFactor
      this.vy[i] *= dragFactor
      this.vz[i] *= dragFactor

      this.vy[i] += this.gravity[i] * clampedDt

      this.px[i] += this.vx[i] * clampedDt
      this.py[i] += this.vy[i] * clampedDt
      this.pz[i] += this.vz[i] * clampedDt

      this.rotation[i] += this.angularVelocity[i] * clampedDt
      aliveNow++
    }

    this.aliveCount = aliveNow
  }

  forEachAlive(visitor: (index: number, lifeT: number) => void): void {
    if (this.aliveCount === 0) return
    for (let i = 0; i < this.capacity; i++) {
      if (this.alive[i] === 0) continue
      const lifeT = Math.max(0, Math.min(1, this.age[i] / this.lifetime[i]))
      visitor(i, lifeT)
    }
  }

  getPosition(index: number, out: Vec3): void {
    out.x = this.px[index]
    out.y = this.py[index]
    out.z = this.pz[index]
  }

  getScale(index: number, lifeT: number): number {
    return this.startScale[index] + (this.endScale[index] - this.startScale[index]) * lifeT
  }

  getRotation(index: number): number {
    return this.rotation[index]
  }
}
