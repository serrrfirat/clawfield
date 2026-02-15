import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { InstancedRigidBodies } from '@react-three/rapier'
import { placementDestructionView } from './placement-destruction-view'
import useStore from '../stores/useStore'

export default function Stones({ stones, maxCount, stoneMaterial, stoneGeometry, chunkWorldX = 0, chunkWorldZ = 0, enableColliders = true }) {
    const obstacleDiscs = useStore((s: any) => s.obstacleDiscs ?? [])

    const stoneShadowDepthMaterial = useMemo(
        () =>
            new THREE.MeshDepthMaterial({
                depthPacking: THREE.RGBADepthPacking,
                side: THREE.DoubleSide,
            }),
        [],
    )

    const terrainObstacles = useMemo(
        () => (obstacleDiscs as any[]).filter((o) => typeof o?.id === 'string' && o.id.startsWith('terrain-')),
        [obstacleDiscs],
    )

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
        const available = [...terrainObstacles]
        return stones.map((stone, i) => {
            const worldX = chunkWorldX + stone.x
            const worldZ = chunkWorldZ + stone.z
            let matchedTerrainId: string | null = null
            let matchedIndex = -1
            let bestDistSq = Infinity

            for (let oi = 0; oi < available.length; oi++) {
                const obstacle: any = available[oi]
                const ox = Number(obstacle?.x ?? 0)
                const oz = Number(obstacle?.z ?? 0)
                const dx = worldX - ox
                const dz = worldZ - oz
                const distSq = dx * dx + dz * dz
                const maxDist = Math.max(1.1, Number(obstacle?.r ?? 0.9) * 1.35, Math.max(stone.scaleX, stone.scaleZ) * 1.45)
                if (distSq > maxDist * maxDist) continue
                if (distSq < bestDistSq) {
                    bestDistSq = distSq
                    matchedTerrainId = obstacle.id
                    matchedIndex = oi
                }
            }

            if (matchedIndex >= 0) available.splice(matchedIndex, 1)

            const root = new THREE.Group()
            const mesh = new THREE.Mesh(stoneGeometry, stoneMaterial)
            mesh.castShadow = true
            mesh.receiveShadow = true
            mesh.position.set(0, 0, 0)
            mesh.rotation.set(stone.rotX || 0, stone.rotY || 0, stone.rotZ || 0)
            mesh.scale.set(stone.scaleX, stone.scaleY, stone.scaleZ)
            root.add(mesh)
            root.position.set(worldX, stone.y, worldZ)
            root.updateMatrixWorld(true)

            return {
                id: matchedTerrainId ?? `stone-${chunkWorldX}-${chunkWorldZ}-${i}`,
                object: root as THREE.Object3D,
                radius: Math.max(0.25, Math.max(stone.scaleX, stone.scaleZ) * 1.05),
                groundY: stone.y - Math.max(0.2, stone.scaleY * 0.35),
            }
        })
    }, [stones, stoneGeometry, stoneMaterial, chunkWorldX, chunkWorldZ, terrainObstacles])

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

    useEffect(() => {
        return () => {
            stoneShadowDepthMaterial.dispose()
        }
    }, [stoneShadowDepthMaterial])

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
                customDepthMaterial={stoneShadowDepthMaterial}
            />
        </InstancedRigidBodies>
    )
}
