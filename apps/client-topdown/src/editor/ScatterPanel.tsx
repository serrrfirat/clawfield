import { useState } from 'react'
import useEditorStore from './useEditorStore'
import type { ScatterConfig } from './editor-types'
import { generateScatter } from './scatter-engine'

const defaultConfig: ScatterConfig = {
  assetId: '',
  radius: 20,
  density: 0.5,
  noiseScale: 0.1,
  noiseThreshold: -0.3,
  minScale: 0.8,
  maxScale: 1.2,
  minSpacing: 2,
  seed: 42,
}

export default function ScatterPanel() {
  const activeTool = useEditorStore((s) => s.activeTool)
  const selectedAssetId = useEditorStore((s) => s.selectedAssetId)
  const cameraTarget = useEditorStore((s) => s.cameraTarget)
  const addPlacement = useEditorStore((s) => s.addPlacement)
  const [config, setConfig] = useState<ScatterConfig>({ ...defaultConfig })
  const [previewCount, setPreviewCount] = useState(0)

  if (activeTool !== 'scatter') return null

  const assetId = selectedAssetId || config.assetId

  const handlePreview = () => {
    const c = { ...config, assetId }
    const result = generateScatter(c, cameraTarget)
    setPreviewCount(result.length)
  }

  const handleCommit = () => {
    const c = { ...config, assetId }
    const result = generateScatter(c, cameraTarget)
    for (const p of result) addPlacement(p)
    setPreviewCount(0)
  }

  return (
    <div style={panelStyle}>
      <div style={headerStyle}>Scatter</div>
      {!assetId && <div style={warnStyle}>Select an asset first</div>}
      <SliderRow label="Radius" value={config.radius} min={5} max={100} step={5}
        onChange={(v) => setConfig((c) => ({ ...c, radius: v }))} />
      <SliderRow label="Density" value={config.density} min={0.05} max={2} step={0.05}
        onChange={(v) => setConfig((c) => ({ ...c, density: v }))} />
      <SliderRow label="Noise Scale" value={config.noiseScale} min={0.01} max={1} step={0.01}
        onChange={(v) => setConfig((c) => ({ ...c, noiseScale: v }))} />
      <SliderRow label="Noise Thresh" value={config.noiseThreshold} min={-1} max={1} step={0.05}
        onChange={(v) => setConfig((c) => ({ ...c, noiseThreshold: v }))} />
      <SliderRow label="Min Scale" value={config.minScale} min={0.1} max={3} step={0.1}
        onChange={(v) => setConfig((c) => ({ ...c, minScale: v }))} />
      <SliderRow label="Max Scale" value={config.maxScale} min={0.1} max={3} step={0.1}
        onChange={(v) => setConfig((c) => ({ ...c, maxScale: v }))} />
      <SliderRow label="Min Spacing" value={config.minSpacing} min={0.5} max={10} step={0.5}
        onChange={(v) => setConfig((c) => ({ ...c, minSpacing: v }))} />
      <SliderRow label="Seed" value={config.seed} min={0} max={9999} step={1}
        onChange={(v) => setConfig((c) => ({ ...c, seed: v }))} />
      <div style={{ padding: '8px 16px', display: 'flex', gap: 8 }}>
        <button onClick={handlePreview} style={btnStyle} disabled={!assetId}>
          Preview ({previewCount})
        </button>
        <button onClick={handleCommit} style={{ ...btnStyle, background: '#2a5a2a' }} disabled={!assetId}>
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
  width: 360,
  zIndex: 10,
  userSelect: 'none',
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
