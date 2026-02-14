import { useRef, useCallback, useEffect, useMemo } from 'react'
import { useThree, useFrame } from '@react-three/fiber'
import { TransformControls } from '@react-three/drei'
import { Physics } from '@react-three/rapier'
import * as THREE from 'three'
import EditorCamera from './EditorCamera'
import EditorTerrain, { getTerrainHeight } from './EditorTerrain'
import PlacedObjectsLayer from './PlacedObjectsLayer'
import PlacementGhost from './PlacementGhost'
import useEditorStore from './useEditorStore'
import { downloadMapdef, loadMapdef } from './mapdef-adapter'
import { getDefaultCollidableForAsset, getDefaultGrassSuppressRadius, getDefaultSuppressGrassForAsset } from './collision-defaults'
import Terrain from '../world/Terrain'
import PostProcessing from '../world/PostProcessing'
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
    const center = new THREE.Vector3(x, y, z)
    useStore.setState({
      ballPosition: center,
      smoothedCircleCenter: center,
    })
  })

  // Track mouse position for ghost placement
  useEffect(() => {
    const canvas = gl.domElement
    const cam = camera as unknown as THREE.Camera

    const onPointerMove = (e: PointerEvent) => {
      const store = useEditorStore.getState()
      if (store.activeTool !== 'place' && store.activeTool !== 'height' && store.activeTool !== 'road') return

      const rect = canvas.getBoundingClientRect()
      _mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1
      _mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1

      _raycaster.setFromCamera(_mouse, cam)

      // Raycast against terrain meshes
      const terrainMeshes: THREE.Object3D[] = []
      ;(scene as unknown as THREE.Scene).traverse((child: THREE.Object3D) => {
        if ((child as any).isMesh && child.userData.editorTerrain) {
          terrainMeshes.push(child)
        }
      })

      const hits = _raycaster.intersectObjects(terrainMeshes, false)
      if (hits.length > 0) {
        const p = hits[0].point
        if (store.activeTool === 'place' || store.activeTool === 'road') {
          store.setGhostPosition([p.x, p.y, p.z])
        } else if (store.activeTool === 'height' && isPaintingRef.current) {
          store.applyHeightBrushAt(p.x, p.z)
        }
      } else {
        // Fallback: intersect ground plane
        const hit = _raycaster.ray.intersectPlane(_groundPlane, _hitPoint)
        if (hit) {
          const y = getTerrainHeight(_hitPoint.x, _hitPoint.z)
          if (store.activeTool === 'place' || store.activeTool === 'road') {
            store.setGhostPosition([_hitPoint.x, y, _hitPoint.z])
          } else if (store.activeTool === 'height' && isPaintingRef.current) {
            store.applyHeightBrushAt(_hitPoint.x, _hitPoint.z)
          }
        }
      }
    }

    const onPointerDown = () => {
      const store = useEditorStore.getState()
      if (store.activeTool === 'height') {
        isPaintingRef.current = true
      }
    }

    const onPointerUp = () => {
      isPaintingRef.current = false
    }

    const onClick = (e: MouseEvent) => {
      const store = useEditorStore.getState()

      if (store.activeTool === 'place' && store.selectedAssetId) {
        const asset = store.assets.find((a) => a.id === store.selectedAssetId)
        if (!asset) return

        const s = asset.defaultScale
        const collidable = getDefaultCollidableForAsset(asset)
        const suppressGrass = getDefaultSuppressGrassForAsset(asset)
        const grassSuppressRadius = getDefaultGrassSuppressRadius(asset, [s, s, s])
        store.addPlacement({
          id: crypto.randomUUID(),
          assetId: store.selectedAssetId,
          position: [...store.ghostPosition],
          rotation: [0, store.ghostRotation, 0],
          scale: [s, s, s],
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
  }, [camera, gl, scene])

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
      <directionalLight position={[4, 10, 1]} intensity={4.5} />
      <ambientLight intensity={3.5} />
      <EditorCamera />
      <group onPointerMissed={onPointerMissed}>
        {runtimePreview ? (
          <Physics gravity={[0, 0, 0]}>
            <Terrain disableDither />
          </Physics>
        ) : <EditorTerrain />}
        <RoadLayer roads={roads} heightGetter={getTerrainHeight} />
        <PlacedObjectsLayer />
        <PlacementGhost />
      </group>
      <SelectedTransform />
      <gridHelper args={[200, 200, '#555', '#333']} position={[0, 0.01, 0]} />
      <PostProcessing />
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
