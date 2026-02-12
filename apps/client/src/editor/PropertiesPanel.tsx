import { useCallback } from 'react'
import useEditorStore from './useEditorStore'

export default function PropertiesPanel() {
  const selectedId = useEditorStore((s) => s.selectedPlacementId)
  const placements = useEditorStore((s) => s.placements)
  const updatePlacement = useEditorStore((s) => s.updatePlacement)
  const removePlacement = useEditorStore((s) => s.removePlacement)

  const placement = placements.find((p) => p.id === selectedId)

  if (!placement) {
    return (
      <div style={panelStyle}>
        <div style={headerStyle}>Properties</div>
        <div style={emptyStyle}>No selection</div>
      </div>
    )
  }

  return (
    <div style={panelStyle}>
      <div style={headerStyle}>Properties</div>
      <div style={sectionStyle}>
        <label style={labelStyle}>Asset</label>
        <div style={valueStyle}>{placement.assetId}</div>
      </div>
      <Vec3Input
        label="Position"
        value={placement.position}
        onChange={(v) => updatePlacement(placement.id, { position: v })}
      />
      <Vec3Input
        label="Rotation"
        value={placement.rotation}
        step={5}
        onChange={(v) => updatePlacement(placement.id, { rotation: v })}
      />
      <Vec3Input
        label="Scale"
        value={placement.scale}
        step={0.1}
        onChange={(v) => updatePlacement(placement.id, { scale: v })}
      />
      <div style={{ padding: '8px 16px' }}>
        <button onClick={() => removePlacement(placement.id)} style={deleteBtn}>
          Delete
        </button>
      </div>
    </div>
  )
}

function Vec3Input({
  label,
  value,
  step = 0.5,
  onChange,
}: {
  label: string
  value: [number, number, number]
  step?: number
  onChange: (v: [number, number, number]) => void
}) {
  const set = useCallback(
    (idx: number, val: number) => {
      const next: [number, number, number] = [...value]
      next[idx] = val
      onChange(next)
    },
    [value, onChange]
  )

  const axes = ['X', 'Y', 'Z'] as const
  return (
    <div style={sectionStyle}>
      <label style={labelStyle}>{label}</label>
      <div style={rowStyle}>
        {axes.map((axis, i) => (
          <div key={axis} style={inputGroupStyle}>
            <span style={axisLabel}>{axis}</span>
            <input
              type="number"
              value={Math.round(value[i] * 100) / 100}
              step={step}
              onChange={(e) => set(i, parseFloat(e.target.value) || 0)}
              style={inputStyle}
            />
          </div>
        ))}
      </div>
    </div>
  )
}

const panelStyle: React.CSSProperties = {
  width: 220,
  background: '#1e1e2e',
  borderLeft: '1px solid #333',
  overflowY: 'auto',
  flexShrink: 0,
  userSelect: 'none',
}

const headerStyle: React.CSSProperties = {
  padding: '12px 16px 8px',
  fontSize: 14,
  fontWeight: 600,
  color: '#fff',
  borderBottom: '1px solid #333',
}

const emptyStyle: React.CSSProperties = {
  padding: 16,
  color: '#666',
  fontSize: 12,
}

const sectionStyle: React.CSSProperties = {
  padding: '6px 16px',
}

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: 11,
  color: '#888',
  marginBottom: 4,
  textTransform: 'uppercase',
  letterSpacing: 0.5,
}

const valueStyle: React.CSSProperties = {
  fontSize: 13,
  color: '#ccc',
}

const rowStyle: React.CSSProperties = {
  display: 'flex',
  gap: 4,
}

const inputGroupStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 2,
  flex: 1,
}

const axisLabel: React.CSSProperties = {
  fontSize: 10,
  color: '#666',
  width: 12,
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  background: '#2a2a3e',
  border: '1px solid #444',
  borderRadius: 3,
  color: '#ddd',
  padding: '3px 4px',
  fontSize: 12,
  fontFamily: 'monospace',
}

const deleteBtn: React.CSSProperties = {
  background: '#5a2a2a',
  border: 'none',
  borderRadius: 4,
  color: '#ff8888',
  padding: '6px 12px',
  fontSize: 12,
  cursor: 'pointer',
  width: '100%',
}
