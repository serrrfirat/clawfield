import * as THREE from 'three'

export type MaterialType = 'concrete' | 'wood' | 'metal'

interface DebrisVariant {
  geometry: THREE.BufferGeometry
  material: THREE.MeshStandardMaterial
}

export interface DebrisLibrary {
  concrete: DebrisVariant[]
  wood: DebrisVariant[]
  metal: DebrisVariant[]
  getVariants(type: MaterialType): DebrisVariant[]
  dispose(): void
}

/** Create an irregular low-poly chunk by jittering a box's vertices. */
function createChunkGeometry(
  sx: number, sy: number, sz: number, jitter: number,
): THREE.BufferGeometry {
  const geom = new THREE.BoxGeometry(sx, sy, sz, 1, 1, 1)
  const pos = geom.getAttribute('position')
  for (let i = 0; i < pos.count; i++) {
    pos.setX(i, pos.getX(i) + (Math.random() - 0.5) * sx * jitter)
    pos.setY(i, pos.getY(i) + (Math.random() - 0.5) * sy * jitter)
    pos.setZ(i, pos.getZ(i) + (Math.random() - 0.5) * sz * jitter)
  }
  pos.needsUpdate = true
  geom.computeVertexNormals()
  return geom
}

/** Create an elongated plank/splinter geometry. */
function createSplinterGeometry(
  length: number, width: number, height: number,
): THREE.BufferGeometry {
  const geom = new THREE.BoxGeometry(width, height, length, 1, 1, 2)
  const pos = geom.getAttribute('position')
  for (let i = 0; i < pos.count; i++) {
    const z = pos.getZ(i)
    // Taper towards ends
    const taper = 1 - Math.abs(z) / (length * 0.5) * 0.35
    pos.setX(i, pos.getX(i) * taper + (Math.random() - 0.5) * width * 0.15)
    pos.setY(i, pos.getY(i) * taper + (Math.random() - 0.5) * height * 0.15)
  }
  pos.needsUpdate = true
  geom.computeVertexNormals()
  return geom
}

/** Create a flat jagged shrapnel piece. */
function createShrapnelGeometry(
  sx: number, sz: number, thickness: number,
): THREE.BufferGeometry {
  const geom = new THREE.BoxGeometry(sx, thickness, sz, 2, 1, 2)
  const pos = geom.getAttribute('position')
  for (let i = 0; i < pos.count; i++) {
    pos.setX(i, pos.getX(i) + (Math.random() - 0.5) * sx * 0.3)
    pos.setZ(i, pos.getZ(i) + (Math.random() - 0.5) * sz * 0.3)
  }
  pos.needsUpdate = true
  geom.computeVertexNormals()
  return geom
}

function randomInRange(min: number, max: number): number {
  return min + Math.random() * (max - min)
}

/**
 * Create the full debris library. Call once at init time.
 * Returns pooled geometries + materials for each material type.
 */
export function createDebrisLibrary(): DebrisLibrary {
  // --- Concrete chunks: 5 irregular box variants ---
  const concrete: DebrisVariant[] = []
  for (let i = 0; i < 5; i++) {
    const r = randomInRange(130, 150) / 255
    const g = randomInRange(130, 150) / 255
    const b = randomInRange(130, 150) / 255
    concrete.push({
      geometry: createChunkGeometry(
        randomInRange(0.15, 0.35),
        randomInRange(0.12, 0.28),
        randomInRange(0.15, 0.35),
        0.25,
      ),
      material: new THREE.MeshStandardMaterial({
        color: new THREE.Color(r, g, b),
        roughness: 0.95,
        metalness: 0,
      }),
    })
  }

  // --- Wood splinters: 4 elongated plank variants ---
  const wood: DebrisVariant[] = []
  for (let i = 0; i < 4; i++) {
    const r = randomInRange(140, 170) / 255
    const g = randomInRange(100, 130) / 255
    const b = randomInRange(60, 90) / 255
    wood.push({
      geometry: createSplinterGeometry(
        randomInRange(0.3, 0.55),
        randomInRange(0.06, 0.12),
        randomInRange(0.04, 0.08),
      ),
      material: new THREE.MeshStandardMaterial({
        color: new THREE.Color(r, g, b),
        roughness: 0.9,
        metalness: 0,
      }),
    })
  }

  // --- Metal shrapnel: 4 flat jagged variants ---
  const metal: DebrisVariant[] = []
  for (let i = 0; i < 4; i++) {
    const r = randomInRange(90, 110) / 255
    const g = randomInRange(90, 110) / 255
    const b = randomInRange(100, 120) / 255
    metal.push({
      geometry: createShrapnelGeometry(
        randomInRange(0.12, 0.25),
        randomInRange(0.12, 0.25),
        randomInRange(0.02, 0.05),
      ),
      material: new THREE.MeshStandardMaterial({
        color: new THREE.Color(r, g, b),
        roughness: 0.5,
        metalness: 0.6,
      }),
    })
  }

  return {
    concrete,
    wood,
    metal,
    getVariants(type: MaterialType): DebrisVariant[] {
      return this[type]
    },
    dispose() {
      for (const list of [concrete, wood, metal]) {
        for (const v of list) {
          v.geometry.dispose()
          v.material.dispose()
        }
      }
    },
  }
}
