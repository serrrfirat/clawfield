import { useState } from 'react'
import useEditorStore from './useEditorStore'
import type { ScatterConfig } from './editor-types'
import { generateScatter } from './scatter-engine'
import { getDefaultCollidableForAsset } from './collision-defaults'

const defaultConfig: ScatterConfig = {
  assetId: '',
  assetIds: [],
  radius: 20,
  density: 0.5,
  noiseScale: 0.1,
  noiseThreshold: -0.3,
  minScale: 0.8,
  maxScale: 1.2,
  minSpacing: 2,
  seed: 42,
}

const PRESETS: Record<string, { label: string; assetIds: string[]; density: number; minScale: number; maxScale: number; minSpacing: number }> = {
  forest: {
    label: 'Forest',
    assetIds: ['pine', 'pine-trees', 'birch-trees', 'tree', 'bush', 'bushes', 'fern'],
    density: 0.3, minScale: 0.8, maxScale: 1.5, minSpacing: 3,
  },
  meadow: {
    label: 'Meadow',
    assetIds: ['grass', 'tall-grass', 'flowers', 'flower-group', 'flower-bushes', 'bush-flowers', 'fern'],
    density: 1.0, minScale: 0.6, maxScale: 1.2, minSpacing: 1,
  },
  tropical: {
    label: 'Tropical',
    assetIds: ['palm-trees', 'bush', 'bushes', 'plant', 'plant-big', 'fern', 'flower-group'],
    density: 0.4, minScale: 0.8, maxScale: 1.4, minSpacing: 2,
  },
  rocky: {
    label: 'Rocky',
    assetIds: ['rocks', 'rock-medium', 'pebbles', 'tall-grass'],
    density: 0.4, minScale: 0.7, maxScale: 1.5, minSpacing: 2,
  },
  spooky: {
    label: 'Spooky',
    assetIds: ['dead-tree', 'dead-trees', 'twisted-tree', 'mushroom', 'rocks'],
    density: 0.25, minScale: 0.8, maxScale: 1.3, minSpacing: 3,
  },
}

