import type { Vec3 } from '@clawfield/shared'

interface SmokeZone {
  position: Vec3
  radius: number
  expiresAt: number // Date.now() + duration*1000
}

export class SmokeZoneTracker {
  private zones: SmokeZone[] = []

  addZone(position: Vec3, radius: number, duration: number): void {
    this.zones.push({
      position: { ...position },
      radius,
      expiresAt: Date.now() + duration * 1000,
    })
  }

  /** Prune expired zones. Call each tick. */
  update(): void {
    const now = Date.now()
    for (let i = this.zones.length - 1; i >= 0; i--) {
      if (this.zones[i].expiresAt <= now) {
        this.zones.splice(i, 1)
      }
    }
  }

  /** Check if a ray from p1 to p2 intersects any smoke zone (sphere). */
  rayIntersectsSmoke(p1: Vec3, p2: Vec3): boolean {
    const dx = p2.x - p1.x
    const dy = p2.y - p1.y
    const dz = p2.z - p1.z

    for (const zone of this.zones) {
      const ox = p1.x - zone.position.x
      const oy = p1.y - zone.position.y
      const oz = p1.z - zone.position.z

      const a = dx * dx + dy * dy + dz * dz
      const b = 2 * (ox * dx + oy * dy + oz * dz)
      const c = ox * ox + oy * oy + oz * oz - zone.radius * zone.radius

      const disc = b * b - 4 * a * c
      if (disc < 0) continue

      const sqrtDisc = Math.sqrt(disc)
      const t1 = (-b - sqrtDisc) / (2 * a)
      const t2 = (-b + sqrtDisc) / (2 * a)

      // Intersection if any t in [0, 1]
      if (t1 <= 1 && t2 >= 0) return true
    }
    return false
  }

  /** Check if a point is inside any active smoke zone. */
  pointInSmoke(point: Vec3): boolean {
    for (const zone of this.zones) {
      const dx = point.x - zone.position.x
      const dy = point.y - zone.position.y
      const dz = point.z - zone.position.z
      if (dx * dx + dy * dy + dz * dz <= zone.radius * zone.radius) {
        return true
      }
    }
    return false
  }
}
