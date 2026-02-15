import { useMemo, useEffect } from 'react'
import { RigidBody } from '@react-three/rapier'
import * as THREE from 'three'

import Grass from './Grass'
import Stones from './Stones'
import WindChunk from './WindChunk'
import useStore from '../stores/useStore'
import { generateChunkData } from './utils/chunkUtils'

export default function TerrainChunk({
    x,
    z,
    size,
    noise2D,
    noiseTexture,
    terrainMaterial,
    grassMaterial,
    stoneMaterial,
    stoneGeometry,
    windBaseGeometry,
    windMaterial,
    windLineParameters,
    windDirection,
    windEnabled,
    obstacleCollisionsEnabled = true,
    worldSeed = 1337,
    terrainScaleOverride,
    terrainAmplitudeOverride,
    heightDeltaSampler,
    roads,
    placements,
    destroyedTerrainDiscs = [],
}) {
    const terrainParameters = useStore((s) => s.terrainParameters)
    const stoneParameters = useStore((s) => s.stoneParameters)
    const terrainScale = terrainScaleOverride ?? terrainParameters.scale
    const terrainAmplitude = terrainAmplitudeOverride ?? terrainParameters.amplitude
    const terrainSegments = terrainParameters.segments

    const stonesKey = useMemo(
        () =>
            `stones_${x}_${z}_${stoneParameters.count}_${stoneParameters.minScale}_${stoneParameters.maxScale}_${stoneParameters.yOffset}_${stoneParameters.noiseScale}_${stoneParameters.noiseThreshold}`,
        [x, z, stoneParameters.count, stoneParameters.minScale, stoneParameters.maxScale, stoneParameters.yOffset, stoneParameters.noiseScale, stoneParameters.noiseThreshold]
    )

    const { stoneField } = useMemo(() => {
        return generateChunkData(x, z, size, noise2D, stoneParameters, { scale: terrainScale, amplitude: terrainAmplitude }, worldSeed)
    }, [x, z, size, noise2D, stoneParameters, terrainScale, terrainAmplitude, worldSeed])

    const visibleStones = useMemo(() => {
        if (!stoneField.currentStones?.length) return stoneField.currentStones
        if (!destroyedTerrainDiscs.length) return stoneField.currentStones

        const chunkWorldX = x * size
        const chunkWorldZ = z * size
        return stoneField.currentStones.filter((s) => {
            const wx = chunkWorldX + s.x
            const wz = chunkWorldZ + s.z
            return !destroyedTerrainDiscs.some((d) => {
                const r = Math.max(0.15, Number(d?.r ?? 0.8))
                const dx = wx - Number(d?.x ?? 0)
                const dz = wz - Number(d?.z ?? 0)
                return dx * dx + dz * dz <= (r * 0.65) * (r * 0.65)
            })
        })
    }, [stoneField.currentStones, destroyedTerrainDiscs, x, z, size])

    const geometry = useMemo(() => {
        const geo = new THREE.PlaneGeometry(size, size, terrainSegments, terrainSegments)
        const posAttribute = geo.attributes.position
        const chunkWorldX = x * size
        const chunkWorldZ = z * size

        for (let i = 0; i < posAttribute.count; i++) {
            const worldX = posAttribute.getX(i) + chunkWorldX
            const worldZ = -posAttribute.getY(i) + chunkWorldZ
            const base = noise2D(worldX * terrainScale, worldZ * terrainScale) * terrainAmplitude
            const delta = heightDeltaSampler ? heightDeltaSampler(worldX, worldZ) : 0
            posAttribute.setZ(i, base + delta)
        }
        return geo
    }, [noise2D, size, x, z, terrainScale, terrainAmplitude, terrainSegments, heightDeltaSampler])

    useEffect(() => () => geometry.dispose(), [geometry])

    return (
        <group position={[x * size, 0, z * size]}>
            {obstacleCollisionsEnabled ? (
                <RigidBody type="fixed" colliders="trimesh" userData={{ name: 'terrain' }}>
                    <mesh geometry={geometry} material={terrainMaterial} rotation-x={-Math.PI / 2} receiveShadow />
                </RigidBody>
            ) : (
                <mesh geometry={geometry} material={terrainMaterial} rotation-x={-Math.PI / 2} receiveShadow />
            )}

            <Grass
                size={size}
                chunkX={x * size}
                chunkZ={z * size}
                chunkIndexX={x}
                chunkIndexZ={z}
                noise2D={noise2D}
                scale={terrainScale}
                amplitude={terrainAmplitude}
                stones={stoneField.stones}
                roads={roads}
                placements={placements}
                grassMaterial={grassMaterial}
            />

            <Stones
                key={stonesKey}
                stones={visibleStones}
                maxCount={stoneField.capacity}
                stoneMaterial={stoneMaterial}
                stoneGeometry={stoneGeometry}
                chunkWorldX={x * size}
                chunkWorldZ={z * size}
                enableColliders={obstacleCollisionsEnabled}
            />

            {windEnabled && (
                <WindChunk
                    chunkX={x}
                    chunkZ={z}
                    size={size}
                    baseGeometry={windBaseGeometry}
                    windLineParameters={windLineParameters}
                    windDirection={windDirection}
                    terrainScale={terrainScale}
                    terrainAmplitude={terrainAmplitude}
                    material={windMaterial}
                />
            )}
        </group>
    )
}
