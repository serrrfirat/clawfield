import { useMemo, useEffect, useRef, useContext } from 'react'
import { useGLTF } from '@react-three/drei'
import { SkeletonUtils } from 'three-stdlib'
import { RigidBody, CuboidCollider, interactionGroups } from '@react-three/rapier'
import * as THREE from 'three'
import useStore from '../stores/useStore'
import assetCatalog from '../editor/asset-catalog.json'
import type { MapdefPlacement } from '../editor/editor-types'
import type { AssetEntry, EditorPlacement } from '../editor/editor-types'
import {
    getDefaultColliderScale,
    getPlacementCollidable,
    getPlacementColliderType,
} from '../editor/collision-defaults'
import { TerrainUniformsContext } from './TerrainUniformsContext'
import {
    type DitherUniforms,
    linkDitherUniformsFromTreeUniforms,
    patchMaterialWithDither,
} from '../render/dither-reveal'

function PlacedAsset({ placement, enableColliders }: { placement: MapdefPlacement; enableColliders: boolean }) {
    const entry = assetCatalog.find((a) => a.id === placement.componentId) as AssetEntry | undefined
    if (!entry) return null
    return <PlacedGLB asset={entry} path={entry.path} placement={placement} enableColliders={enableColliders} />
}

function PlacedGLB({ asset, path, placement, enableColliders }: { asset: AssetEntry; path: string; placement: MapdefPlacement; enableColliders: boolean }) {
    const { scene } = useGLTF(path)
    const cloned = useMemo(() => SkeletonUtils.clone(scene), [scene])
    const placementAsEditor = placement as unknown as EditorPlacement

    const terrainUniformsRef = useContext(TerrainUniformsContext)
    const patchedMatsRef = useRef<THREE.Material[]>([])
    const colliderRef = useRef<any>(null)

    const ditherUniforms = useMemo<DitherUniforms | null>(() => {
        if (!terrainUniformsRef?.current?.treeMaterialUniforms || !terrainUniformsRef?.current?.noiseTexture) {
            return null
        }
        return linkDitherUniformsFromTreeUniforms(
            terrainUniformsRef.current.treeMaterialUniforms,
            terrainUniformsRef.current.noiseTexture
        )
    }, [terrainUniformsRef])

    useEffect(() => {
        cloned.traverse((child) => {
            const mesh = child as THREE.Mesh
            if (!mesh.isMesh) return
            mesh.castShadow = true
            mesh.receiveShadow = true
        })
    }, [cloned])

    useEffect(() => {
        if (!ditherUniforms) return

        const patched: THREE.Material[] = []
        cloned.traverse((child) => {
            const mesh = child as THREE.Mesh
            if (!mesh.isMesh) return
            if (Array.isArray(mesh.material)) {
                mesh.material = mesh.material.map((m) => {
                    const clonedMat = m.clone()
                    patchMaterialWithDither(clonedMat, ditherUniforms)
                    patched.push(clonedMat)
                    return clonedMat
                })
            } else {
                const clonedMat = mesh.material.clone()
                patchMaterialWithDither(clonedMat, ditherUniforms)
                patched.push(clonedMat)
                mesh.material = clonedMat
            }
        })
        patchedMatsRef.current = patched

        return () => {
            for (const mat of patched) mat.dispose()
            patchedMatsRef.current = []
        }
    }, [cloned, ditherUniforms])

    const boundingBox = useMemo(() => {
        const box = new THREE.Box3()
        cloned.traverse((child) => {
            if (child instanceof THREE.Mesh) {
                child.updateMatrixWorld(true)
                const childBox = new THREE.Box3().setFromObject(child)
                box.union(childBox)
            }
        })
        const size = box.getSize(new THREE.Vector3())
        const center = box.getCenter(new THREE.Vector3())
        const minY = box.min.y
        const maxY = box.max.y
        return { size, center, minY, maxY }
    }, [cloned])

    const halfExtents: [number, number, number] = useMemo(() => {
        const s = placement.scale ?? [1, 1, 1]
        const colliderScale =
            typeof placementAsEditor.metadata?.colliderScale === 'number'
                ? placementAsEditor.metadata.colliderScale
                : getDefaultColliderScale(asset)
        const scaledWidth = boundingBox.size.x * s[0]
        const scaledHeight = boundingBox.size.y * s[1]
        const scaledDepth = boundingBox.size.z * s[2]
        return [
            scaledWidth * colliderScale * 0.5,
            scaledHeight * colliderScale * 0.5,
            scaledDepth * colliderScale * 0.5,
        ]
    }, [asset, boundingBox, placement.scale, placementAsEditor.metadata?.colliderScale])

    const colliderY = useMemo(() => {
        const s = placement.scale ?? [1, 1, 1]
        const modelBottomY = boundingBox.minY * s[1]
        const modelCenterY = boundingBox.center.y * s[1]
        return modelBottomY - modelCenterY
    }, [boundingBox, placement.scale])

    const visualYOffset = useMemo(() => {
        const s = placement.scale ?? [1, 1, 1]
        return -boundingBox.minY * s[1]
    }, [boundingBox.minY, placement.scale])

    const collidable = getPlacementCollidable(placementAsEditor, asset)
    const colliderType = getPlacementColliderType(placementAsEditor, asset)

    if (!enableColliders || !collidable || colliderType === 'none') {
        return (
            <group position={placement.position} rotation={placement.rotation}>
                <primitive object={cloned} scale={placement.scale ?? [1, 1, 1]} position={[0, visualYOffset, 0]} />
            </group>
        )
    }

    const rigidBodyColliders = colliderType === 'trimesh' ? 'trimesh' : false

    return (
        <RigidBody
            type="fixed"
            position={placement.position}
            rotation={placement.rotation}
            colliders={rigidBodyColliders as any}
            userData={{ name: 'placed-object', componentId: placement.componentId }}
        >
            {colliderType === 'cuboid' && (
                <CuboidCollider
                    ref={colliderRef}
                    args={halfExtents}
                    position={[0, colliderY, 0]}
                    collisionGroups={interactionGroups([1], [0])}
                />
            )}
            <primitive
                object={cloned}
                scale={placement.scale ?? [1, 1, 1]}
                position={[0, visualYOffset, 0]}
            />
        </RigidBody>
    )
}

export default function MapPlacements() {
    const placements = useStore((s) => s.mapPlacements)
    const enableColliders = true

    if (!placements.length) return null

    return (
        <>
            {placements.map((p, i) => (
                <PlacedAsset key={`${p.componentId}-${i}`} placement={p} enableColliders={enableColliders} />
            ))}
        </>
    )
}
