import { create } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'
import type {
  EditorPlacement,
  EditorPrefab,
  EditorTool,
  GizmoMode,
  AssetEntry,
  RoadSpline,
  RoadTextureId,
} from './editor-types'
import catalog from './asset-catalog.json'
import { cellKey, quantizeToCell, sampleHeightDelta } from './heightmap-utils'

function isAiGenAsset(asset: AssetEntry): boolean {
  return asset.id.startsWith('france-ai-') || asset.tags.includes('ai-gen')
}

interface EditorState {
  // Tools
  activeTool: EditorTool
  gizmoMode: GizmoMode
  setActiveTool: (tool: EditorTool) => void
  setGizmoMode: (mode: GizmoMode) => void

  // Asset selection
  assets: AssetEntry[]
  selectedAssetId: string | null
  selectAsset: (id: string | null) => void

  // Placements
  placements: EditorPlacement[]
  selectedPlacementId: string | null
  addPlacement: (p: EditorPlacement) => void
  updatePlacement: (id: string, updates: Partial<EditorPlacement>) => void
  removePlacement: (id: string) => void
  selectPlacement: (id: string | null) => void
  setPlacements: (placements: EditorPlacement[]) => void

  // Ghost (cursor preview)
  ghostPosition: [number, number, number]
  ghostRotation: number
  setGhostPosition: (pos: [number, number, number]) => void
  rotateGhost: (delta: number) => void

  // Camera
  cameraTarget: [number, number, number]
  cameraZoom: number
  setCameraTarget: (target: [number, number, number]) => void
  setCameraZoom: (zoom: number) => void

  // Map metadata
  mapName: string
  setMapName: (name: string) => void
  dirty: boolean
  setDirty: (d: boolean) => void

  // Terrain editing
  terrainSeed: number
  terrainScale: number
  terrainAmplitude: number
  waterLevel: number
  heightCellSize: number
  heightBrushRadius: number
  heightBrushStrength: number
  heightBrushMode: 'raise' | 'lower' | 'flatten'
  heightCells: Record<string, number>
  heightRevision: number
  setWaterLevel: (level: number) => void
  setHeightBrushRadius: (radius: number) => void
  setHeightBrushStrength: (strength: number) => void
  setHeightBrushMode: (mode: 'raise' | 'lower' | 'flatten') => void
  setHeightCells: (cells: Record<string, number>) => void
  sampleHeightDeltaAt: (x: number, z: number) => number
  applyHeightBrushAt: (x: number, z: number) => void
  autoFlattenOnPlace: boolean
  flattenRadiusScale: number
  setAutoFlattenOnPlace: (v: boolean) => void
  setFlattenRadiusScale: (v: number) => void
  flattenHeightAround: (x: number, z: number, radius: number) => void

  // Roads
  roads: RoadSpline[]
  draftRoadId: string | null
  roadTextureId: RoadTextureId
  roadWidth: number
  setRoads: (roads: RoadSpline[]) => void
  setRoadTextureId: (id: RoadTextureId) => void
  setRoadWidth: (width: number) => void
  addRoadPointAt: (x: number, z: number) => void
  finishRoadStroke: () => void

  // Line tool
  lineStart: [number, number, number] | null
  lineEnd: [number, number, number] | null
  lineSpacing: number
  lineAlignRotation: boolean
  setLineStart: (pos: [number, number, number] | null) => void
  setLineEnd: (pos: [number, number, number] | null) => void
  setLineSpacing: (v: number) => void
  setLineAlignRotation: (v: boolean) => void

  // Debug visualization
  showColliderDebug: boolean
  toggleColliderDebug: () => void

  // Tactical readability overlays
  showCoverVisualizer: boolean
  toggleCoverVisualizer: () => void
  showNavGrid: boolean
  toggleNavGrid: () => void
  navGridCellSize: number
  navGridRadius: number
  setNavGridCellSize: (v: number) => void
  setNavGridRadius: (v: number) => void
  showLosProbe: boolean
  toggleLosProbe: () => void
  losProbeOrigin: [number, number, number] | null
  losProbeAim: [number, number, number] | null
  losProbeRange: number
  losProbeFovDeg: number
  setLosProbeOrigin: (pos: [number, number, number] | null) => void
  setLosProbeAim: (pos: [number, number, number] | null) => void
  setLosProbeRange: (v: number) => void
  setLosProbeFovDeg: (v: number) => void

  // Placement jitter
  placementJitterEnabled: boolean
  placementJitterScalePct: number
  placementJitterRotationDeg: number
  setPlacementJitterEnabled: (v: boolean) => void
  setPlacementJitterScalePct: (v: number) => void
  setPlacementJitterRotationDeg: (v: number) => void

