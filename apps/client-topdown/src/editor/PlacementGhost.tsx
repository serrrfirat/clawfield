import { useRef, useEffect, useMemo } from 'react'
import { useGLTF } from '@react-three/drei'
import { SkeletonUtils } from 'three-stdlib'
import * as THREE from 'three'
import useEditorStore from './useEditorStore'

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

  return <GhostModel path={asset.path} position={ghostPosition} rotationY={ghostRotation} scale={asset.defaultScale} />
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
