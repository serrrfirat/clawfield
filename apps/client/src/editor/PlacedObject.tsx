import { useRef, useMemo } from 'react'
import { useGLTF } from '@react-three/drei'
import { SkeletonUtils } from 'three-stdlib'
import * as THREE from 'three'
import type { EditorPlacement, PrimitiveGeometry } from './editor-types'
import useEditorStore from './useEditorStore'

interface Props {
  placement: EditorPlacement
  selected: boolean
}

export default function PlacedObject({ placement, selected }: Props) {
  const assets = useEditorStore((s) => s.assets)
  const asset = assets.find((a) => a.id === placement.assetId)

  if (!asset) return null

  if (asset.primitive) {
    return (
      <PlacedPrimitive
        primitive={asset.primitive}
        placement={placement}
        selected={selected}
      />
    )
  }

  return (
    <PlacedGLB
      path={asset.path}
      placement={placement}
      selected={selected}
    />
  )
}

function PlacedPrimitive({
  primitive,
  placement,
  selected,
}: {
  primitive: PrimitiveGeometry
  placement: EditorPlacement
  selected: boolean
}) {
  const groupRef = useRef<THREE.Group>(null!)

  const onClick = (e: any) => {
    e.stopPropagation()
    const store = useEditorStore.getState()
    if (store.activeTool === 'select') {
      store.selectPlacement(placement.id)
    }
  }

  // Offset Y so the bottom of the shape sits on the ground
  const yOffset = primitive.shape === 'box' ? (primitive.args[1] ?? 1) / 2
    : primitive.shape === 'cylinder' ? (primitive.args[4] ?? primitive.args[2] ?? 1) / 2
    : primitive.shape === 'cone' ? (primitive.args[1] ?? 1) / 2
    : primitive.args[0] ?? 1 // sphere radius

  return (
    <group
      ref={groupRef}
      position={placement.position}
      rotation={placement.rotation}
      scale={placement.scale}
      onClick={onClick}
    >
      <mesh position={[0, yOffset, 0]} castShadow receiveShadow>
        <PrimitiveGeo shape={primitive.shape} args={primitive.args} />
        <meshStandardMaterial color={primitive.color} roughness={0.85} />
      </mesh>
      {selected && <SelectionBox groupRef={groupRef} />}
    </group>
  )
}

function PrimitiveGeo({ shape, args }: { shape: string; args: number[] }) {
  switch (shape) {
    case 'box':
      return <boxGeometry args={args as [number, number, number]} />
    case 'cylinder':
      return <cylinderGeometry args={args as [number, number, number, number]} />
    case 'cone':
      return <coneGeometry args={args as [number, number, number]} />
    case 'sphere':
      return <sphereGeometry args={args as [number, number, number]} />
    default:
      return <boxGeometry args={[1, 1, 1]} />
  }
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
