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
  suppressGrass?: boolean
  grassSuppressRadius?: number
  colliderType?: ColliderType
  colliderScale?: number
  destructible?: boolean
  destructionProfile?: string
  [key: string]: unknown
}

export type ColliderType = 'none' | 'cuboid' | 'trimesh'

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
  colliderType?: ColliderType
  colliderScale?: number
  destructible?: boolean
  destructionProfile?: string
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

export type EditorTool = 'select' | 'place' | 'scatter' | 'height' | 'road'
export type GizmoMode = 'translate' | 'rotate' | 'scale'

export type RoadTextureId = 'road_1' | 'road_2'

export interface RoadSpline {
  id: string
  textureId: RoadTextureId
  width: number
  points: [number, number][]
}

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
  roads?: RoadSpline[]
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
