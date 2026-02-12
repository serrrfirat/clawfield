import { createNoise2D } from 'simplex-noise'
import { mulberry32 } from '../world/utils/randomUtils'
import { getTerrainHeight } from './EditorTerrain'
import type { EditorPlacement, ScatterConfig } from './editor-types'

export function generateScatter(
  config: ScatterConfig,
  center: [number, number, number]
): EditorPlacement[] {
  const rng = mulberry32(config.seed)
  const noise2D = createNoise2D(mulberry32(config.seed + 7))

  // Build asset pool: multi-select takes priority, fall back to single assetId
  const pool = config.assetIds.length > 0 ? config.assetIds : config.assetId ? [config.assetId] : []
  if (pool.length === 0) return []

  const placements: EditorPlacement[] = []
  const placed: [number, number][] = []
  const { radius, density, noiseScale, noiseThreshold, minScale, maxScale, minSpacing } = config

  // Grid-based sampling
  const step = 1 / Math.max(0.01, density)
  const [cx, , cz] = center

  for (let x = cx - radius; x <= cx + radius; x += step) {
    for (let z = cz - radius; z <= cz + radius; z += step) {
      // Circle check
      const dx = x - cx
      const dz = z - cz
      if (dx * dx + dz * dz > radius * radius) continue

      // Noise threshold
      const n = noise2D(x * noiseScale, z * noiseScale)
      if (n < noiseThreshold) continue

      // Random jitter
      const jx = x + (rng() - 0.5) * step * 0.8
      const jz = z + (rng() - 0.5) * step * 0.8

      // Min spacing check
      let tooClose = false
      for (const [px, pz] of placed) {
        const d2 = (jx - px) ** 2 + (jz - pz) ** 2
        if (d2 < minSpacing * minSpacing) {
          tooClose = true
          break
        }
      }
      if (tooClose) continue

      const y = getTerrainHeight(jx, jz)
      const s = minScale + rng() * (maxScale - minScale)
      const rotY = rng() * Math.PI * 2

      // Pick random asset from pool
      const assetId = pool[Math.floor(rng() * pool.length)]

      placed.push([jx, jz])
      placements.push({
        id: crypto.randomUUID(),
        assetId,
        position: [jx, y, jz],
        rotation: [0, rotY, 0],
        scale: [s, s, s],
        source: 'scatter',
      })
    }
  }

  return placements
}
