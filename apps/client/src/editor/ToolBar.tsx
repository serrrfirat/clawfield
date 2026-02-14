import { useEffect } from 'react'
import useEditorStore from './useEditorStore'
import useStore from '../stores/useStore'
import type { EditorTool, GizmoMode } from './editor-types'

export default function ToolBar() {
  const activeTool = useEditorStore((s) => s.activeTool)
  const gizmoMode = useEditorStore((s) => s.gizmoMode)
  const mapName = useEditorStore((s) => s.mapName)
  const dirty = useEditorStore((s) => s.dirty)
  const setActiveTool = useEditorStore((s) => s.setActiveTool)
  const setGizmoMode = useEditorStore((s) => s.setGizmoMode)
  const waterLevel = useEditorStore((s) => s.waterLevel)
  const setWaterLevel = useEditorStore((s) => s.setWaterLevel)
  const heightBrushRadius = useEditorStore((s) => s.heightBrushRadius)
  const setHeightBrushRadius = useEditorStore((s) => s.setHeightBrushRadius)
  const heightBrushStrength = useEditorStore((s) => s.heightBrushStrength)
  const setHeightBrushStrength = useEditorStore((s) => s.setHeightBrushStrength)
  const heightBrushMode = useEditorStore((s) => s.heightBrushMode)
  const setHeightBrushMode = useEditorStore((s) => s.setHeightBrushMode)
  const showColliderDebug = useEditorStore((s) => s.showColliderDebug)
  const toggleColliderDebug = useEditorStore((s) => s.toggleColliderDebug)
  const runtimePreview = useEditorStore((s) => s.runtimePreview)
  const toggleRuntimePreview = useEditorStore((s) => s.toggleRuntimePreview)
  const postFx = useStore((s: any) => s.postProcessingParameters)
  const roadTextureId = useEditorStore((s) => s.roadTextureId)
  const setRoadTextureId = useEditorStore((s) => s.setRoadTextureId)
  const roadWidth = useEditorStore((s) => s.roadWidth)
  const setRoadWidth = useEditorStore((s) => s.setRoadWidth)
  const finishRoadStroke = useEditorStore((s) => s.finishRoadStroke)
  const autoFlattenOnPlace = useEditorStore((s) => s.autoFlattenOnPlace)
  const setAutoFlattenOnPlace = useEditorStore((s) => s.setAutoFlattenOnPlace)
  const flattenRadiusScale = useEditorStore((s) => s.flattenRadiusScale)
  const setFlattenRadiusScale = useEditorStore((s) => s.setFlattenRadiusScale)

  const patchPostFx = (updates: Record<string, number | boolean>) => {
    useStore.setState((state: any) => ({
      postProcessingParameters: {
        ...state.postProcessingParameters,
        ...updates,
      },
    }))
  }

  // Keyboard shortcuts
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return

      switch (e.code) {
        case 'KeyV':
          setActiveTool('select')
          break
        case 'KeyB':
          setActiveTool('place')
          break
        case 'KeyH':
          setActiveTool('height')
          break
        case 'KeyT':
          setActiveTool('road')
          break
        case 'KeyW':
          if (activeTool === 'select') setGizmoMode('translate')
          break
        case 'KeyE':
          if (activeTool === 'select') setGizmoMode('rotate')
          break
        case 'KeyR':
          if (activeTool === 'select') setGizmoMode('scale')
          break
        case 'Escape':
          useEditorStore.getState().selectPlacement(null)
          useEditorStore.getState().selectAsset(null)
          setActiveTool('select')
          break
        case 'Delete':
        case 'Backspace': {
          const sel = useEditorStore.getState().selectedPlacementId
          if (sel) useEditorStore.getState().removePlacement(sel)
          break
        }
        case 'KeyC':
          toggleColliderDebug()
          break
        case 'KeyP':
          toggleRuntimePreview()
          break
        case 'Enter':
          if (activeTool === 'road') finishRoadStroke()
          break
      }

      // Ctrl+S save
      if ((e.ctrlKey || e.metaKey) && e.code === 'KeyS') {
        e.preventDefault()
        document.dispatchEvent(new CustomEvent('editor-save'))
      }
      // Ctrl+O load
      if ((e.ctrlKey || e.metaKey) && e.code === 'KeyO') {
        e.preventDefault()
        document.dispatchEvent(new CustomEvent('editor-load'))
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [activeTool, setActiveTool, setGizmoMode, toggleColliderDebug, toggleRuntimePreview, finishRoadStroke])

  return (
    <div style={toolbarStyle}>
      <span style={mapNameStyle}>
        {mapName}{dirty ? ' *' : ''}
      </span>
      <ToolButton
        label="Load Map"
        active={false}
        onClick={() => document.dispatchEvent(new CustomEvent('editor-load'))}
      />
      <ToolButton
        label="Save Map"
        active={false}
        onClick={() => document.dispatchEvent(new CustomEvent('editor-save'))}
      />
      <ToolButton label="Runtime Look (P)" active={runtimePreview} onClick={toggleRuntimePreview} />
      <ToolButton label="Post FX" active={!!postFx?.enabled} onClick={() => patchPostFx({ enabled: !postFx?.enabled })} />
      <ToolButton label="Colliders (C)" active={showColliderDebug} onClick={toggleColliderDebug} />
      <label style={controlLabel}>Rays</label>
      <input
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={postFx?.godRaysWeight ?? 0.3}
        onChange={(e) => patchPostFx({ godRaysWeight: Number(e.target.value) })}
      />
      <label style={controlLabel}>Bloom</label>
      <input
        type="range"
        min={0}
        max={2}
        step={0.01}
        value={postFx?.bloomIntensity ?? 0.35}
        onChange={(e) => patchPostFx({ bloomIntensity: Number(e.target.value) })}
      />
      <div style={divider} />
      <ToolButton label="Select (V)" active={activeTool === 'select'} onClick={() => setActiveTool('select')} />
      <ToolButton label="Place (B)" active={activeTool === 'place'} onClick={() => setActiveTool('place')} />
      <ToolButton label="Height (H)" active={activeTool === 'height'} onClick={() => setActiveTool('height')} />
      <ToolButton label="Road (T)" active={activeTool === 'road'} onClick={() => setActiveTool('road')} />
      <ToolButton label="Scatter" active={activeTool === 'scatter'} onClick={() => setActiveTool('scatter')} />
      <div style={divider} />
      {activeTool === 'select' && (
        <>
          <ToolButton label="Move (W)" active={gizmoMode === 'translate'} onClick={() => setGizmoMode('translate')} />
          <ToolButton label="Rot (E)" active={gizmoMode === 'rotate'} onClick={() => setGizmoMode('rotate')} />
          <ToolButton label="Scale (R)" active={gizmoMode === 'scale'} onClick={() => setGizmoMode('scale')} />
        </>
      )}
      {activeTool === 'height' && (
        <>
          <label style={controlLabel}>Mode</label>
          <select
            value={heightBrushMode}
            onChange={(e) => setHeightBrushMode(e.target.value as any)}
            style={selectStyle}
          >
            <option value="raise">Raise</option>
            <option value="lower">Lower</option>
            <option value="flatten">Flatten</option>
          </select>
          <label style={controlLabel}>Radius</label>
          <input
            type="range"
            min={0.5}
            max={8}
            step={0.25}
            value={heightBrushRadius}
            onChange={(e) => setHeightBrushRadius(Number(e.target.value))}
          />
          <label style={controlLabel}>Strength</label>
          <input
            type="range"
            min={0.02}
            max={0.8}
            step={0.02}
            value={heightBrushStrength}
            onChange={(e) => setHeightBrushStrength(Number(e.target.value))}
          />
        </>
      )}
      {activeTool === 'road' && (
        <>
          <label style={controlLabel}>Road Tex</label>
          <select
            value={roadTextureId}
            onChange={(e) => setRoadTextureId(e.target.value as any)}
            style={selectStyle}
          >
            <option value="road_1">Road 1</option>
            <option value="road_2">Road 2</option>
          </select>
          <label style={controlLabel}>Width</label>
          <input
            type="range"
            min={1}
            max={14}
            step={0.25}
            value={roadWidth}
            onChange={(e) => setRoadWidth(Number(e.target.value))}
          />
          <ToolButton label="Finish (Enter)" active={false} onClick={finishRoadStroke} />
        </>
      )}
      <div style={divider} />
      <label style={controlLabel}>Water</label>
      <input
        type="range"
        min={-4}
        max={4}
        step={0.05}
        value={waterLevel}
        onChange={(e) => setWaterLevel(Number(e.target.value))}
      />
      <div style={divider} />
      <label style={checkLabelStyle}>
        <input type="checkbox" checked={autoFlattenOnPlace} onChange={(e) => setAutoFlattenOnPlace(e.target.checked)} />
        Auto flatten placements
      </label>
      <input
        type="range"
        min={0.4}
        max={2.5}
        step={0.1}
        value={flattenRadiusScale}
        onChange={(e) => setFlattenRadiusScale(Number(e.target.value))}
      />
    </div>
  )
}

