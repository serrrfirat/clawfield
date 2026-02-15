import * as THREE from 'three'

interface ActiveShake {
  intensity: number
  duration: number
  elapsed: number
  falloffDistance: number
  sourcePosition: THREE.Vector3 | null
}

const MAX_OFFSET = 0.3

export class CameraShake {
  private shakes: ActiveShake[] = []
  private offset = new THREE.Vector3()
  private cameraPosition: THREE.Vector3 | null = null

  /** Register the camera position for distance-based falloff. Call each frame before update(). */
  setCameraPosition(pos: THREE.Vector3): void {
    this.cameraPosition = pos
  }

  /**
   * Add a new shake event.
   * @param intensity - Base shake magnitude (0-1 range typical)
   * @param duration - How long the shake lasts in seconds
   * @param falloffDistance - Distance at which shake is fully attenuated (0 = no falloff)
   * @param sourcePosition - World position of the shake source (null = no distance attenuation)
   */
  addShake(
    intensity: number,
    duration: number,
    falloffDistance = 0,
    sourcePosition?: THREE.Vector3 | null,
  ): void {
    // Apply distance attenuation immediately if we have both positions
    let effectiveIntensity = intensity
    if (sourcePosition && this.cameraPosition && falloffDistance > 0) {
      const dist = this.cameraPosition.distanceTo(sourcePosition)
      effectiveIntensity *= Math.max(0, 1 - dist / falloffDistance)
    }

    if (effectiveIntensity < 0.01) return

    this.shakes.push({
      intensity: effectiveIntensity,
      duration,
      elapsed: 0,
      falloffDistance,
      sourcePosition: sourcePosition ? sourcePosition.clone() : null,
    })
  }

  /** Advance all active shakes and compute the combined offset. */
  update(dt: number): void {
    this.offset.set(0, 0, 0)

    for (let i = this.shakes.length - 1; i >= 0; i--) {
      const shake = this.shakes[i]
      shake.elapsed += dt

      if (shake.elapsed >= shake.duration) {
        this.shakes.splice(i, 1)
        continue
      }

      // Decay intensity linearly over duration
      const remaining = 1 - shake.elapsed / shake.duration
      const currentIntensity = shake.intensity * remaining

      // Random offset per shake
      this.offset.x += (Math.random() - 0.5) * 2 * currentIntensity
      this.offset.y += (Math.random() - 0.5) * 2 * currentIntensity
      this.offset.z += (Math.random() - 0.5) * 2 * currentIntensity
    }

    // Clamp total offset
    const len = this.offset.length()
    if (len > MAX_OFFSET) {
      this.offset.multiplyScalar(MAX_OFFSET / len)
    }
  }

  /** Get the current shake offset to apply to the camera position. */
  getOffset(): THREE.Vector3 {
    return this.offset
  }

  dispose(): void {
    this.shakes.length = 0
    this.offset.set(0, 0, 0)
  }
}
