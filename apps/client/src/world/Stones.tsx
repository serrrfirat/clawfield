import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { InstancedRigidBodies } from '@react-three/rapier'
import { placementDestructionView } from './placement-destruction-view'

export default function Stones({ stones, maxCount, stoneMaterial, stoneGeometry, chunkWorldX = 0, chunkWorldZ = 0, enableColliders = true }) {
    const instances = useMemo(() => {
        if (!stones) return []
        return stones.map((stone, i) => ({
            key: 'stone_' + i,
            position: [stone.x, stone.y, stone.z],
            rotation: [stone.rotX || 0, stone.rotY, stone.rotZ || 0],
            scale: [stone.scaleX, stone.scaleY, stone.scaleZ],
        }))
    }, [stones])

    const destructionEntries = useMemo(() => {
        if (!stones) return []
        return stones.map((stone, i) => {
            const root = new THREE.Group()
            const mesh = new THREE.Mesh(stoneGeometry, stoneMaterial)
            mesh.castShadow = true
            mesh.receiveShadow = true
            mesh.position.set(0, 0, 0)
            mesh.rotation.set(stone.rotX || 0, stone.rotY || 0, stone.rotZ || 0)
            mesh.scale.set(stone.scaleX, stone.scaleY, stone.scaleZ)
            root.add(mesh)
            root.position.set(chunkWorldX + stone.x, stone.y, chunkWorldZ + stone.z)
            root.updateMatrixWorld(true)

            return {
                id: `stone-${chunkWorldX}-${chunkWorldZ}-${i}`,
                object: root as THREE.Object3D,
                radius: Math.max(0.25, Math.max(stone.scaleX, stone.scaleZ) * 1.05),
                groundY: stone.y - Math.max(0.2, stone.scaleY * 0.35),
            }
        })
    }, [stones, stoneGeometry, stoneMaterial, chunkWorldX, chunkWorldZ])

    useEffect(() => {
        for (const entry of destructionEntries) {
            placementDestructionView.registerPlacement(entry.id, entry.object, entry.radius, {
                groundY: entry.groundY,
            })
        }
        return () => {
            for (const entry of destructionEntries) {
                placementDestructionView.unregisterPlacement(entry.id)
            }
        }
    }, [destructionEntries])

    if (!instances || instances.length === 0) {
        return null
    }

    return (
        <InstancedRigidBodies instances={instances} type="fixed" colliders={enableColliders ? 'hull' : false}>
            <instancedMesh
                args={[stoneGeometry, stoneMaterial, maxCount]}
                count={instances.length}
                frustumCulled={false}
                castShadow
                receiveShadow
            />
        </InstancedRigidBodies>
    )
}
