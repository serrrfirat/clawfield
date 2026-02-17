import { useRef, useMemo, useEffect } from 'react'
import { useGLTF } from '@react-three/drei'
import * as THREE from 'three'
import useEditorStore from './useEditorStore'
import PlacedObject from './PlacedObject'
import type { EditorPlacement } from './editor-types'

const _dummy = new THREE.Object3D()
const _yMat = new THREE.Matrix4()
const _composed = new THREE.Matrix4()

export default function PlacedObjectsLayer() {
  const placements = useEditorStore((s) => s.placements)
  const selectedId = useEditorStore((s) => s.selectedPlacementId)
  const assets = useEditorStore((s) => s.assets)

  // Group non-selected placements by assetId
  const { groups, solos, selected } = useMemo(() => {
    const byAsset = new Map<string, EditorPlacement[]>()
    let sel: EditorPlacement | undefined

    for (const p of placements) {
      if (p.id === selectedId) {
        sel = p
        continue
      }
      const list = byAsset.get(p.assetId) ?? []
      list.push(p)
      byAsset.set(p.assetId, list)
    }

    // Split into instanced groups (2+) and solos (1)
    const instanced = new Map<string, EditorPlacement[]>()
    const singles: EditorPlacement[] = []
    for (const [assetId, items] of byAsset) {
      const asset = assets.find((a) => a.id === assetId)
      // Primitives and single placements render individually
      if (!asset || asset.primitive || items.length < 2) {
        singles.push(...items)
      } else {
        instanced.set(assetId, items)
      }
    }

    return { groups: instanced, solos: singles, selected: sel }
  }, [placements, selectedId, assets])

  return (
    <group>
      {/* Instanced groups — one draw call per mesh per asset */}
      {[...groups.entries()].map(([assetId, items]) => {
        const asset = assets.find((a) => a.id === assetId)
        if (!asset) return null
        return (
          <InstancedGLBGroup
            key={assetId}
            path={asset.path}
            placements={items}
          />
        )
      })}

      {/* Singles + primitives — individual rendering */}
      {solos.map((p) => (
        <PlacedObject key={p.id} placement={p} selected={false} />
      ))}

      {/* Selected object — always individual for TransformControls */}
      {selected && <PlacedObject placement={selected} selected />}
    </group>
  )
}

interface MeshInfo {
  geometry: THREE.BufferGeometry
  material: THREE.Material | THREE.Material[]
  localMatrix: THREE.Matrix4
}

function InstancedGLBGroup({
  path,
  placements,
}: {
  path: string
  placements: EditorPlacement[]
}) {
  const { scene } = useGLTF(path)

  // Extract mesh geometry/material/transform from the loaded scene
  const meshInfos = useMemo<MeshInfo[]>(() => {
    scene.updateMatrixWorld(true)
    const infos: MeshInfo[] = []
    scene.traverse((child: THREE.Object3D) => {
      if ((child as THREE.Mesh).isMesh) {
        const mesh = child as THREE.Mesh
        infos.push({
          geometry: mesh.geometry,
          material: mesh.material,
          localMatrix: mesh.matrixWorld.clone(),
        })
      }
    })
    return infos
  }, [scene])

  // Compute Y offset so model sits on ground
  const modelYOffset = useMemo(() => {
    const box = new THREE.Box3().setFromObject(scene)
    return Number.isFinite(box.min.y) ? -box.min.y : 0
  }, [scene])

  const meshRefs = useRef<(THREE.InstancedMesh | null)[]>([])

  // Update instance matrices whenever placements change
  useEffect(() => {
    _yMat.makeTranslation(0, modelYOffset, 0)

    for (const iMesh of meshRefs.current) {
      if (!iMesh) continue
      // Find which meshInfo this corresponds to (same index)
      const mi = meshRefs.current.indexOf(iMesh)
      const info = meshInfos[mi]
      if (!info) continue

      for (let i = 0; i < placements.length; i++) {
        const p = placements[i]
        _dummy.position.set(p.position[0], p.position[1], p.position[2])
        _dummy.rotation.set(p.rotation[0], p.rotation[1], p.rotation[2])
        _dummy.scale.set(p.scale[0], p.scale[1], p.scale[2])
        _dummy.updateMatrix()

        _composed.copy(_dummy.matrix).multiply(_yMat).multiply(info.localMatrix)
        iMesh.setMatrixAt(i, _composed)
      }
      iMesh.count = placements.length
      iMesh.instanceMatrix.needsUpdate = true
      iMesh.computeBoundingSphere()
    }
  }, [placements, meshInfos, modelYOffset])

  // Click handler — select the clicked instance
  const onClick = (e: any) => {
    e.stopPropagation()
    const store = useEditorStore.getState()
    if (store.activeTool !== 'select') return
    const instanceId = e.instanceId
    if (instanceId != null && instanceId < placements.length) {
      store.selectPlacement(placements[instanceId].id)
    }
  }

  const count = placements.length

  return (
    <group>
      {meshInfos.map((info, mi) => (
        <instancedMesh
          key={mi}
          ref={(ref: THREE.InstancedMesh | null) => { meshRefs.current[mi] = ref }}
          args={[info.geometry, info.material as THREE.Material, count]}
          onClick={onClick}
          castShadow
          receiveShadow
          frustumCulled={false}
        />
      ))}
    </group>
  )
}
