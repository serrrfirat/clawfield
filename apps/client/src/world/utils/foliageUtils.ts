import * as THREE from 'three'
import { mulberry32 } from './randomUtils'

export interface FoliageType {
  id: string
  /** Relative weight for random selection (higher = more frequent) */
  weight: number
  minScale: number
  maxScale: number
}

export interface FoliageInstance {
  typeId: string
  localX: number
  localZ: number
  y: number
  scale: number
  rotY: number
}

const FOLIAGE_SEED_OFFSET = 0xF011A6E

/**
 * Generate foliage placements for a chunk using noise-based distribution.
 * Avoids overlap with existing stones and trees.
 */
export function generateChunkFoliage(
  chunkX: number,
  chunkZ: number,
  size: number,
  noise2D: (x: number, y: number) => number,
  terrainParams: { scale: number; amplitude: number },
  types: FoliageType[],
  options: {
    count: number
    noiseScale: number
    noiseThreshold: number
    padding: number
    minSpacing: number
    /** Occupied positions to avoid [localX, localZ, radius][] */
    occupied: [number, number, number][]
  }
): FoliageInstance[] {
  if (types.length === 0 || options.count <= 0) return []

  const seed = ((chunkX * 48611) ^ (chunkZ * 31547) ^ FOLIAGE_SEED_OFFSET) >>> 0
  const rng = mulberry32(seed)

  // Build weighted selection table
  const totalWeight = types.reduce((s, t) => s + t.weight, 0)
  const cumulativeWeights: number[] = []
  let acc = 0
  for (const t of types) {
    acc += t.weight / totalWeight
    cumulativeWeights.push(acc)
  }

  const pickType = (): FoliageType => {
    const r = rng()
    for (let i = 0; i < cumulativeWeights.length; i++) {
      if (r <= cumulativeWeights[i]) return types[i]
    }
    return types[types.length - 1]
  }

  const half = size * 0.5
  const pad = options.padding
  const placed: FoliageInstance[] = []
  const positions: [number, number][] = []
  const maxAttempts = options.count * 3

  for (let attempt = 0; attempt < maxAttempts && placed.length < options.count; attempt++) {
    const localX = THREE.MathUtils.lerp(-half + pad, half - pad, rng())
    const localZ = THREE.MathUtils.lerp(-half + pad, half - pad, rng())

    const worldX = localX + chunkX * size
    const worldZ = localZ + chunkZ * size

    // Noise check
    const n = noise2D(worldX * options.noiseScale, worldZ * options.noiseScale)
    if (n < options.noiseThreshold) continue

    // Min spacing against other foliage
    let tooClose = false
    for (const [px, pz] of positions) {
      const dx = localX - px
      const dz = localZ - pz
      if (dx * dx + dz * dz < options.minSpacing * options.minSpacing) {
        tooClose = true
        break
      }
    }
    if (tooClose) continue

    // Avoid occupied areas (stones, trees)
    for (const [ox, oz, or] of options.occupied) {
      const dx = localX - ox
      const dz = localZ - oz
      if (dx * dx + dz * dz < (or + options.minSpacing * 0.5) ** 2) {
        tooClose = true
        break
      }
    }
    if (tooClose) continue

    const type = pickType()
    const y = noise2D(worldX * terrainParams.scale, worldZ * terrainParams.scale) * terrainParams.amplitude
    const scale = THREE.MathUtils.lerp(type.minScale, type.maxScale, rng())
    const rotY = rng() * Math.PI * 2

    positions.push([localX, localZ])
    placed.push({
      typeId: type.id,
      localX,
      localZ,
      y,
      scale,
      rotY,
    })
  }

  return placed
}
