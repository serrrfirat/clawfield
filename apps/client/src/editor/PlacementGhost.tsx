import { useRef, useEffect, useMemo } from 'react'
import { useGLTF } from '@react-three/drei'
import { SkeletonUtils } from 'three-stdlib'
import * as THREE from 'three'
import useEditorStore from './useEditorStore'
import type { PrimitiveGeometry } from './editor-types'

const ROTATE_STEP = Math.PI / 12 // 15 degrees

const ghostMat = new THREE.MeshBasicMaterial({
  color: 0x66aaff,
  transparent: true,
  opacity: 0.35,
  depthWrite: false,
})

export default function PlacementGhost() {
  const activeTool = useEditorStore((s) => s.activeTool)
  const selectedAssetId = useEditorStore((s) => s.selectedAssetId)
  const assets = useEditorStore((s) => s.assets)
  const ghostPosition = useEditorStore((s) => s.ghostPosition)
  const ghostRotation = useEditorStore((s) => s.ghostRotation)

  const asset = assets.find((a) => a.id === selectedAssetId)
  const visible = activeTool === 'place' && !!asset

  // Listen for [ ] rotation keys
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return
      if (e.code === 'BracketLeft') useEditorStore.getState().rotateGhost(-ROTATE_STEP)
      if (e.code === 'BracketRight') useEditorStore.getState().rotateGhost(ROTATE_STEP)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  if (!visible || !asset) return null

  if (asset.primitive) {
    return (
      <GhostPrimitive
        primitive={asset.primitive}
        position={ghostPosition}
        rotationY={ghostRotation}
        scale={asset.defaultScale}
      />
    )
  }

  return <GhostModel path={asset.path} position={ghostPosition} rotationY={ghostRotation} scale={asset.defaultScale} />
}

function GhostPrimitive({
  primitive,
  position,
  rotationY,
  scale,
}: {
  primitive: PrimitiveGeometry
  position: [number, number, number]
  rotationY: number
  scale: number
}) {
  const yOffset = primitive.shape === 'box' ? (primitive.args[1] ?? 1) / 2
    : primitive.shape === 'cylinder' ? (primitive.args[4] ?? primitive.args[2] ?? 1) / 2
    : primitive.shape === 'cone' ? (primitive.args[1] ?? 1) / 2
    : primitive.args[0] ?? 1

  return (
    <group position={position} rotation={[0, rotationY, 0]} scale={[scale, scale, scale]}>
      <mesh position={[0, yOffset, 0]}>
        <PrimitiveGeo shape={primitive.shape} args={primitive.args} />
        <meshBasicMaterial color={0x66aaff} transparent opacity={0.35} depthWrite={false} />
      </mesh>
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

function GhostModel({
  path,
  position,
  rotationY,
  scale,
}: {
  path: string
  position: [number, number, number]
  rotationY: number
  scale: number
}) {
  const { scene } = useGLTF(path)
  const groupRef = useRef<THREE.Group>(null!)

  const clonedScene = useMemo(() => {
    const clone = SkeletonUtils.clone(scene)
    clone.traverse((child: any) => {
      if (child.isMesh || child.isSkinnedMesh) {
        child.material = ghostMat
      }
    })
    return clone
  }, [scene])

  return (
    <group ref={groupRef} position={position} rotation={[0, rotationY, 0]} scale={[scale, scale, scale]}>
      <primitive object={clonedScene} />
    </group>
  )
}
