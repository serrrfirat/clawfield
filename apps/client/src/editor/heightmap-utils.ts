import type { HeightmapCell, TerrainHeightmap } from './editor-types'

export function cellKey(x: number, z: number): string {
  return `${x},${z}`
}

export function quantizeToCell(value: number, cellSize: number): number {
  return Math.round(value / cellSize)
}

export function toSparseHeightmap(cellSize: number, cellsByKey: Record<string, number>): TerrainHeightmap {
  const cells: HeightmapCell[] = []
  for (const [key, h] of Object.entries(cellsByKey)) {
    if (Math.abs(h) < 1e-4) continue
    const [sx, sz] = key.split(',')
    const x = Number(sx)
    const z = Number(sz)
    if (!Number.isFinite(x) || !Number.isFinite(z)) continue
    cells.push({ x, z, h })
  }
  return { cellSize, cells }
}

export function fromSparseHeightmap(heightmap: TerrainHeightmap | undefined): Record<string, number> {
  if (!heightmap?.cells?.length) return {}
  const out: Record<string, number> = {}
  for (const c of heightmap.cells) {
    if (!Number.isFinite(c.h)) continue
    out[cellKey(c.x, c.z)] = c.h
  }
  return out
}

export function sampleHeightDelta(wx: number, wz: number, cellSize: number, cellsByKey: Record<string, number>): number {
  if (!cellsByKey || Object.keys(cellsByKey).length === 0) return 0

  const gx = wx / cellSize
  const gz = wz / cellSize

  const x0 = Math.floor(gx)
  const z0 = Math.floor(gz)
  const x1 = x0 + 1
  const z1 = z0 + 1

  const tx = gx - x0
  const tz = gz - z0

  const h00 = cellsByKey[cellKey(x0, z0)] ?? 0
  const h10 = cellsByKey[cellKey(x1, z0)] ?? 0
  const h01 = cellsByKey[cellKey(x0, z1)] ?? 0
  const h11 = cellsByKey[cellKey(x1, z1)] ?? 0

  const hx0 = h00 + (h10 - h00) * tx
  const hx1 = h01 + (h11 - h01) * tx
  return hx0 + (hx1 - hx0) * tz
}
