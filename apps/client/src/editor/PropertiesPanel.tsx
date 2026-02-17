import { useCallback, useMemo, useState } from 'react'
import useEditorStore from './useEditorStore'
import useStore from '../stores/useStore'
import {
  getDefaultCollidableForAsset,
  getDefaultColliderType,
  getDefaultGrassSuppressRadius,
  getDefaultSuppressGrassForAsset,
  getPlacementCollidable,
  getPlacementColliderType,
  getPlacementGrassSuppressRadius,
  getPlacementSuppressGrass,
} from './collision-defaults'

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

type SectionKey = 'scene' | 'terrain' | 'tool' | 'prefabs' | 'selection'

export default function PropertiesPanel() {
  const activeTool = useEditorStore((s) => s.activeTool)
  const runtimePreview = useEditorStore((s) => s.runtimePreview)
  const toggleRuntimePreview = useEditorStore((s) => s.toggleRuntimePreview)
  const showColliderDebug = useEditorStore((s) => s.showColliderDebug)
  const toggleColliderDebug = useEditorStore((s) => s.toggleColliderDebug)
  const showCoverVisualizer = useEditorStore((s) => s.showCoverVisualizer)
  const toggleCoverVisualizer = useEditorStore((s) => s.toggleCoverVisualizer)
  const showNavGrid = useEditorStore((s) => s.showNavGrid)
  const toggleNavGrid = useEditorStore((s) => s.toggleNavGrid)
  const navGridCellSize = useEditorStore((s) => s.navGridCellSize)
  const navGridRadius = useEditorStore((s) => s.navGridRadius)
  const setNavGridCellSize = useEditorStore((s) => s.setNavGridCellSize)
  const setNavGridRadius = useEditorStore((s) => s.setNavGridRadius)
  const showLosProbe = useEditorStore((s) => s.showLosProbe)
  const toggleLosProbe = useEditorStore((s) => s.toggleLosProbe)
  const losProbeRange = useEditorStore((s) => s.losProbeRange)
  const losProbeFovDeg = useEditorStore((s) => s.losProbeFovDeg)
  const setLosProbeRange = useEditorStore((s) => s.setLosProbeRange)
  const setLosProbeFovDeg = useEditorStore((s) => s.setLosProbeFovDeg)

  const waterLevel = useEditorStore((s) => s.waterLevel)
  const setWaterLevel = useEditorStore((s) => s.setWaterLevel)
  const autoFlattenOnPlace = useEditorStore((s) => s.autoFlattenOnPlace)
  const setAutoFlattenOnPlace = useEditorStore((s) => s.setAutoFlattenOnPlace)
  const flattenRadiusScale = useEditorStore((s) => s.flattenRadiusScale)
  const setFlattenRadiusScale = useEditorStore((s) => s.setFlattenRadiusScale)

  const heightBrushRadius = useEditorStore((s) => s.heightBrushRadius)
  const setHeightBrushRadius = useEditorStore((s) => s.setHeightBrushRadius)
  const heightBrushStrength = useEditorStore((s) => s.heightBrushStrength)
  const setHeightBrushStrength = useEditorStore((s) => s.setHeightBrushStrength)
  const heightBrushMode = useEditorStore((s) => s.heightBrushMode)
  const setHeightBrushMode = useEditorStore((s) => s.setHeightBrushMode)

  const roadTextureId = useEditorStore((s) => s.roadTextureId)
  const setRoadTextureId = useEditorStore((s) => s.setRoadTextureId)
  const roadWidth = useEditorStore((s) => s.roadWidth)
  const setRoadWidth = useEditorStore((s) => s.setRoadWidth)
  const finishRoadStroke = useEditorStore((s) => s.finishRoadStroke)
  const placementJitterEnabled = useEditorStore((s) => s.placementJitterEnabled)
  const placementJitterScalePct = useEditorStore((s) => s.placementJitterScalePct)
  const placementJitterRotationDeg = useEditorStore((s) => s.placementJitterRotationDeg)
  const setPlacementJitterEnabled = useEditorStore((s) => s.setPlacementJitterEnabled)
  const setPlacementJitterScalePct = useEditorStore((s) => s.setPlacementJitterScalePct)
  const setPlacementJitterRotationDeg = useEditorStore((s) => s.setPlacementJitterRotationDeg)

  const selectedId = useEditorStore((s) => s.selectedPlacementId)
  const placements = useEditorStore((s) => s.placements)
  const updatePlacement = useEditorStore((s) => s.updatePlacement)
  const removePlacement = useEditorStore((s) => s.removePlacement)
  const assets = useEditorStore((s) => s.assets)
  const prefabs = useEditorStore((s) => s.prefabs)
  const prefabCaptureRadius = useEditorStore((s) => s.prefabCaptureRadius)
  const setPrefabCaptureRadius = useEditorStore((s) => s.setPrefabCaptureRadius)
  const capturePrefabAroundCamera = useEditorStore((s) => s.capturePrefabAroundCamera)
  const deletePrefab = useEditorStore((s) => s.deletePrefab)
  const stampPrefabAtGhost = useEditorStore((s) => s.stampPrefabAtGhost)

  const postFx = useStore((s: any) => s.postProcessingParameters)
  const dayNight = useStore((s: any) => s.dayNightParameters)

  const placement = placements.find((p) => p.id === selectedId)
  const asset = assets.find((a) => a.id === placement?.assetId)

  const [openSections, setOpenSections] = useState<Record<SectionKey, boolean>>({
    scene: true,
    terrain: false,
    tool: true,
    prefabs: false,
    selection: true,
  })
  const [prefabName, setPrefabName] = useState('')

  const patchPostFx = (updates: Record<string, number | boolean>) => {
    useStore.setState((state: any) => ({
      postProcessingParameters: {
        ...state.postProcessingParameters,
        ...updates,
      },
    }))
  }

  const patchDayNight = (updates: Record<string, number | boolean>) => {
    useStore.setState((state: any) => ({
      dayNightParameters: {
        ...state.dayNightParameters,
        ...updates,
      },
    }))
  }

  const toggleSection = (key: SectionKey) => {
    setOpenSections((prev) => ({ ...prev, [key]: !prev[key] }))
  }

  const timeLabel = useMemo(() => {
    const value = Number(dayNight?.timeOfDay ?? 14)
    const normalized = ((value % 24) + 24) % 24
    const h = Math.floor(normalized)
    const m = Math.floor((normalized - h) * 60)
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
  }, [dayNight?.timeOfDay])

  return (
    <div style={panelStyle}>
      <div style={headerStyle}>Inspector</div>

      <CollapsibleSection
        title="Scene"
        open={openSections.scene}
        onToggle={() => toggleSection('scene')}
      >
        <label style={checkRowStyle}>
          <input type="checkbox" checked={runtimePreview} onChange={toggleRuntimePreview} />
          <span style={valueStyle}>Runtime look (P)</span>
        </label>
        <label style={checkRowStyle}>
          <input type="checkbox" checked={showColliderDebug} onChange={toggleColliderDebug} />
          <span style={valueStyle}>Collider debug (C)</span>
        </label>
        <label style={checkRowStyle}>
          <input type="checkbox" checked={showCoverVisualizer} onChange={toggleCoverVisualizer} />
          <span style={valueStyle}>Cover visualizer (K)</span>
        </label>
        <label style={checkRowStyle}>
          <input type="checkbox" checked={showLosProbe} onChange={toggleLosProbe} />
          <span style={valueStyle}>LOS probe (Y)</span>
        </label>
        <SliderField
          label="LOS Range"
          min={10}
          max={220}
          step={1}
          value={losProbeRange}
          onChange={(v) => setLosProbeRange(v)}
        />
        <SliderField
          label="LOS FOV"
          min={10}
          max={170}
          step={1}
          value={losProbeFovDeg}
          onChange={(v) => setLosProbeFovDeg(v)}
        />
        <label style={checkRowStyle}>
          <input type="checkbox" checked={showNavGrid} onChange={toggleNavGrid} />
          <span style={valueStyle}>Nav grid overlay (G)</span>
        </label>
        <SliderField
          label="Grid Cell"
          min={0.5}
          max={6}
          step={0.1}
          value={navGridCellSize}
          onChange={(v) => setNavGridCellSize(v)}
        />
        <SliderField
          label="Grid Radius"
          min={6}
          max={60}
          step={1}
          value={navGridRadius}
          onChange={(v) => setNavGridRadius(v)}
        />

        <div style={subSectionStyle}>
          <label style={checkRowStyle}>
            <input
              type="checkbox"
              checked={Boolean(dayNight?.enabled)}
              onChange={(e) => patchDayNight({ enabled: e.target.checked })}
            />
            <span style={valueStyle}>Day/Night</span>
          </label>
          <label style={checkRowStyle}>
            <input
              type="checkbox"
              checked={Boolean(dayNight?.autoCycle)}
              onChange={(e) => patchDayNight({ enabled: true, autoCycle: e.target.checked })}
            />
            <span style={valueStyle}>Auto cycle</span>
          </label>

          <div style={sliderRowStyle}>
            <label style={labelStyle}>Time</label>
            <span style={monoValueStyle}>{timeLabel}</span>
          </div>
          <input
            type="range"
            min={0}
            max={24}
            step={0.05}
            value={dayNight?.timeOfDay ?? 14}
            onChange={(e) => patchDayNight({ enabled: true, timeOfDay: Number(e.target.value) })}
          />
        </div>

        <div style={subSectionStyle}>
          <label style={checkRowStyle}>
            <input
              type="checkbox"
              checked={Boolean(postFx?.enabled)}
              onChange={(e) => patchPostFx({ enabled: e.target.checked })}
            />
            <span style={valueStyle}>Post FX</span>
          </label>
          <SliderField
            label="Rays"
            min={0}
            max={1}
            step={0.01}
            value={postFx?.godRaysWeight ?? 0.3}
            onChange={(v) => patchPostFx({ godRaysWeight: v })}
          />
          <SliderField
            label="Bloom"
            min={0}
            max={2}
            step={0.01}
            value={postFx?.bloomIntensity ?? 0.35}
            onChange={(v) => patchPostFx({ bloomIntensity: v })}
          />
          <SliderField
            label="Tint"
            min={0}
            max={2}
            step={0.01}
            value={postFx?.screenTintStrength ?? 1.35}
            onChange={(v) => patchPostFx({ screenTintStrength: v })}
          />
        </div>
      </CollapsibleSection>

      <CollapsibleSection
        title="Terrain"
        open={openSections.terrain}
        onToggle={() => toggleSection('terrain')}
      >
        <SliderField
          label="Water"
          min={-4}
          max={4}
          step={0.05}
          value={waterLevel}
          onChange={(v) => setWaterLevel(v)}
        />
        <label style={checkRowStyle}>
          <input
            type="checkbox"
            checked={autoFlattenOnPlace}
            onChange={(e) => setAutoFlattenOnPlace(e.target.checked)}
          />
          <span style={valueStyle}>Auto flatten on place</span>
        </label>
        <SliderField
          label="Flatten Radius"
          min={0.4}
          max={2.5}
          step={0.1}
          value={flattenRadiusScale}
          onChange={(v) => setFlattenRadiusScale(v)}
        />
      </CollapsibleSection>

      <CollapsibleSection
        title="Tool Settings"
        open={openSections.tool}
        onToggle={() => toggleSection('tool')}
      >
        {activeTool === 'line' ? (
          <LineToolSettings />
        ) : activeTool === 'height' ? (
          <>
            <label style={labelStyle}>Mode</label>
            <select
              value={heightBrushMode}
              onChange={(e) => setHeightBrushMode(e.target.value as any)}
              style={selectStyle}
            >
              <option value="raise">Raise</option>
              <option value="lower">Lower</option>
              <option value="flatten">Flatten</option>
            </select>
            <SliderField
              label="Brush Radius"
              min={0.5}
              max={8}
              step={0.25}
              value={heightBrushRadius}
              onChange={(v) => setHeightBrushRadius(v)}
            />
            <SliderField
              label="Brush Strength"
              min={0.02}
              max={0.8}
              step={0.02}
              value={heightBrushStrength}
              onChange={(v) => setHeightBrushStrength(v)}
            />
          </>
        ) : activeTool === 'road' ? (
          <>
            <label style={labelStyle}>Road Texture</label>
            <select
              value={roadTextureId}
              onChange={(e) => setRoadTextureId(e.target.value as any)}
              style={selectStyle}
            >
              <option value="road_1">Road 1</option>
              <option value="road_2">Road 2</option>
            </select>
            <SliderField
              label="Road Width"
              min={1}
              max={14}
              step={0.25}
              value={roadWidth}
              onChange={(v) => setRoadWidth(v)}
            />
            <button onClick={finishRoadStroke} style={neutralBtn}>
              Finish Stroke (Enter)
            </button>
          </>
        ) : activeTool === 'place' ? (
          <>
            <label style={checkRowStyle}>
              <input
                type="checkbox"
                checked={placementJitterEnabled}
                onChange={(e) => setPlacementJitterEnabled(e.target.checked)}
              />
              <span style={valueStyle}>Jitter placement</span>
            </label>
            <SliderField
              label="Scale Jitter"
              min={0}
              max={0.5}
              step={0.01}
              value={placementJitterScalePct}
              onChange={(v) => setPlacementJitterScalePct(v)}
            />
            <SliderField
              label="Rotation Jitter"
              min={0}
              max={45}
              step={1}
              value={placementJitterRotationDeg}
              onChange={(v) => setPlacementJitterRotationDeg(v)}
            />
          </>
        ) : (
          <div style={emptyStyle}>Select Place, Line, Height, or Road tool for context settings.</div>
        )}
      </CollapsibleSection>

      <CollapsibleSection
        title="Prefabs"
        open={openSections.prefabs}
        onToggle={() => toggleSection('prefabs')}
      >
        <div style={sectionStyle}>
          <label style={labelStyle}>Capture Name</label>
          <input
            type="text"
            value={prefabName}
            onChange={(e) => setPrefabName(e.target.value)}
            placeholder="Defensive_Point_A"
            style={inputStyle}
          />
        </div>
        <SliderField
          label="Capture Radius"
          min={2}
          max={120}
          step={1}
          value={prefabCaptureRadius}
          onChange={(v) => setPrefabCaptureRadius(v)}
        />
        <button
          onClick={() => {
            capturePrefabAroundCamera(prefabName)
            if (prefabName.trim()) setPrefabName('')
          }}
          style={neutralBtn}
        >
          Capture Around Camera
        </button>
        {prefabs.length === 0 ? (
          <div style={emptyStyle}>No prefabs yet. Arrange objects and capture around the camera target.</div>
        ) : (
          <div style={prefabListStyle}>
            {prefabs.map((prefab) => (
              <div key={prefab.id} style={prefabItemStyle}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                  <div>
                    <div style={valueStyle}>{prefab.name}</div>
                    <div style={hintStyle}>{prefab.items.length} items</div>
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button onClick={() => stampPrefabAtGhost(prefab.id)} style={smallBtnStyle}>Stamp</button>
                    <button onClick={() => deletePrefab(prefab.id)} style={smallDeleteBtnStyle}>Delete</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </CollapsibleSection>

      <CollapsibleSection
        title="Selection"
        open={openSections.selection}
        onToggle={() => toggleSection('selection')}
      >
        {!placement ? (
          <div style={emptyStyle}>No selection</div>
        ) : (
          <>
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
          </>
        )}
      </CollapsibleSection>
    </div>
  )
}

function CollapsibleSection({
  title,
  open,
  onToggle,
  children,
}: {
  title: string
  open: boolean
  onToggle: () => void
  children: React.ReactNode
}) {
  return (
    <div style={collapsibleWrapStyle}>
      <button onClick={onToggle} style={collapsibleHeaderStyle}>
        <span>{open ? '▾' : '▸'}</span>
        <span>{title}</span>
      </button>
      {open && <div style={collapsibleBodyStyle}>{children}</div>}
    </div>
  )
}

function SliderField({
  label,
  min,
  max,
  step,
  value,
  onChange,
}: {
  label: string
  min: number
  max: number
  step: number
  value: number
  onChange: (value: number) => void
}) {
  return (
    <div style={sliderFieldStyle}>
      <div style={sliderRowStyle}>
        <label style={labelStyle}>{label}</label>
        <span style={monoValueStyle}>{value.toFixed(2)}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
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

function LineToolSettings() {
  const lineSpacing = useEditorStore((s) => s.lineSpacing)
  const setLineSpacing = useEditorStore((s) => s.setLineSpacing)
  const lineAlignRotation = useEditorStore((s) => s.lineAlignRotation)
  const setLineAlignRotation = useEditorStore((s) => s.setLineAlignRotation)
  const selectedAssetId = useEditorStore((s) => s.selectedAssetId)
  const assets = useEditorStore((s) => s.assets)
  const asset = assets.find((a) => a.id === selectedAssetId)
  const effectiveSpacing = lineSpacing > 0 ? lineSpacing : (asset?.defaultScale ?? 1) * 1.5

  return (
    <>
      <div style={emptyStyle}>Click+drag to place objects along a line. Use [ ] to rotate base angle.</div>
      <SliderField
        label="Spacing"
        min={0.5}
        max={30}
        step={0.25}
        value={effectiveSpacing}
        onChange={(v) => setLineSpacing(v)}
      />
      <label style={checkRowStyle}>
        <input
          type="checkbox"
          checked={lineAlignRotation}
          onChange={(e) => setLineAlignRotation(e.target.checked)}
        />
        <span style={valueStyle}>Align to line direction</span>
      </label>
      <div style={hintStyle}>
        {asset ? `Asset: ${asset.name} (scale ${asset.defaultScale})` : 'Select an asset first'}
      </div>
    </>
  )
}

const panelStyle: React.CSSProperties = {
  width: 280,
  background: '#1e1e2e',
  borderLeft: '1px solid #333',
  overflowY: 'auto',
  flexShrink: 0,
  userSelect: 'none',
}

const headerStyle: React.CSSProperties = {
  padding: '12px 16px 10px',
  fontSize: 14,
  fontWeight: 600,
  color: '#fff',
  borderBottom: '1px solid #333',
}

const collapsibleWrapStyle: React.CSSProperties = {
  borderBottom: '1px solid #2d2d3d',
}

const collapsibleHeaderStyle: React.CSSProperties = {
  width: '100%',
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '8px 12px',
  background: '#242438',
  border: 'none',
  color: '#d6d6e6',
  fontSize: 12,
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: 0.6,
  cursor: 'pointer',
}

const collapsibleBodyStyle: React.CSSProperties = {
  padding: '10px 12px 12px',
  display: 'grid',
  gap: 8,
}

const emptyStyle: React.CSSProperties = {
  color: '#7d7d94',
  fontSize: 12,
  lineHeight: 1.4,
}

const subSectionStyle: React.CSSProperties = {
  marginTop: 4,
  paddingTop: 8,
  borderTop: '1px solid #31314a',
  display: 'grid',
  gap: 6,
}

const sectionStyle: React.CSSProperties = {
  padding: '2px 0',
}

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: 11,
  color: '#9696ae',
  marginBottom: 4,
  textTransform: 'uppercase',
  letterSpacing: 0.5,
}

const valueStyle: React.CSSProperties = {
  fontSize: 13,
  color: '#d6d6e6',
}

const monoValueStyle: React.CSSProperties = {
  fontSize: 11,
  color: '#aeb7d0',
  fontFamily: 'monospace',
}

const sliderFieldStyle: React.CSSProperties = {
  display: 'grid',
  gap: 4,
}

const sliderRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
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
  padding: '4px 6px',
  fontSize: 12,
}

const neutralBtn: React.CSSProperties = {
  background: '#2f3d62',
  border: '1px solid #4a6fa5',
  borderRadius: 4,
  color: '#d7e5ff',
  padding: '6px 10px',
  fontSize: 12,
  cursor: 'pointer',
}

const prefabListStyle: React.CSSProperties = {
  display: 'grid',
  gap: 6,
  maxHeight: 220,
  overflowY: 'auto',
  paddingRight: 2,
}

const prefabItemStyle: React.CSSProperties = {
  background: '#24243a',
  border: '1px solid #3b3b58',
  borderRadius: 6,
  padding: '8px 10px',
}

const smallBtnStyle: React.CSSProperties = {
  background: '#2f3d62',
  border: '1px solid #4a6fa5',
  borderRadius: 4,
  color: '#d7e5ff',
  padding: '3px 8px',
  fontSize: 11,
  cursor: 'pointer',
}

const smallDeleteBtnStyle: React.CSSProperties = {
  background: '#4e2a2a',
  border: '1px solid #6b3a3a',
  borderRadius: 4,
  color: '#ffdede',
  padding: '3px 8px',
  fontSize: 11,
  cursor: 'pointer',
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
