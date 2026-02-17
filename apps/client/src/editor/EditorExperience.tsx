import { useRef, useCallback, useEffect, useMemo } from 'react'
import { useThree, useFrame } from '@react-three/fiber'
import { TransformControls } from '@react-three/drei'
import { Physics } from '@react-three/rapier'
import * as THREE from 'three'
import EditorCamera from './EditorCamera'
import EditorTerrain, { getTerrainHeight } from './EditorTerrain'
import PlacedObjectsLayer from './PlacedObjectsLayer'
import PlacementGhost from './PlacementGhost'
import EditorCoverVisualizer from './EditorCoverVisualizer'
import EditorLosOverlay from './EditorLosOverlay'
import EditorNavGridOverlay from './EditorNavGridOverlay'
import useEditorStore from './useEditorStore'
import { downloadMapdef, loadMapdef } from './mapdef-adapter'
import { getDefaultCollidableForAsset, getDefaultGrassSuppressRadius, getDefaultSuppressGrassForAsset } from './collision-defaults'
import { computeLineGhosts } from './line-tool-utils'
import Terrain from '../world/Terrain'
import Lights from '../world/Lights'
import useStore from '../stores/useStore'
import type { MapdefPlacement } from './editor-types'
import RoadLayer from '../world/RoadLayer'

const _raycaster = new THREE.Raycaster()
const _mouse = new THREE.Vector2()
const _groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
const _hitPoint = new THREE.Vector3()

