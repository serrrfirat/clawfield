export interface EditorPlacement {
  id: string
  assetId: string
  position: [number, number, number]
  rotation: [number, number, number]
  scale: [number, number, number]
  source: 'manual' | 'scatter' | 'ai'
  metadata?: EditorPlacementMetadata
}

export interface EditorPlacementMetadata {
  collidable?: boolean
  [key: string]: unknown
}

export interface PrimitiveGeometry {
  shape: 'box' | 'cylinder' | 'cone' | 'sphere'
  args: number[]
  color: string
}

export interface AssetEntry {
  id: string
  name: string
  category: 'structures' | 'vegetation' | 'props' | 'vehicles'
  path: string
  tags: string[]
  defaultScale: number
  collidable?: boolean
  primitive?: PrimitiveGeometry
}

export interface ScatterConfig {
  assetId: string
  assetIds: string[]
  radius: number
  density: number
  noiseScale: number
  noiseThreshold: number
  minScale: number
  maxScale: number
  minSpacing: number
  seed: number
}

export type EditorTool = 'select' | 'place' | 'scatter' | 'height'
export type GizmoMode = 'translate' | 'rotate' | 'scale'

export interface HeightmapCell {
  x: number
  z: number
  h: number
}

export interface TerrainHeightmap {
  cellSize: number
  cells: HeightmapCell[]
}

export interface MapdefJson {
  name: string
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number }
  terrain: { seed: number; scale: number; amplitude: number; waterLevel?: number }
  heightmap?: TerrainHeightmap
  placements: MapdefPlacement[]
  editorState?: {
    cameraTarget: [number, number, number]
    cameraZoom: number
  }
}

export interface MapdefPlacement {
  componentId: string
  position: [number, number, number]
  rotation: [number, number, number]
  scale: [number, number, number]
  source?: string
  metadata?: Record<string, unknown>
}
