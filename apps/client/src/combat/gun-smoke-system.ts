import * as THREE from 'three'
import type { Vec3 } from '@clawfield/shared'
import { InstancedParticlePool } from './instanced-particle-pool'

const DEFAULT_SMOKE_CAPACITY = 640
const DEFAULT_DUST_CAPACITY = 420

export class GunSmokeSystem {
  private scene: THREE.Scene
  private smokePool: InstancedParticlePool
  private dustPool: InstancedParticlePool
  private smokeMesh: THREE.InstancedMesh
  private dustMesh: THREE.InstancedMesh

  private tempPos: Vec3 = { x: 0, y: 0, z: 0 }
  private tempV3 = new THREE.Vector3()
  private tempMatrix = new THREE.Matrix4()
  private tempQuat = new THREE.Quaternion()
  private tempScale = new THREE.Vector3(1, 1, 1)
  private tempEuler = new THREE.Euler(0, 0, 0)
  private instanceColor = new THREE.Color(1, 1, 1)

  constructor(scene: THREE.Scene, smokeCapacity = DEFAULT_SMOKE_CAPACITY, dustCapacity = DEFAULT_DUST_CAPACITY) {
    this.scene = scene
    this.smokePool = new InstancedParticlePool(smokeCapacity)
    this.dustPool = new InstancedParticlePool(dustCapacity)

    const smokeGeo = new THREE.IcosahedronGeometry(0.12, 0)
    const smokeMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color('#d9d5c8'),
      roughness: 1,
      metalness: 0,
      transparent: false,
      depthWrite: true,
    })

    this.smokeMesh = new THREE.InstancedMesh(smokeGeo, smokeMat, smokeCapacity)
    this.smokeMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    this.smokeMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(smokeCapacity * 3), 3)
    this.smokeMesh.count = 0
    this.smokeMesh.frustumCulled = false
    this.scene.add(this.smokeMesh)

    const dustGeo = new THREE.BoxGeometry(0.06, 0.05, 0.06)
    const dustMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color('#b5a783'),
      roughness: 1,
      metalness: 0,
      transparent: false,
      depthWrite: true,
    })

    this.dustMesh = new THREE.InstancedMesh(dustGeo, dustMat, dustCapacity)
    this.dustMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    this.dustMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(dustCapacity * 3), 3)
    this.dustMesh.count = 0
    this.dustMesh.frustumCulled = false
    this.scene.add(this.dustMesh)
  }

  spawnBurst(origin: Vec3, dir: Vec3, count = 7): void {
    const nx = dir.x
    const nz = dir.z

    for (let i = 0; i < count; i++) {
      const cone = randomDirectionInCone({ x: nx, y: 0.04, z: nz }, 0.92)
      const forward = 0.25 + Math.random() * 1.35
      const swirl = (Math.random() - 0.5) * 0.95

      this.smokePool.spawn({
        position: {
          x: origin.x + nx * 0.1 + (Math.random() - 0.5) * 0.14,
          y: origin.y + 0.01 + Math.random() * 0.08,
          z: origin.z + nz * 0.1 + (Math.random() - 0.5) * 0.14,
        },
        velocity: {
          x: cone.x * forward + swirl * nz,
          y: 0.45 + Math.random() * 0.95,
          z: cone.z * forward - swirl * nx,
        },
        lifetime: 0.32 + Math.random() * 0.5,
        gravity: -0.5,
        drag: 2.7,
        startScale: 0.28 + Math.random() * 0.26,
        endScale: 1.2 + Math.random() * 0.9,
        rotation: Math.random() * Math.PI * 2,
        angularVelocity: (Math.random() - 0.5) * 4,
      })
    }

    const dustCount = Math.max(4, Math.floor(count * 1.25))
    for (let i = 0; i < dustCount; i++) {
      const cone = randomDirectionInCone({ x: nx, y: 0.02, z: nz }, 1.3)
      const burst = 0.9 + Math.random() * 2.1
      this.dustPool.spawn({
        position: {
          x: origin.x + nx * 0.06 + (Math.random() - 0.5) * 0.11,
          y: origin.y - 0.02 + Math.random() * 0.06,
          z: origin.z + nz * 0.06 + (Math.random() - 0.5) * 0.11,
        },
        velocity: {
          x: cone.x * burst,
          y: 0.15 + Math.random() * 0.45,
          z: cone.z * burst,
        },
        lifetime: 0.18 + Math.random() * 0.35,
        gravity: -3.4,
        drag: 4.8,
        startScale: 0.08 + Math.random() * 0.08,
        endScale: 0.22 + Math.random() * 0.14,
        rotation: Math.random() * Math.PI * 2,
        angularVelocity: (Math.random() - 0.5) * 7,
      })
    }
  }

  update(dt: number): void {
    this.smokePool.update(dt)
    this.dustPool.update(dt)

    this.writeSmokeMesh()
    this.writeDustMesh()
  }

  private writeSmokeMesh(): void {
    let writeIndex = 0
    this.smokePool.forEachAlive((poolIndex, lifeT) => {
      this.smokePool.getPosition(poolIndex, this.tempPos)
      const scale = this.smokePool.getScale(poolIndex, lifeT)
      const alphaLike = 1 - lifeT
      const shade = 0.45 + alphaLike * 0.42

      this.tempEuler.set(0, this.smokePool.getRotation(poolIndex), 0)
      this.tempQuat.setFromEuler(this.tempEuler)
      this.tempScale.setScalar(scale)
      this.tempV3.set(this.tempPos.x, this.tempPos.y, this.tempPos.z)
      this.tempMatrix.compose(this.tempV3, this.tempQuat, this.tempScale)

      this.smokeMesh.setMatrixAt(writeIndex, this.tempMatrix)
      this.instanceColor.setRGB(shade, shade * 0.98, shade * 0.9)
      this.smokeMesh.setColorAt(writeIndex, this.instanceColor)
      writeIndex++
    })

    this.smokeMesh.count = writeIndex
    this.smokeMesh.instanceMatrix.needsUpdate = true
    if (this.smokeMesh.instanceColor) this.smokeMesh.instanceColor.needsUpdate = true
  }

  private writeDustMesh(): void {
    let writeIndex = 0
    this.dustPool.forEachAlive((poolIndex, lifeT) => {
      this.dustPool.getPosition(poolIndex, this.tempPos)
      const scale = this.dustPool.getScale(poolIndex, lifeT)
      const alphaLike = 1 - lifeT
      const shade = 0.36 + alphaLike * 0.44

      this.tempEuler.set(0, this.dustPool.getRotation(poolIndex), 0)
      this.tempQuat.setFromEuler(this.tempEuler)
      this.tempScale.setScalar(scale)
      this.tempV3.set(this.tempPos.x, this.tempPos.y, this.tempPos.z)
      this.tempMatrix.compose(this.tempV3, this.tempQuat, this.tempScale)

      this.dustMesh.setMatrixAt(writeIndex, this.tempMatrix)
      this.instanceColor.setRGB(shade * 1.02, shade * 0.92, shade * 0.72)
      this.dustMesh.setColorAt(writeIndex, this.instanceColor)
      writeIndex++
    })

    this.dustMesh.count = writeIndex
    this.dustMesh.instanceMatrix.needsUpdate = true
    if (this.dustMesh.instanceColor) this.dustMesh.instanceColor.needsUpdate = true
  }

  dispose(): void {
    this.scene.remove(this.smokeMesh)
    this.scene.remove(this.dustMesh)

    this.smokeMesh.geometry.dispose()
    this.dustMesh.geometry.dispose()

    const smokeMat = this.smokeMesh.material
    if (Array.isArray(smokeMat)) {
      for (const m of smokeMat) m.dispose()
    } else {
      smokeMat.dispose()
    }

    const dustMat = this.dustMesh.material
    if (Array.isArray(dustMat)) {
      for (const m of dustMat) m.dispose()
    } else {
      dustMat.dispose()
    }
  }
}

function randomDirectionInCone(dir: Vec3, coneHalfAngle: number): Vec3 {
  const base = new THREE.Vector3(dir.x, dir.y, dir.z)
  if (base.lengthSq() < 1e-6) return { x: 0, y: 0, z: 1 }
  base.normalize()

  const up = Math.abs(base.y) > 0.98 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0)
  const right = new THREE.Vector3().crossVectors(base, up).normalize()
  const orthoUp = new THREE.Vector3().crossVectors(right, base).normalize()

  const theta = Math.random() * coneHalfAngle
  const phi = Math.random() * Math.PI * 2
  const sinTheta = Math.sin(theta)
  const cosTheta = Math.cos(theta)

  const v = new THREE.Vector3()
    .copy(base)
    .multiplyScalar(cosTheta)
    .addScaledVector(right, sinTheta * Math.cos(phi))
    .addScaledVector(orthoUp, sinTheta * Math.sin(phi))
    .normalize()

  return { x: v.x, y: v.y, z: v.z }
}
