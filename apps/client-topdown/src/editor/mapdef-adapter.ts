import type { EditorPlacement, MapdefJson, MapdefPlacement } from './editor-types'
import useEditorStore from './useEditorStore'

const TERRAIN_SEED = 1337
const TERRAIN_SCALE = 0.05
const TERRAIN_AMPLITUDE = 2

export function exportMapdef(): MapdefJson {
  const state = useEditorStore.getState()
  return {
    name: state.mapName,
    bounds: { minX: -500, maxX: 500, minZ: -500, maxZ: 500 },
    terrain: { seed: TERRAIN_SEED, scale: TERRAIN_SCALE, amplitude: TERRAIN_AMPLITUDE },
    placements: state.placements.map(toMapdefPlacement),
    editorState: {
      cameraTarget: state.cameraTarget,
      cameraZoom: state.cameraZoom,
    },
  }
}

export function importMapdef(json: MapdefJson) {
  const store = useEditorStore.getState()
  store.setMapName(json.name || 'untitled')
  const placements = json.placements.map(fromMapdefPlacement)
  store.setPlacements(placements)
  if (json.editorState) {
    store.setCameraTarget(json.editorState.cameraTarget)
    store.setCameraZoom(json.editorState.cameraZoom)
  }
}

function toMapdefPlacement(p: EditorPlacement): MapdefPlacement {
  return {
    componentId: p.assetId,
    position: p.position,
    rotation: p.rotation,
    scale: p.scale,
    source: p.source,
    metadata: p.metadata,
  }
}

function fromMapdefPlacement(mp: MapdefPlacement): EditorPlacement {
  return {
    id: crypto.randomUUID(),
    assetId: mp.componentId,
    position: mp.position,
    rotation: mp.rotation,
    scale: mp.scale,
    source: (mp.source as EditorPlacement['source']) || 'manual',
    metadata: mp.metadata,
  }
}

export function downloadMapdef() {
  const json = exportMapdef()
  const blob = new Blob([JSON.stringify(json, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${json.name}.mapdef.json`
  a.click()
  URL.revokeObjectURL(url)
  useEditorStore.getState().setDirty(false)
}

export function loadMapdef(): Promise<void> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.json,.mapdef.json'
    input.onchange = async () => {
      const file = input.files?.[0]
      if (!file) return resolve()
      try {
        const text = await file.text()
        const json: MapdefJson = JSON.parse(text)
        importMapdef(json)
      } catch (e) {
        console.error('Failed to load mapdef:', e)
      }
      resolve()
    }
    input.click()
  })
}
