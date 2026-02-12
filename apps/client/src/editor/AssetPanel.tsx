import useEditorStore from './useEditorStore'
import type { AssetEntry } from './editor-types'

const CATEGORIES = ['structures', 'vegetation', 'props', 'vehicles'] as const

export default function AssetPanel() {
  const assets = useEditorStore((s) => s.assets)
  const selectedAssetId = useEditorStore((s) => s.selectedAssetId)
  const selectAsset = useEditorStore((s) => s.selectAsset)

  const grouped = CATEGORIES.map((cat) => ({
    category: cat,
    items: assets.filter((a) => a.category === cat),
  })).filter((g) => g.items.length > 0)

  return (
    <div style={panelStyle}>
      <div style={headerStyle}>Assets</div>
      {grouped.map((group) => (
        <div key={group.category}>
          <div style={categoryStyle}>{group.category}</div>
          {group.items.map((asset) => (
            <AssetItem
              key={asset.id}
              asset={asset}
              selected={asset.id === selectedAssetId}
              onClick={() => selectAsset(asset.id === selectedAssetId ? null : asset.id)}
            />
          ))}
        </div>
      ))}
    </div>
  )
}

function AssetItem({
  asset,
  selected,
  onClick,
}: {
  asset: AssetEntry
  selected: boolean
  onClick: () => void
}) {
  return (
    <div
      onClick={onClick}
      style={{
        ...itemStyle,
        background: selected ? '#4a6fa5' : 'transparent',
        color: selected ? '#fff' : '#ddd',
      }}
    >
      {asset.name}
    </div>
  )
}

const panelStyle: React.CSSProperties = {
  width: 200,
  background: '#1e1e2e',
  borderRight: '1px solid #333',
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

const categoryStyle: React.CSSProperties = {
  padding: '8px 16px 4px',
  fontSize: 11,
  fontWeight: 600,
  color: '#888',
  textTransform: 'uppercase',
  letterSpacing: 1,
}

const itemStyle: React.CSSProperties = {
  padding: '6px 16px',
  fontSize: 13,
  cursor: 'pointer',
  borderRadius: 4,
  margin: '1px 4px',
}
