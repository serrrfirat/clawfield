import { useMemo, useEffect, useRef, useContext } from 'react'
import { useGLTF } from '@react-three/drei'
import { SkeletonUtils } from 'three-stdlib'
import { RigidBody, CuboidCollider, interactionGroups } from '@react-three/rapier'
import * as THREE from 'three'
import useStore from '../stores/useStore'
import assetCatalog from '../editor/asset-catalog.json'
import type { MapdefPlacement } from '../editor/editor-types'
import { TerrainUniformsContext } from './TerrainUniformsContext'
import {
    type DitherUniforms,
    linkDitherUniformsFromTreeUniforms,
    patchMaterialWithDither,
} from '../render/dither-reveal'

function PlacedAsset({ placement, enableColliders }: { placement: MapdefPlacement; enableColliders: boolean }) {
    const entry = assetCatalog.find((a) => a.id === placement.componentId)
    if (!entry) return null
    return <PlacedGLB path={entry.path} placement={placement} enableColliders={enableColliders} />
}

function PlacedGLB({ path, placement, enableColliders }: { path: string; placement: MapdefPlacement; enableColliders: boolean }) {
    const { scene } = useGLTF(path)
    const cloned = useMemo(() => SkeletonUtils.clone(scene), [scene])

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
        const scaledWidth = boundingBox.size.x * s[0]
        const scaledHeight = boundingBox.size.y * s[1]
        const scaledDepth = boundingBox.size.z * s[2]
        return [
            scaledWidth * 0.3,
            scaledHeight * 0.3,
            scaledDepth * 0.3,
        ]
    }, [boundingBox, placement.scale])

    const colliderY = useMemo(() => {
        const s = placement.scale ?? [1, 1, 1]
        const modelBottomY = boundingBox.minY * s[1]
        const modelCenterY = boundingBox.center.y * s[1]
        return modelBottomY - modelCenterY
    }, [boundingBox, placement.scale])

    if (!enableColliders) {
        return (
            <group position={placement.position} rotation={placement.rotation}>
                <primitive object={cloned} scale={placement.scale ?? [1, 1, 1]} />
            </group>
        )
    }

    return (
        <RigidBody
            type="fixed"
            position={placement.position}
            rotation={placement.rotation}
            colliders={false}
            userData={{ name: 'placed-object', componentId: placement.componentId }}
        >
            <CuboidCollider
                ref={colliderRef}
                args={halfExtents}
                position={[0, colliderY, 0]}
                collisionGroups={interactionGroups([1], [0])}
            />
            <primitive
                object={cloned}
                scale={placement.scale ?? [1, 1, 1]}
            />
        </RigidBody>
    )
}

export default function MapPlacements() {
    const placements = useStore((s) => s.mapPlacements)
    const enableColliders = false

    if (!placements.length) return null

    return (
        <>
            {placements.map((p, i) => (
                <PlacedAsset key={`${p.componentId}-${i}`} placement={p} enableColliders={enableColliders} />
            ))}
        </>
    )
}