export default function ScatterPanel() {
  const activeTool = useEditorStore((s) => s.activeTool)
  const selectedAssetId = useEditorStore((s) => s.selectedAssetId)
  const assets = useEditorStore((s) => s.assets)
  const cameraTarget = useEditorStore((s) => s.cameraTarget)
  const addPlacement = useEditorStore((s) => s.addPlacement)
  const [config, setConfig] = useState<ScatterConfig>({ ...defaultConfig })
  const [previewCount, setPreviewCount] = useState(0)
  const [showAssetPicker, setShowAssetPicker] = useState(false)

  if (activeTool !== 'scatter') return null

  const vegAssets = assets.filter((a) => a.category === 'vegetation')
  const selectedIds = config.assetIds.length > 0 ? config.assetIds : selectedAssetId ? [selectedAssetId] : []
  const hasAssets = selectedIds.length > 0

  const toggleAsset = (id: string) => {
    setConfig((c) => {
      const ids = c.assetIds.includes(id)
        ? c.assetIds.filter((x) => x !== id)
        : [...c.assetIds, id]
      return { ...c, assetIds: ids }
    })
  }

  const applyPreset = (key: string) => {
    const p = PRESETS[key]
    setConfig((c) => ({
      ...c,
      assetIds: p.assetIds,
      density: p.density,
      minScale: p.minScale,
      maxScale: p.maxScale,
      minSpacing: p.minSpacing,
    }))
  }

  const handlePreview = () => {
    const c = { ...config, assetIds: selectedIds }
    const result = generateScatter(c, cameraTarget)
    setPreviewCount(result.length)
  }

  const handleCommit = () => {
    const c = { ...config, assetIds: selectedIds }
    const result = generateScatter(c, cameraTarget)
    for (const p of result) {
      const asset = assets.find((a) => a.id === p.assetId)
      addPlacement({
        ...p,
        metadata: {
          ...(p.metadata ?? {}),
          collidable: getDefaultCollidableForAsset(asset),
        },
      })
    }
    setPreviewCount(0)
  }

  return (
    <div style={panelStyle}>
      <div style={headerStyle}>Scatter</div>

      {/* Presets */}
      <div style={{ padding: '6px 16px' }}>
        <label style={smallLabel}>Presets</label>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {Object.entries(PRESETS).map(([key, p]) => (
            <button key={key} onClick={() => applyPreset(key)} style={presetBtn}>
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* Asset multi-select */}
      <div style={{ padding: '4px 16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <label style={smallLabel}>Assets ({selectedIds.length})</label>
          <button onClick={() => setShowAssetPicker(!showAssetPicker)} style={toggleBtn}>
            {showAssetPicker ? 'Hide' : 'Pick'}
          </button>
        </div>
        {showAssetPicker && (
          <div style={assetListStyle}>
            {vegAssets.map((a) => (
              <label key={a.id} style={checkRowStyle}>
                <input
                  type="checkbox"
                  checked={selectedIds.includes(a.id)}
                  onChange={() => toggleAsset(a.id)}
                />
                <span style={{ fontSize: 11, color: '#ccc' }}>{a.name}</span>
              </label>
            ))}
          </div>
        )}
        {!showAssetPicker && selectedIds.length > 0 && (
          <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>
            {selectedIds.slice(0, 4).join(', ')}{selectedIds.length > 4 ? ` +${selectedIds.length - 4} more` : ''}
          </div>
        )}
      </div>

      {!hasAssets && <div style={warnStyle}>Select assets above or from the sidebar</div>}
      <SliderRow label="Radius" value={config.radius} min={5} max={200} step={5}
        onChange={(v) => setConfig((c) => ({ ...c, radius: v }))} />
      <SliderRow label="Density" value={config.density} min={0.05} max={2} step={0.05}
        onChange={(v) => setConfig((c) => ({ ...c, density: v }))} />
      <SliderRow label="Noise Scale" value={config.noiseScale} min={0.01} max={1} step={0.01}
        onChange={(v) => setConfig((c) => ({ ...c, noiseScale: v }))} />
      <SliderRow label="Noise Thresh" value={config.noiseThreshold} min={-1} max={1} step={0.05}
        onChange={(v) => setConfig((c) => ({ ...c, noiseThreshold: v }))} />
      <SliderRow label="Min Scale" value={config.minScale} min={0.1} max={5} step={0.1}
        onChange={(v) => setConfig((c) => ({ ...c, minScale: v }))} />
      <SliderRow label="Max Scale" value={config.maxScale} min={0.1} max={5} step={0.1}
        onChange={(v) => setConfig((c) => ({ ...c, maxScale: v }))} />
      <SliderRow label="Min Spacing" value={config.minSpacing} min={0.5} max={20} step={0.5}
        onChange={(v) => setConfig((c) => ({ ...c, minSpacing: v }))} />
      <SliderRow label="Seed" value={config.seed} min={0} max={9999} step={1}
        onChange={(v) => setConfig((c) => ({ ...c, seed: v }))} />
      <div style={{ padding: '8px 16px', display: 'flex', gap: 8 }}>
        <button onClick={handlePreview} style={btnStyle} disabled={!hasAssets}>
          Preview ({previewCount})
        </button>
        <button onClick={handleCommit} style={{ ...btnStyle, background: '#2a5a2a' }} disabled={!hasAssets}>
          Commit
        </button>
      </div>
    </div>
  )
}

function SliderRow({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  onChange: (v: number) => void
}) {
  return (
    <div style={rowStyle}>
      <label style={labelStyle}>{label}</label>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        style={{ flex: 1 }}
      />
      <span style={numStyle}>{value.toFixed(2)}</span>
    </div>
  )
}

const panelStyle: React.CSSProperties = {
  position: 'absolute',
  bottom: 12,
  left: '50%',
  transform: 'translateX(-50%)',
  background: '#1e1e2e',
  border: '1px solid #333',
  borderRadius: 8,
  width: 400,
  zIndex: 10,
  userSelect: 'none',
  maxHeight: '70vh',
  overflowY: 'auto',
}

const headerStyle: React.CSSProperties = {
  padding: '8px 16px',
  fontSize: 13,
  fontWeight: 600,
  color: '#fff',
  borderBottom: '1px solid #333',
}

const warnStyle: React.CSSProperties = {
  padding: '8px 16px',
  color: '#ff8888',
  fontSize: 12,
}

const rowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '3px 16px',
}

const labelStyle: React.CSSProperties = {
  fontSize: 11,
  color: '#888',
  width: 80,
  flexShrink: 0,
}

const smallLabel: React.CSSProperties = {
  fontSize: 11,
  color: '#888',
  textTransform: 'uppercase',
  letterSpacing: 0.5,
  display: 'block',
  marginBottom: 4,
}

const numStyle: React.CSSProperties = {
  fontSize: 11,
  color: '#aaa',
  width: 40,
  textAlign: 'right',
  fontFamily: 'monospace',
}

const btnStyle: React.CSSProperties = {
  flex: 1,
  background: '#2a2a3e',
  border: '1px solid #444',
  borderRadius: 4,
  color: '#ccc',
  padding: '6px 12px',
  fontSize: 12,
  cursor: 'pointer',
}

const presetBtn: React.CSSProperties = {
  background: '#2a3a4e',
  border: '1px solid #456',
  borderRadius: 4,
  color: '#aac',
  padding: '3px 8px',
  fontSize: 11,
  cursor: 'pointer',
}

const toggleBtn: React.CSSProperties = {
  background: 'transparent',
  border: '1px solid #555',
  borderRadius: 3,
  color: '#aaa',
  padding: '2px 8px',
  fontSize: 10,
  cursor: 'pointer',
}

const assetListStyle: React.CSSProperties = {
  maxHeight: 150,
  overflowY: 'auto',
  background: '#16162a',
  border: '1px solid #333',
  borderRadius: 4,
  padding: 4,
  marginTop: 4,
}

const checkRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  padding: '2px 4px',
  cursor: 'pointer',
}
