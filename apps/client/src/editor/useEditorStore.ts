import { create } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'
import type { EditorPlacement, EditorTool, GizmoMode, AssetEntry } from './editor-types'
import catalog from './asset-catalog.json'

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
}

const useEditorStore = create<EditorState>()(
  subscribeWithSelector((set) => ({
    activeTool: 'select',
    gizmoMode: 'translate',
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

    ghostPosition: [0, 0, 0],
    ghostRotation: 0,
    setGhostPosition: (pos) => set({ ghostPosition: pos }),
    rotateGhost: (delta) => set((s) => ({ ghostRotation: s.ghostRotation + delta })),

    cameraTarget: [0, 0, 0],
    cameraZoom: 40,
    setCameraTarget: (target) => set({ cameraTarget: target }),
    setCameraZoom: (zoom) => set({ cameraZoom: Math.max(10, Math.min(100, zoom)) }),

    mapName: 'untitled',
    setMapName: (name) => set({ mapName: name }),
    dirty: false,
    setDirty: (d) => set({ dirty: d }),
  }))
)

export default useEditorStore
