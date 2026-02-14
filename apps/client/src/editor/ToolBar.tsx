import { useEffect } from 'react'
import useEditorStore from './useEditorStore'
import type { EditorTool, GizmoMode } from './editor-types'

export default function ToolBar() {
  const activeTool = useEditorStore((s) => s.activeTool)
  const gizmoMode = useEditorStore((s) => s.gizmoMode)
  const mapName = useEditorStore((s) => s.mapName)
  const dirty = useEditorStore((s) => s.dirty)
  const setActiveTool = useEditorStore((s) => s.setActiveTool)
  const setGizmoMode = useEditorStore((s) => s.setGizmoMode)
  const showColliderDebug = useEditorStore((s) => s.showColliderDebug)
  const toggleColliderDebug = useEditorStore((s) => s.toggleColliderDebug)
  const runtimePreview = useEditorStore((s) => s.runtimePreview)
  const toggleRuntimePreview = useEditorStore((s) => s.toggleRuntimePreview)
  const finishRoadStroke = useEditorStore((s) => s.finishRoadStroke)

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
      <ToolButton label="Colliders (C)" active={showColliderDebug} onClick={toggleColliderDebug} />
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
          <span style={hintStyle}>Brush settings in right panel</span>
        </>
      )}
      {activeTool === 'road' && (
        <>
          <span style={hintStyle}>Road settings in right panel</span>
          <ToolButton label="Finish (Enter)" active={false} onClick={finishRoadStroke} />
        </>
      )}
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

const hintStyle: React.CSSProperties = {
  fontSize: 11,
  color: '#8a8a9a',
  padding: '0 4px',
}
