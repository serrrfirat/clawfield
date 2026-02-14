import * as THREE from 'three'
import type { Vec3 } from '@clawfield/shared'
import {
  MAT_CONCRETE,
  MAT_CONCRETE_DARK,
  MAT_METAL,
  MAT_ROAD,
  MAT_WOOD,
  MAT_WOOD_DARK,
} from '@clawfield/shared'
import { InstancedParticlePool } from './instanced-particle-pool'

const DUST_CAPACITY = 1200
const CHIP_CAPACITY = 1200

type ImpactProfile = {
  dustCount: number
  chipCount: number
  dustColor: [number, number, number]
  chipColor: [number, number, number]
}

const DEFAULT_PROFILE: ImpactProfile = {
  dustCount: 8,
  chipCount: 6,
  dustColor: [0.72, 0.66, 0.53],
  chipColor: [0.7, 0.62, 0.5],
}

const CONCRETE_PROFILE: ImpactProfile = {
  dustCount: 9,
  chipCount: 8,
  dustColor: [0.62, 0.62, 0.62],
  chipColor: [0.58, 0.58, 0.58],
}

const METAL_PROFILE: ImpactProfile = {
  dustCount: 4,
  chipCount: 10,
  dustColor: [0.56, 0.58, 0.62],
  chipColor: [0.68, 0.7, 0.74],
}

const WOOD_PROFILE: ImpactProfile = {
  dustCount: 7,
  chipCount: 8,
  dustColor: [0.58, 0.44, 0.28],
  chipColor: [0.64, 0.5, 0.34],
}

function profileForMaterial(mat: number): ImpactProfile {
  if (mat === MAT_METAL) return METAL_PROFILE
  if (mat === MAT_WOOD || mat === MAT_WOOD_DARK) return WOOD_PROFILE
  if (mat === MAT_CONCRETE || mat === MAT_CONCRETE_DARK || mat === MAT_ROAD) return CONCRETE_PROFILE
  return DEFAULT_PROFILE
}

function randomUnitXZ(): { x: number; z: number } {
  const a = Math.random() * Math.PI * 2
  return { x: Math.cos(a), z: Math.sin(a) }
}

export class ImpactSystem {
  private scene: THREE.Scene
  private dustPool = new InstancedParticlePool(DUST_CAPACITY)
  private chipPool = new InstancedParticlePool(CHIP_CAPACITY)

  private dustMesh: THREE.InstancedMesh
  private chipMesh: THREE.InstancedMesh

  private tempPos: Vec3 = { x: 0, y: 0, z: 0 }
  private tempV3 = new THREE.Vector3()
  private tempMatrix = new THREE.Matrix4()
  private tempQuat = new THREE.Quaternion()
  private tempScale = new THREE.Vector3(1, 1, 1)
  private tempEuler = new THREE.Euler(0, 0, 0)
  private color = new THREE.Color(1, 1, 1)

  constructor(scene: THREE.Scene) {
    this.scene = scene

    const dustGeo = new THREE.IcosahedronGeometry(0.06, 0)
    const dustMat = new THREE.MeshStandardMaterial({ color: '#9f9378', roughness: 1, metalness: 0 })
    this.dustMesh = new THREE.InstancedMesh(dustGeo, dustMat, DUST_CAPACITY)
    this.dustMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    this.dustMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(DUST_CAPACITY * 3), 3)
    this.dustMesh.count = 0
    this.dustMesh.frustumCulled = false
    this.scene.add(this.dustMesh)

