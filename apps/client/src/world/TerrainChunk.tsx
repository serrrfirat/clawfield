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
                    <mesh geometry={geometry} material={terrainMaterial} rotation-x={-Math.PI / 2} />
                </RigidBody>
            ) : (
                <mesh geometry={geometry} material={terrainMaterial} rotation-x={-Math.PI / 2} />
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
                grassMaterial={grassMaterial}
            />

            <Stones
                key={stonesKey}
                stones={stoneField.currentStones}
                maxCount={stoneField.capacity}
                stoneMaterial={stoneMaterial}
                stoneGeometry={stoneGeometry}
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
