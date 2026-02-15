import * as THREE from 'three'
import type { Vec3 } from '@clawfield/shared'
import { BillboardSmokeCloud } from './billboard-smoke-cloud'

const MAX_CLOUDS = 30

export class BillboardSmokeSystem {
  private scene: THREE.Scene
  private clouds: BillboardSmokeCloud[] = []

  constructor(scene: THREE.Scene) {
    this.scene = scene
  }

  addCloud(position: Vec3, radius: number, duration: number): void {
    if (this.clouds.length >= MAX_CLOUDS) {
      // Dispose oldest
      const oldest = this.clouds.shift()!
      this.scene.remove(oldest.mesh)
      oldest.dispose()
    }

    const cloud = new BillboardSmokeCloud(position, radius, duration)
    this.scene.add(cloud.mesh)
    this.clouds.push(cloud)
  }

  update(dt: number, camera: THREE.Camera): void {
    for (let i = this.clouds.length - 1; i >= 0; i--) {
      const cloud = this.clouds[i]
      cloud.update(dt, camera)

      if (cloud.isExpired) {
        this.scene.remove(cloud.mesh)
        cloud.dispose()
        this.clouds.splice(i, 1)
      }
    }
  }

  dispose(): void {
    for (const cloud of this.clouds) {
      this.scene.remove(cloud.mesh)
      cloud.dispose()
    }
    this.clouds.length = 0
  }
}
