import { create } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'
import type { EditorPlacement, EditorTool, GizmoMode, AssetEntry } from './editor-types'
import catalog from './asset-catalog.json'
import { cellKey, quantizeToCell, sampleHeightDelta } from './heightmap-utils'

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
    setCameraZoom: (zoom) => set({ cameraZoom: Math.max(10, Math.min(100, zoom)) }),

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
  }))
)

export default useEditorStore