export default function EditorExperience() {
  const { camera, gl, scene } = useThree()
  const isPaintingRef = useRef(false)
  const runtimePreview = useEditorStore((s) => s.runtimePreview)
  const placements = useEditorStore((s) => s.placements)
  const terrainSeed = useEditorStore((s) => s.terrainSeed)
  const terrainScale = useEditorStore((s) => s.terrainScale)
  const terrainAmplitude = useEditorStore((s) => s.terrainAmplitude)
  const waterLevel = useEditorStore((s) => s.waterLevel)
  const heightCellSize = useEditorStore((s) => s.heightCellSize)
  const heightCells = useEditorStore((s) => s.heightCells)
  const roads = useEditorStore((s) => s.roads)
  const setLosProbeAim = useEditorStore((s) => s.setLosProbeAim)
  const setLosProbeOrigin = useEditorStore((s) => s.setLosProbeOrigin)
  const placementJitterEnabled = useEditorStore((s) => s.placementJitterEnabled)
  const placementJitterScalePct = useEditorStore((s) => s.placementJitterScalePct)
  const placementJitterRotationDeg = useEditorStore((s) => s.placementJitterRotationDeg)

  const runtimePlacements = useMemo<MapdefPlacement[]>(() => {
    return placements.map((p) => ({
      componentId: p.assetId,
      position: p.position,
      rotation: p.rotation,
      scale: p.scale,
      source: p.source,
      metadata: p.metadata,
    }))
  }, [placements])

  useEffect(() => {
    if (!runtimePreview) return

    const mapTerrain = {
      seed: terrainSeed,
      scale: terrainScale,
      amplitude: terrainAmplitude,
      waterLevel,
      heightmap: {
        cellSize: heightCellSize,
        cells: Object.entries(heightCells).map(([key, h]) => {
          const [sx, sz] = key.split(',')
          return { x: Number(sx), z: Number(sz), h: Number(h) }
        }).filter((c) => Number.isFinite(c.x) && Number.isFinite(c.z) && Number.isFinite(c.h)),
      },
    }

    useStore.setState({
      mapTerrain,
      mapPlacements: runtimePlacements,
      mapRoads: roads,
    })
  }, [runtimePreview, terrainSeed, terrainScale, terrainAmplitude, waterLevel, heightCellSize, heightCells, runtimePlacements, roads])

  useFrame(() => {
    if (!runtimePreview) return
    const [x, y, z] = useEditorStore.getState().cameraTarget
    const runtime = useStore.getState() as any
    runtime.ballPosition?.set(x, y, z)
    runtime.smoothedCircleCenter?.set(x, y, z)
  })

  // Track mouse position for ghost placement
  useEffect(() => {
    const canvas = gl.domElement
    const cam = camera as unknown as THREE.Camera

    const hitTerrain = (e: PointerEvent | MouseEvent): [number, number, number] | null => {
      const rect = canvas.getBoundingClientRect()
      _mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1
      _mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1
      _raycaster.setFromCamera(_mouse, cam)

      const terrainMeshes: THREE.Object3D[] = []
      ;(scene as unknown as THREE.Scene).traverse((child: THREE.Object3D) => {
        if ((child as any).isMesh && child.userData.editorTerrain) {
          terrainMeshes.push(child)
        }
      })

      const hits = _raycaster.intersectObjects(terrainMeshes, false)
      if (hits.length > 0) {
        const p = hits[0].point
        return [p.x, p.y, p.z]
      }
      const hit = _raycaster.ray.intersectPlane(_groundPlane, _hitPoint)
      if (hit) {
        const y = getTerrainHeight(_hitPoint.x, _hitPoint.z)
        return [_hitPoint.x, y, _hitPoint.z]
      }
      return null
    }

    const onPointerMove = (e: PointerEvent) => {
      const store = useEditorStore.getState()
      const tool = store.activeTool
      const needsHover = tool === 'select' && store.showLosProbe
      if (tool !== 'place' && tool !== 'line' && tool !== 'height' && tool !== 'road' && !needsHover) return

      const pos = hitTerrain(e)
      if (!pos) return

      if (tool === 'place' || tool === 'road') {
        store.setGhostPosition(pos)
      } else if (tool === 'line') {
        store.setGhostPosition(pos)
        // Update line end while dragging
        if (store.lineStart) {
          store.setLineEnd(pos)
        }
      } else if (tool === 'select' && store.showLosProbe) {
        store.setGhostPosition(pos)
        setLosProbeAim(pos)
      } else if (tool === 'height' && isPaintingRef.current) {
        store.applyHeightBrushAt(pos[0], pos[2])
      }
    }

    const onPointerDown = (e: PointerEvent) => {
      const store = useEditorStore.getState()
      if (store.activeTool === 'height') {
        isPaintingRef.current = true
      } else if (store.activeTool === 'line' && store.selectedAssetId) {
        const pos = hitTerrain(e)
        if (pos) {
          store.setLineStart(pos)
          store.setLineEnd(pos)
        }
      }
    }

    const onPointerUp = (e: PointerEvent) => {
      isPaintingRef.current = false

      const store = useEditorStore.getState()
      if (store.activeTool === 'line' && store.lineStart && store.lineEnd && store.selectedAssetId) {
        const asset = store.assets.find((a) => a.id === store.selectedAssetId)
        if (!asset) { store.setLineStart(null); store.setLineEnd(null); return }

        const s = asset.defaultScale
        const spacing = store.lineSpacing > 0 ? store.lineSpacing : s * 1.5
        const ghosts = computeLineGhosts(store.lineStart, store.lineEnd, spacing, store.lineAlignRotation, store.ghostRotation)

        const collidable = getDefaultCollidableForAsset(asset)
        const suppressGrass = getDefaultSuppressGrassForAsset(asset)

        for (const g of ghosts) {
          const py = getTerrainHeight(g.position[0], g.position[2])
          const jitterScaleMul = placementJitterEnabled
            ? (1 + (Math.random() * 2 - 1) * placementJitterScalePct)
            : 1
          const jitterRot = placementJitterEnabled
            ? THREE.MathUtils.degToRad((Math.random() * 2 - 1) * placementJitterRotationDeg)
            : 0
          const scale = [s * jitterScaleMul, s * jitterScaleMul, s * jitterScaleMul] as [number, number, number]
          store.addPlacement({
            id: crypto.randomUUID(),
            assetId: store.selectedAssetId,
            position: [g.position[0], py, g.position[2]],
            rotation: [0, g.rotationY + jitterRot, 0],
            scale,
            source: 'manual',
            metadata: {
              collidable,
              suppressGrass,
              grassSuppressRadius: getDefaultGrassSuppressRadius(asset, scale),
            },
          })
        }

        store.setLineStart(null)
        store.setLineEnd(null)
      }
    }

    const onClick = (e: MouseEvent) => {
      const store = useEditorStore.getState()

      // Line tool commits on pointerup, not click
      if (store.activeTool === 'line') return

      if (store.activeTool === 'select' && store.showLosProbe) {
        setLosProbeOrigin([...store.ghostPosition])
        return
      }

      if (store.activeTool === 'place' && store.selectedAssetId) {
        const asset = store.assets.find((a) => a.id === store.selectedAssetId)
        if (!asset) return

        const s = asset.defaultScale
        const jitterScaleMul = placementJitterEnabled
          ? (1 + (Math.random() * 2 - 1) * placementJitterScalePct)
          : 1
        const jitterRot = placementJitterEnabled
          ? THREE.MathUtils.degToRad((Math.random() * 2 - 1) * placementJitterRotationDeg)
          : 0
        const scale = [s * jitterScaleMul, s * jitterScaleMul, s * jitterScaleMul] as [number, number, number]
        const collidable = getDefaultCollidableForAsset(asset)
        const suppressGrass = getDefaultSuppressGrassForAsset(asset)
        const grassSuppressRadius = getDefaultGrassSuppressRadius(asset, scale)
        store.addPlacement({
          id: crypto.randomUUID(),
          assetId: store.selectedAssetId,
          position: [...store.ghostPosition],
          rotation: [0, store.ghostRotation + jitterRot, 0],
          scale,
          source: 'manual',
          metadata: { collidable, suppressGrass, grassSuppressRadius },
        })

        if (store.autoFlattenOnPlace) {
          store.flattenHeightAround(store.ghostPosition[0], store.ghostPosition[2], grassSuppressRadius * store.flattenRadiusScale)
        }
      } else if (store.activeTool === 'road') {
        store.addRoadPointAt(store.ghostPosition[0], store.ghostPosition[2])
      }
    }

    const onDoubleClick = () => {
      const store = useEditorStore.getState()
      if (store.activeTool === 'road') {
        store.finishRoadStroke()
      }
    }

    canvas.addEventListener('pointermove', onPointerMove)
    canvas.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('pointerup', onPointerUp)
    canvas.addEventListener('click', onClick)
    canvas.addEventListener('dblclick', onDoubleClick)
    return () => {
      canvas.removeEventListener('pointermove', onPointerMove)
      canvas.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('pointerup', onPointerUp)
      canvas.removeEventListener('click', onClick)
      canvas.removeEventListener('dblclick', onDoubleClick)
    }
  }, [
    camera,
    gl,
    scene,
    setLosProbeAim,
    setLosProbeOrigin,
    placementJitterEnabled,
    placementJitterScalePct,
    placementJitterRotationDeg,
  ])

  // Listen for save/load custom events from ToolBar
  useEffect(() => {
    const onSave = () => downloadMapdef()
    const onLoad = () => loadMapdef()
    document.addEventListener('editor-save', onSave)
    document.addEventListener('editor-load', onLoad)
    return () => {
      document.removeEventListener('editor-save', onSave)
      document.removeEventListener('editor-load', onLoad)
    }
  }, [])

  // Click on background deselects
  const onPointerMissed = useCallback(() => {
    const store = useEditorStore.getState()
    if (store.activeTool === 'select') {
      store.selectPlacement(null)
    }
  }, [])

  return (
    <>
      <color args={['#9a9065']} attach="background" />
      <Lights />
      <EditorCamera />
      <group onPointerMissed={onPointerMissed}>
        {runtimePreview ? (
          <Physics gravity={[0, 0, 0]}>
            <Terrain disableDither />
          </Physics>
        ) : <EditorTerrain />}
        {!runtimePreview && <RoadLayer roads={roads} heightGetter={getTerrainHeight} />}
        <PlacedObjectsLayer />
        {!runtimePreview && <EditorCoverVisualizer />}
        {!runtimePreview && <EditorNavGridOverlay />}
        {!runtimePreview && <EditorLosOverlay />}
        <PlacementGhost />
      </group>
      <SelectedTransform />
      <gridHelper args={[200, 200, '#555', '#333']} position={[0, 0.01, 0]} />
    </>
  )
}

/** Attaches drei TransformControls to the currently selected placement */
function SelectedTransform() {
  const selectedId = useEditorStore((s) => s.selectedPlacementId)
  const gizmoMode = useEditorStore((s) => s.gizmoMode)
  const placements = useEditorStore((s) => s.placements)
  const updatePlacement = useEditorStore((s) => s.updatePlacement)

  const placement = placements.find((p) => p.id === selectedId)
  const objRef = useRef<THREE.Group>(null!)

  if (!placement) return null

  return (
    <group>
      <group
        ref={objRef}
        position={placement.position}
        rotation={placement.rotation}
        scale={placement.scale}
      />
      {objRef.current && (
        <TransformControls
          object={objRef.current as any}
          mode={gizmoMode}
          onObjectChange={() => {
            if (!objRef.current || !selectedId) return
            const pos = objRef.current.position
            const rot = objRef.current.rotation
            const scl = objRef.current.scale
            updatePlacement(selectedId, {
              position: [pos.x, pos.y, pos.z],
              rotation: [rot.x, rot.y, rot.z],
              scale: [scl.x, scl.y, scl.z],
            })
          }}
        />
      )}
    </group>
  )
}