    const chipGeo = new THREE.BoxGeometry(0.05, 0.05, 0.05)
    const chipMat = new THREE.MeshStandardMaterial({ color: '#9a8d73', roughness: 0.95, metalness: 0.05 })
    this.chipMesh = new THREE.InstancedMesh(chipGeo, chipMat, CHIP_CAPACITY)
    this.chipMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    this.chipMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(CHIP_CAPACITY * 3), 3)
    this.chipMesh.count = 0
    this.chipMesh.frustumCulled = false
    this.scene.add(this.chipMesh)
  }

  spawnImpact(position: Vec3, velocity: Vec3, materialId: number): void {
    const profile = profileForMaterial(materialId)
    const vLen = Math.sqrt(velocity.x * velocity.x + velocity.y * velocity.y + velocity.z * velocity.z)
    const nx = vLen > 0.001 ? velocity.x / vLen : 0
    const nz = vLen > 0.001 ? velocity.z / vLen : 0

    for (let i = 0; i < profile.dustCount; i++) {
      const rz = randomUnitXZ()
      const spray = 0.4 + Math.random() * 2.2
      this.dustPool.spawn({
        position: {
          x: position.x + rz.x * 0.05,
          y: position.y + 0.03 + Math.random() * 0.05,
          z: position.z + rz.z * 0.05,
        },
        velocity: {
          x: rz.x * spray - nx * 0.45,
          y: 0.45 + Math.random() * 1.1,
          z: rz.z * spray - nz * 0.45,
        },
        lifetime: 0.18 + Math.random() * 0.35,
        gravity: -3.0,
        drag: 4.8,
        startScale: 0.07 + Math.random() * 0.08,
        endScale: 0.16 + Math.random() * 0.2,
        rotation: Math.random() * Math.PI * 2,
        angularVelocity: (Math.random() - 0.5) * 8,
      })
    }

    for (let i = 0; i < profile.chipCount; i++) {
      const rz = randomUnitXZ()
      const spray = 0.8 + Math.random() * 3.1
      this.chipPool.spawn({
        position: {
          x: position.x + rz.x * 0.02,
          y: position.y + 0.02,
          z: position.z + rz.z * 0.02,
        },
        velocity: {
          x: rz.x * spray - nx * 0.75,
          y: 0.7 + Math.random() * 1.9,
          z: rz.z * spray - nz * 0.75,
        },
        lifetime: 0.22 + Math.random() * 0.42,
        gravity: -8.2,
        drag: 2.4,
        startScale: 0.05 + Math.random() * 0.07,
        endScale: 0.06 + Math.random() * 0.03,
        rotation: Math.random() * Math.PI * 2,
        angularVelocity: (Math.random() - 0.5) * 10,
      })
    }

    this.color.setRGB(profile.dustColor[0], profile.dustColor[1], profile.dustColor[2])
    ;(this.dustMesh.material as THREE.MeshStandardMaterial).color.copy(this.color)
    this.color.setRGB(profile.chipColor[0], profile.chipColor[1], profile.chipColor[2])
    ;(this.chipMesh.material as THREE.MeshStandardMaterial).color.copy(this.color)
  }

  update(dt: number): void {
    this.dustPool.update(dt)
    this.chipPool.update(dt)

    let dustCount = 0
    this.dustPool.forEachAlive((i, lifeT) => {
      this.dustPool.getPosition(i, this.tempPos)
      const scale = this.dustPool.getScale(i, lifeT)
      this.tempEuler.set(0, this.dustPool.getRotation(i), 0)
      this.tempQuat.setFromEuler(this.tempEuler)
      this.tempScale.setScalar(scale)
      this.tempV3.set(this.tempPos.x, this.tempPos.y, this.tempPos.z)
      this.tempMatrix.compose(this.tempV3, this.tempQuat, this.tempScale)
      this.dustMesh.setMatrixAt(dustCount, this.tempMatrix)
      dustCount++
    })
    this.dustMesh.count = dustCount
    this.dustMesh.instanceMatrix.needsUpdate = true

    let chipCount = 0
    this.chipPool.forEachAlive((i, lifeT) => {
      this.chipPool.getPosition(i, this.tempPos)
      const scale = this.chipPool.getScale(i, lifeT)
      this.tempEuler.set(0, this.chipPool.getRotation(i), 0)
      this.tempQuat.setFromEuler(this.tempEuler)
      this.tempScale.setScalar(scale)
      this.tempV3.set(this.tempPos.x, this.tempPos.y, this.tempPos.z)
      this.tempMatrix.compose(this.tempV3, this.tempQuat, this.tempScale)
      this.chipMesh.setMatrixAt(chipCount, this.tempMatrix)
      chipCount++
    })
    this.chipMesh.count = chipCount
    this.chipMesh.instanceMatrix.needsUpdate = true
  }

  dispose(): void {
    this.scene.remove(this.dustMesh)
    this.scene.remove(this.chipMesh)
    this.dustMesh.geometry.dispose()
    this.chipMesh.geometry.dispose()
    if (Array.isArray(this.dustMesh.material)) {
      this.dustMesh.material.forEach((m) => m.dispose())
    } else {
      this.dustMesh.material.dispose()
    }
    if (Array.isArray(this.chipMesh.material)) {
      this.chipMesh.material.forEach((m) => m.dispose())
    } else {
      this.chipMesh.material.dispose()
    }
  }
}
