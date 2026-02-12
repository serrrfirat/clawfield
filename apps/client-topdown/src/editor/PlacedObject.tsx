import { useRef, useMemo } from 'react'
import { useGLTF } from '@react-three/drei'
import { SkeletonUtils } from 'three-stdlib'
import * as THREE from 'three'
import type { EditorPlacement } from './editor-types'
import useEditorStore from './useEditorStore'

interface Props {
  placement: EditorPlacement
  selected: boolean
}

export default function PlacedObject({ placement, selected }: Props) {
  const assets = useEditorStore((s) => s.assets)
  const asset = assets.find((a) => a.id === placement.assetId)

  if (!asset) return null

  return (
    <PlacedGLB
      path={asset.path}
      placement={placement}
      selected={selected}
    />
  )
}

function PlacedGLB({
  path,
  placement,
  selected,
}: {
  path: string
  placement: EditorPlacement
  selected: boolean
}) {
  const { scene } = useGLTF(path)
  const groupRef = useRef<THREE.Group>(null!)

  const clonedScene = useMemo(() => SkeletonUtils.clone(scene), [scene])

  const onClick = (e: any) => {
    e.stopPropagation()
    const store = useEditorStore.getState()
    if (store.activeTool === 'select') {
      store.selectPlacement(placement.id)
    }
  }

  return (
    <group
      ref={groupRef}
      position={placement.position}
      rotation={placement.rotation}
      scale={placement.scale}
      onClick={onClick}
    >
      <primitive object={clonedScene} />
      {selected && <SelectionBox groupRef={groupRef} />}
    </group>
  )
}

function SelectionBox({ groupRef }: { groupRef: React.RefObject<THREE.Group> }) {
  const box = useMemo(() => {
    if (!groupRef.current) return null
    const bbox = new THREE.Box3().setFromObject(groupRef.current)
    const size = bbox.getSize(new THREE.Vector3())
    const center = bbox.getCenter(new THREE.Vector3())
    if (groupRef.current.parent) {
      groupRef.current.parent.worldToLocal(center)
    }
    return { size, center }
  }, [groupRef.current])

  if (!box) return null

  return (
    <mesh position={[box.center.x, box.center.y, box.center.z]}>
      <boxGeometry args={[box.size.x * 1.05, box.size.y * 1.05, box.size.z * 1.05]} />
      <meshBasicMaterial color="#4a9fff" wireframe transparent opacity={0.5} />
    </mesh>
  )
}