function ToolButton({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        ...btnStyle,
        background: active ? '#4a6fa5' : '#2a2a3e',
        color: active ? '#fff' : '#aaa',
      }}
    >
      {label}
    </button>
  )
}

const toolbarStyle: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: 4,
  padding: '6px 12px',
  background: '#1e1e2e',
  borderBottom: '1px solid #333',
}

const mapNameStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  color: '#ccc',
  marginRight: 8,
}

const divider: React.CSSProperties = {
  width: 1,
  height: 20,
  background: '#444',
  margin: '0 6px',
}

const btnStyle: React.CSSProperties = {
  border: 'none',
  borderRadius: 4,
  padding: '4px 10px',
  fontSize: 12,
  cursor: 'pointer',
  fontFamily: 'inherit',
}

const controlLabel: React.CSSProperties = {
  fontSize: 11,
  color: '#bbb',
}

const selectStyle: React.CSSProperties = {
  background: '#2a2a3e',
  color: '#ddd',
  border: '1px solid #3e3e5a',
  borderRadius: 4,
  fontSize: 12,
  padding: '2px 6px',
}

const checkLabelStyle: React.CSSProperties = {
  fontSize: 11,
  color: '#bbb',
  display: 'flex',
  alignItems: 'center',
  gap: 4,
}
