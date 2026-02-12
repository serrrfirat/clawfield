import { useRef, useCallback, useEffect } from 'react'
import { useThree } from '@react-three/fiber'
import { TransformControls } from '@react-three/drei'
import * as THREE from 'three'
import EditorCamera from './EditorCamera'
import EditorTerrain, { getTerrainHeight } from './EditorTerrain'
import PlacedObjectsLayer from './PlacedObjectsLayer'
import PlacementGhost from './PlacementGhost'
import useEditorStore from './useEditorStore'
import { downloadMapdef, loadMapdef } from './mapdef-adapter'

const _raycaster = new THREE.Raycaster()
const _mouse = new THREE.Vector2()
const _groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
const _hitPoint = new THREE.Vector3()

export default function EditorExperience() {
  const { camera, gl, scene } = useThree()

  // Track mouse position for ghost placement
  useEffect(() => {
    const canvas = gl.domElement
    const cam = camera as unknown as THREE.Camera

    const onPointerMove = (e: PointerEvent) => {
      const store = useEditorStore.getState()
      if (store.activeTool !== 'place') return

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
        store.setGhostPosition([p.x, p.y, p.z])
      } else {
        // Fallback: intersect ground plane
        const hit = _raycaster.ray.intersectPlane(_groundPlane, _hitPoint)
        if (hit) {
          const y = getTerrainHeight(_hitPoint.x, _hitPoint.z)
          store.setGhostPosition([_hitPoint.x, y, _hitPoint.z])
        }
      }
    }

    const onClick = (e: MouseEvent) => {
      const store = useEditorStore.getState()

      if (store.activeTool === 'place' && store.selectedAssetId) {
        const asset = store.assets.find((a) => a.id === store.selectedAssetId)
        if (!asset) return

        const s = asset.defaultScale
        store.addPlacement({
          id: crypto.randomUUID(),
          assetId: store.selectedAssetId,
          position: [...store.ghostPosition],
          rotation: [0, store.ghostRotation, 0],
          scale: [s, s, s],
          source: 'manual',
        })
      }
    }

    canvas.addEventListener('pointermove', onPointerMove)
    canvas.addEventListener('click', onClick)
    return () => {
      canvas.removeEventListener('pointermove', onPointerMove)
      canvas.removeEventListener('click', onClick)
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
        <EditorTerrain />
        <PlacedObjectsLayer />
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
