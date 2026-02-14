import { useCallback } from 'react'
import useEditorStore from './useEditorStore'
import { getDefaultCollidableForAsset, getDefaultColliderType, getDefaultGrassSuppressRadius, getDefaultSuppressGrassForAsset, getPlacementCollidable, getPlacementColliderType, getPlacementGrassSuppressRadius, getPlacementSuppressGrass } from './collision-defaults'

const DESTRUCTION_PROFILES = [
  { id: 'none', label: 'none' },
  { id: 'light_prop', label: 'light prop' },
  { id: 'wall_section', label: 'wall section' },
  { id: 'building_small', label: 'building small' },
  { id: 'building_large', label: 'building large' },
] as const

const PROFILE_DEFAULTS: Record<string, { colliderType: 'none' | 'cuboid' | 'trimesh'; colliderScale: number }> = {
  none: { colliderType: 'cuboid', colliderScale: 0.45 },
  light_prop: { colliderType: 'cuboid', colliderScale: 0.38 },
  wall_section: { colliderType: 'cuboid', colliderScale: 0.55 },
  building_small: { colliderType: 'trimesh', colliderScale: 0.5 },
  building_large: { colliderType: 'trimesh', colliderScale: 0.5 },
}

export default function PropertiesPanel() {
  const selectedId = useEditorStore((s) => s.selectedPlacementId)
  const placements = useEditorStore((s) => s.placements)
  const updatePlacement = useEditorStore((s) => s.updatePlacement)
  const removePlacement = useEditorStore((s) => s.removePlacement)
  const assets = useEditorStore((s) => s.assets)

  const placement = placements.find((p) => p.id === selectedId)
  const asset = assets.find((a) => a.id === placement?.assetId)

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
      <div style={sectionStyle}>
        <label style={labelStyle}>Collision</label>
        <label style={checkRowStyle}>
          <input
            type="checkbox"
            checked={getPlacementCollidable(placement, asset)}
            onChange={(e) => {
              updatePlacement(placement.id, {
                metadata: {
                  ...(placement.metadata ?? {}),
                  collidable: e.target.checked,
                },
              })
            }}
          />
          <span style={valueStyle}>Collidable</span>
        </label>
        <div style={hintStyle}>Default: {getDefaultCollidableForAsset(asset) ? 'on' : 'off'}</div>

        <div style={{ marginTop: 8 }}>
          <label style={checkRowStyle}>
            <input
              type="checkbox"
              checked={getPlacementSuppressGrass(placement, asset)}
              onChange={(e) => {
                updatePlacement(placement.id, {
                  metadata: {
                    ...(placement.metadata ?? {}),
                    suppressGrass: e.target.checked,
                  },
                })
              }}
            />
            <span style={valueStyle}>Suppress grass under object</span>
          </label>
          <div style={hintStyle}>Default: {getDefaultSuppressGrassForAsset(asset) ? 'on' : 'off'}</div>
          <div style={{ marginTop: 6 }}>
            <label style={labelStyle}>Grass Clear Radius</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input
                type="range"
                min={0.25}
                max={20}
                step={0.1}
                value={getPlacementGrassSuppressRadius(placement, asset)}
                onChange={(e) => {
                  updatePlacement(placement.id, {
                    metadata: {
                      ...(placement.metadata ?? {}),
                      grassSuppressRadius: Number(e.target.value),
                    },
                  })
                }}
                style={{ flex: 1, accentColor: '#4a9fff' }}
              />
              <input
                type="number"
                min={0.25}
                step={0.1}
                value={Math.round(getPlacementGrassSuppressRadius(placement, asset) * 10) / 10}
                onChange={(e) => {
                  const r = parseFloat(e.target.value) || getDefaultGrassSuppressRadius(asset, placement.scale)
                  updatePlacement(placement.id, {
                    metadata: {
                      ...(placement.metadata ?? {}),
                      grassSuppressRadius: Math.max(0.25, r),
                    },
                  })
                }}
                style={{ ...inputStyle, width: 56 }}
              />
            </div>
          </div>
        </div>

        <div style={{ marginTop: 8 }}>
          <label style={labelStyle}>Collider Type</label>
          <select
            value={getPlacementColliderType(placement, asset)}
            onChange={(e) => {
              const value = e.target.value as 'none' | 'cuboid' | 'trimesh'
              updatePlacement(placement.id, {
                metadata: {
                  ...(placement.metadata ?? {}),
                  colliderType: value,
                },
              })
            }}
            style={selectStyle}
          >
            <option value="none">none</option>
            <option value="cuboid">cuboid</option>
            <option value="trimesh">trimesh</option>
          </select>
          <div style={hintStyle}>Default: {getDefaultColliderType(asset)}</div>
        </div>

        <div style={{ marginTop: 8 }}>
          <label style={labelStyle}>Destructible (Future)</label>
          <label style={checkRowStyle}>
            <input
              type="checkbox"
              checked={Boolean(placement.metadata?.destructible ?? asset?.destructible)}
              onChange={(e) => {
                updatePlacement(placement.id, {
                  metadata: {
                    ...(placement.metadata ?? {}),
                    destructible: e.target.checked,
                  },
                })
              }}
            />
            <span style={valueStyle}>Enable destruction hooks</span>
          </label>
          <div style={{ marginTop: 6 }}>
            <label style={labelStyle}>Destruction Profile</label>
            <select
              value={String(placement.metadata?.destructionProfile ?? 'none')}
              onChange={(e) => {
                const value = e.target.value
                const defaults = PROFILE_DEFAULTS[value] ?? PROFILE_DEFAULTS.none
                updatePlacement(placement.id, {
                  metadata: {
                    ...(placement.metadata ?? {}),
                    destructionProfile: value,
                    destructible: value !== 'none',
                    colliderType: defaults.colliderType,
                    colliderScale: defaults.colliderScale,
                  },
                })
              }}
              style={selectStyle}
            >
              {DESTRUCTION_PROFILES.map((profile) => (
                <option key={profile.id} value={profile.id}>{profile.label}</option>
              ))}
            </select>
          </div>
        </div>
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
      <div style={sectionStyle}>
        <label style={labelStyle}>Size</label>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input
            type="range"
            min={0.1}
            max={20}
            step={0.1}
            value={placement.scale[0]}
            onChange={(e) => {
              const s = parseFloat(e.target.value)
              updatePlacement(placement.id, { scale: [s, s, s] })
            }}
            style={{ flex: 1, accentColor: '#4a9fff' }}
          />
          <input
            type="number"
            min={0.1}
            step={0.1}
            value={Math.round(placement.scale[0] * 100) / 100}
            onChange={(e) => {
              const s = parseFloat(e.target.value) || 1
              updatePlacement(placement.id, { scale: [s, s, s] })
            }}
            style={{ ...inputStyle, width: 52 }}
          />
        </div>
      </div>
      <Vec3Input
        label="Scale (per-axis)"
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

const selectStyle: React.CSSProperties = {
  width: '100%',
  background: '#2a2a3e',
  border: '1px solid #444',
  borderRadius: 3,
  color: '#ddd',
  padding: '3px 4px',
  fontSize: 12,
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

const checkRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
}

const hintStyle: React.CSSProperties = {
  fontSize: 11,
  color: '#777',
  marginTop: 4,
}