  // Prefabs
  prefabs: EditorPrefab[]
  prefabCaptureRadius: number
  setPrefabs: (prefabs: EditorPrefab[]) => void
  setPrefabCaptureRadius: (v: number) => void
  capturePrefabAroundCamera: (name: string) => void
  deletePrefab: (id: string) => void
  stampPrefabAtGhost: (id: string) => void

  // Runtime look preview
  runtimePreview: boolean
  toggleRuntimePreview: () => void

  // Birds-eye (top-down 2D) view
  birdsEye: boolean
  toggleBirdsEye: () => void
}

const useEditorStore = create<EditorState>()(
  subscribeWithSelector<EditorState>((set) => ({
    activeTool: 'select' as EditorTool,
    gizmoMode: 'translate' as GizmoMode,
    setActiveTool: (tool) => set({ activeTool: tool }),
    setGizmoMode: (mode) => set({ gizmoMode: mode }),

    assets: catalog as AssetEntry[],
    selectedAssetId: null,
    selectAsset: (id) => set({ selectedAssetId: id, activeTool: id ? 'place' : 'select' }),

    placements: [],
    selectedPlacementId: null,
    addPlacement: (p) =>
      set((s) => ({ placements: [...s.placements, p], dirty: true })),
    updatePlacement: (id, updates) =>
      set((s) => ({
        placements: s.placements.map((p) => (p.id === id ? { ...p, ...updates } : p)),
        dirty: true,
      })),
    removePlacement: (id) =>
      set((s) => ({
        placements: s.placements.filter((p) => p.id !== id),
        selectedPlacementId: s.selectedPlacementId === id ? null : s.selectedPlacementId,
        dirty: true,
      })),
    selectPlacement: (id) => set({ selectedPlacementId: id }),
    setPlacements: (placements) => set({ placements, dirty: false }),

    ghostPosition: [0, 0, 0] as [number, number, number],
    ghostRotation: 0,
    setGhostPosition: (pos) => set({ ghostPosition: pos }),
    rotateGhost: (delta) => set((s) => ({ ghostRotation: s.ghostRotation + delta })),

    cameraTarget: [0, 0, 0] as [number, number, number],
    cameraZoom: 40,
    setCameraTarget: (target) => set({ cameraTarget: target }),
    setCameraZoom: (zoom) => set((s) => {
      const maxZoom = s.birdsEye ? 500 : 100
      return { cameraZoom: Math.max(10, Math.min(maxZoom, zoom)) }
    }),

    mapName: 'untitled',
    setMapName: (name) => set({ mapName: name }),
    dirty: false,
    setDirty: (d) => set({ dirty: d }),

    terrainSeed: 1337,
    terrainScale: 0.05,
    terrainAmplitude: 2,
    waterLevel: -0.5,
    heightCellSize: 1,
    heightBrushRadius: 2,
    heightBrushStrength: 0.18,
    heightBrushMode: 'raise' as 'raise' | 'lower' | 'flatten',
    heightCells: {},
    heightRevision: 0,
    setWaterLevel: (waterLevel) => set({ waterLevel, dirty: true }),
    setHeightBrushRadius: (heightBrushRadius) => set({ heightBrushRadius }),
    setHeightBrushStrength: (heightBrushStrength) => set({ heightBrushStrength }),
    setHeightBrushMode: (heightBrushMode) => set({ heightBrushMode }),
    setHeightCells: (heightCells) => set((s) => ({ heightCells, heightRevision: s.heightRevision + 1, dirty: true })),
    sampleHeightDeltaAt: (x, z) => {
      const s = useEditorStore.getState()
      return sampleHeightDelta(x, z, s.heightCellSize, s.heightCells)
    },
    applyHeightBrushAt: (x, z) =>
      set((s) => {
        const radius = Math.max(0.25, s.heightBrushRadius)
        const strength = Math.max(0.01, s.heightBrushStrength)
        const cellSize = Math.max(0.25, s.heightCellSize)
        const mode = s.heightBrushMode
        const next = { ...s.heightCells }

        const minX = quantizeToCell(x - radius, cellSize)
        const maxX = quantizeToCell(x + radius, cellSize)
        const minZ = quantizeToCell(z - radius, cellSize)
        const maxZ = quantizeToCell(z + radius, cellSize)

        for (let gx = minX; gx <= maxX; gx++) {
          for (let gz = minZ; gz <= maxZ; gz++) {
            const wx = gx * cellSize
            const wz = gz * cellSize
            const dx = wx - x
            const dz = wz - z
            const d = Math.sqrt(dx * dx + dz * dz)
            if (d > radius) continue

            const falloff = 1 - d / radius
            const delta = strength * falloff
            const key = cellKey(gx, gz)
            const prev = next[key] ?? 0

            if (mode === 'raise') {
              next[key] = prev + delta
            } else if (mode === 'lower') {
              next[key] = prev - delta
            } else {
              next[key] = prev + (0 - prev) * Math.min(1, falloff * 0.35)
            }

            if (Math.abs(next[key]) < 1e-4) {
              delete next[key]
            }
          }
        }

        return {
          heightCells: next,
          heightRevision: s.heightRevision + 1,
          dirty: true,
        }
      }),

    autoFlattenOnPlace: true,
    flattenRadiusScale: 1,
    setAutoFlattenOnPlace: (autoFlattenOnPlace) => set({ autoFlattenOnPlace }),
    setFlattenRadiusScale: (flattenRadiusScale) => set({ flattenRadiusScale: Math.max(0.4, Math.min(2.5, flattenRadiusScale)) }),
    flattenHeightAround: (x, z, radius) =>
      set((s) => {
        const cellSize = Math.max(0.25, s.heightCellSize)
        const target = sampleHeightDelta(x, z, cellSize, s.heightCells)
        const next = { ...s.heightCells }
        const r = Math.max(0.4, radius)
        const minX = quantizeToCell(x - r, cellSize)
        const maxX = quantizeToCell(x + r, cellSize)
        const minZ = quantizeToCell(z - r, cellSize)
        const maxZ = quantizeToCell(z + r, cellSize)

        for (let gx = minX; gx <= maxX; gx++) {
          for (let gz = minZ; gz <= maxZ; gz++) {
            const wx = gx * cellSize
            const wz = gz * cellSize
            const dx = wx - x
            const dz = wz - z
            const d = Math.sqrt(dx * dx + dz * dz)
            if (d > r) continue

            const key = cellKey(gx, gz)
            const prev = next[key] ?? 0
            const t = 1 - d / r
            const pull = Math.min(1, 0.55 + t * 0.45)
            next[key] = prev + (target - prev) * pull
            if (Math.abs(next[key]) < 1e-4) delete next[key]
          }
        }

        return {
          heightCells: next,
          heightRevision: s.heightRevision + 1,
          dirty: true,
        }
      }),

    roads: [],
    draftRoadId: null,
    roadTextureId: 'road_1',
    roadWidth: 3,
    setRoads: (roads) => set({ roads, draftRoadId: null, dirty: false }),
    setRoadTextureId: (roadTextureId) => set({ roadTextureId }),
    setRoadWidth: (roadWidth) => set({ roadWidth: Math.max(0.5, Math.min(20, roadWidth)) }),
    addRoadPointAt: (x, z) =>
      set((s) => {
        const point: [number, number] = [x, z]
        if (!s.draftRoadId) {
          const road: RoadSpline = {
            id: crypto.randomUUID(),
            textureId: s.roadTextureId,
            width: s.roadWidth,
            points: [point],
          }
          return { roads: [...s.roads, road], draftRoadId: road.id, dirty: true }
        }

        return {
          roads: s.roads.map((r) => {
            if (r.id !== s.draftRoadId) return r
            return {
              ...r,
              textureId: s.roadTextureId,
              width: s.roadWidth,
              points: [...r.points, point],
            }
          }),
          dirty: true,
        }
      }),
    finishRoadStroke: () =>
      set((s) => {
        if (!s.draftRoadId) return {}
        const road = s.roads.find((r) => r.id === s.draftRoadId)
        if (!road || road.points.length < 2) {
          return {
            roads: s.roads.filter((r) => r.id !== s.draftRoadId),
            draftRoadId: null,
            dirty: true,
          }
        }
        return { draftRoadId: null }
      }),

    lineStart: null,
    lineEnd: null,
    lineSpacing: 0,
    lineAlignRotation: true,
    setLineStart: (lineStart) => set({ lineStart }),
    setLineEnd: (lineEnd) => set({ lineEnd }),
    setLineSpacing: (lineSpacing) => set({ lineSpacing: Math.max(0, lineSpacing) }),
    setLineAlignRotation: (lineAlignRotation) => set({ lineAlignRotation }),

    showColliderDebug: false,
    toggleColliderDebug: () => set((s) => ({ showColliderDebug: !s.showColliderDebug })),

    showCoverVisualizer: false,
    toggleCoverVisualizer: () => set((s) => ({ showCoverVisualizer: !s.showCoverVisualizer })),

    showNavGrid: false,
    toggleNavGrid: () => set((s) => ({ showNavGrid: !s.showNavGrid })),
    navGridCellSize: 1.5,
    navGridRadius: 18,
    setNavGridCellSize: (v) => set({ navGridCellSize: Math.max(0.5, Math.min(6, v)) }),
    setNavGridRadius: (v) => set({ navGridRadius: Math.max(6, Math.min(60, Math.round(v))) }),

    showLosProbe: false,
    toggleLosProbe: () => set((s) => {
      const next = !s.showLosProbe
      return {
        showLosProbe: next,
        losProbeOrigin: next ? s.losProbeOrigin : null,
        losProbeAim: next ? s.losProbeAim : null,
      }
    }),
    losProbeOrigin: null,
    losProbeAim: null,
    losProbeRange: 70,
    losProbeFovDeg: 70,
    setLosProbeOrigin: (pos) => set({ losProbeOrigin: pos }),
    setLosProbeAim: (pos) => set({ losProbeAim: pos }),
    setLosProbeRange: (v) => set({ losProbeRange: Math.max(5, Math.min(220, v)) }),
    setLosProbeFovDeg: (v) => set({ losProbeFovDeg: Math.max(10, Math.min(170, v)) }),

    placementJitterEnabled: true,
    placementJitterScalePct: 0.1,
    placementJitterRotationDeg: 10,
    setPlacementJitterEnabled: (placementJitterEnabled) => set({ placementJitterEnabled }),
    setPlacementJitterScalePct: (placementJitterScalePct) => set({ placementJitterScalePct: Math.max(0, Math.min(0.5, placementJitterScalePct)) }),
    setPlacementJitterRotationDeg: (placementJitterRotationDeg) => set({ placementJitterRotationDeg: Math.max(0, Math.min(45, placementJitterRotationDeg)) }),

    prefabs: [],
    prefabCaptureRadius: 18,
    setPrefabs: (prefabs) => set({ prefabs: prefabs ?? [] }),
    setPrefabCaptureRadius: (prefabCaptureRadius) => set({ prefabCaptureRadius: Math.max(2, Math.min(120, prefabCaptureRadius)) }),
    capturePrefabAroundCamera: (name) =>
      set((s) => {
        const captureName = (name || '').trim() || `Prefab ${s.prefabs.length + 1}`
        const [cx, cy, cz] = s.cameraTarget
        const radius = Math.max(1, s.prefabCaptureRadius)
        const r2 = radius * radius
        const picked = s.placements.filter((p) => {
          const dx = p.position[0] - cx
          const dz = p.position[2] - cz
          return dx * dx + dz * dz <= r2
        })
        if (picked.length === 0) return {}

        const items = picked.map((p) => ({
          assetId: p.assetId,
          offset: [p.position[0] - cx, p.position[1] - cy, p.position[2] - cz] as [number, number, number],
          rotation: [...p.rotation] as [number, number, number],
          scale: [...p.scale] as [number, number, number],
          metadata: p.metadata ? { ...p.metadata } : undefined,
        }))

        const prefab: EditorPrefab = {
          id: crypto.randomUUID(),
          name: captureName,
          createdAt: Date.now(),
          items,
        }

        return {
          prefabs: [prefab, ...s.prefabs],
          dirty: true,
        }
      }),
    deletePrefab: (id) => set((s) => ({ prefabs: s.prefabs.filter((p) => p.id !== id), dirty: true })),
    stampPrefabAtGhost: (id) =>
      set((s) => {
        const prefab = s.prefabs.find((p) => p.id === id)
        if (!prefab || prefab.items.length === 0) return {}

        const [gx, gy, gz] = s.ghostPosition
        const spawned: EditorPlacement[] = prefab.items.map((item) => ({
          id: crypto.randomUUID(),
          assetId: item.assetId,
          position: [gx + item.offset[0], gy + item.offset[1], gz + item.offset[2]],
          rotation: [...item.rotation],
          scale: [...item.scale],
          source: 'manual',
          metadata: item.metadata ? { ...item.metadata } : undefined,
        }))

        return {
          placements: [...s.placements, ...spawned],
          dirty: true,
        }
      }),

    runtimePreview: false,
    toggleRuntimePreview: () => set((s) => ({ runtimePreview: !s.runtimePreview })),

    birdsEye: false,
    toggleBirdsEye: () => set((s) => {
      const birdsEye = !s.birdsEye
      const maxZoom = birdsEye ? 500 : 100
      return {
        birdsEye,
        cameraZoom: Math.max(10, Math.min(maxZoom, s.cameraZoom)),
      }
    }),
  }))
)

export default useEditorStore
