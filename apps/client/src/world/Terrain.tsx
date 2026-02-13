import { useState, useRef, useMemo, useEffect } from 'react'
import { useFrame } from '@react-three/fiber'
import { useTexture } from '@react-three/drei'
import { gsap } from 'gsap'
import * as THREE from 'three'

import TerrainChunk from './TerrainChunk'
import Trees from './Trees'
import Foliage from './Foliage'
import useTerrainMaterial from '../materials/TerrainMaterial'
import useGrassMaterial from '../materials/GrassMaterial'
import useStonesMaterial from '../materials/StonesMaterial'
import useTreeMaterial from '../materials/TreeMaterial'
import useWindMaterial from '../materials/WindMaterial'
import useStore from '../stores/useStore'
import usePhases, { PHASES } from '../stores/usePhases'
import { DEFAULT_HEIGHTMAP_CONFIG } from '@clawfield/shared'

import noiseTextureUrl from '../assets/textures/noiseTexture.png'
import alphaLeavesUrl from '../assets/textures/alpha_leaves.png'
import { createSeededNoise2D } from './utils/worldNoise'

const START_CIRCLE_RADIUS = 0.07
const START_RADIUS_DELAY = 1.1

interface TerrainProps {
    uniformsRef?: React.MutableRefObject<{
        treeMaterialUniforms?: Record<string, { value: any }>
        noiseTexture?: THREE.Texture
    }>
}

export default function Terrain({ uniformsRef }: TerrainProps) {
    const [activeChunks, setActiveChunks] = useState([])

    const currentChunk = useRef({ x: 0, z: 0 })
    const radiusAnimationRef = useRef(null)
    const prevPhaseRef = useRef(PHASES.loading)
    const circleRadiusRef = useRef(START_CIRCLE_RADIUS)

    const phase = usePhases((s) => s.phase)

    const chunkSize = useStore((s) => s.terrainParameters.chunkSize)
    const terrainScale = useStore((s) => s.terrainParameters.scale)
    const terrainAmplitude = useStore((s) => s.terrainParameters.amplitude)
    const matchConfig = useStore((s: any) => s.matchConfig)
    const borderCircleRadius = useStore((s) => s.borderParameters.circleRadiusFactor)
    const windParameters = useStore((s) => s.windParameters)
    const windLineParameters = useStore((s) => s.windLineParameters)
    const windLineWidth = windLineParameters.width
    const windDirection = windParameters.direction
    const stoneParameters = useStore((s) => s.stoneParameters)
    const treesEnabled = useStore((s) => s.generalParameters.trees)
    const foliageEnabled = useStore((s) => s.generalParameters.foliage)
    const windEnabled = useStore((s) => s.generalParameters.wind)
    const obstacleCollisionsEnabled = false

    const worldSeed = matchConfig?.seed ?? DEFAULT_HEIGHTMAP_CONFIG.seed
    const effectiveTerrainScale = matchConfig?.terrain?.scale ?? terrainScale
    const effectiveTerrainAmplitude = matchConfig?.terrain?.amplitude ?? terrainAmplitude
    const noise2D = useMemo(() => createSeededNoise2D(worldSeed), [worldSeed])

    // Textures
    const noiseTexture = useTexture(
        noiseTextureUrl,
        (texture) => {
            texture.wrapS = THREE.RepeatWrapping
            texture.wrapT = THREE.RepeatWrapping
            texture.minFilter = THREE.LinearFilter
            texture.magFilter = THREE.LinearFilter
            return texture
        },
        [noiseTextureUrl]
    )
    const alphaMap = useTexture(alphaLeavesUrl)

    const terrainMaterial = useTerrainMaterial({
        chunkSize,
        initialCircleRadius: START_CIRCLE_RADIUS,
        noiseTexture,
    })

    const grassMaterial = useGrassMaterial({
        chunkSize,
        initialCircleRadius: START_CIRCLE_RADIUS,
        noiseTexture,
    })

    const stoneMaterial = useStonesMaterial({
        chunkSize,
        initialCircleRadius: START_CIRCLE_RADIUS,
        noiseTexture,
    })

    // Shared stone geometry
    const stoneGeometry = useMemo(() => {
        return new THREE.IcosahedronGeometry(1, 0)
    }, [])

    const treeMaterial = useTreeMaterial({
        chunkSize,
        initialCircleRadius: START_CIRCLE_RADIUS,
        noiseTexture,
        alphaMap,
    })

    useEffect(() => {
        if (uniformsRef && treeMaterial.uniforms) {
            uniformsRef.current.treeMaterialUniforms = treeMaterial.uniforms
            uniformsRef.current.noiseTexture = noiseTexture
        }
    }, [uniformsRef, treeMaterial.uniforms, noiseTexture])

    const windMaterial = useWindMaterial({
        chunkSize,
        initialCircleRadius: START_CIRCLE_RADIUS,
        noiseTexture,
    })

    const windBaseGeometry = useMemo(() => {
        const geometry = new THREE.PlaneGeometry(10, windLineWidth, 20, 1)
        return geometry
    }, [windLineWidth])

    useEffect(() => {
        return () => {
            windBaseGeometry.dispose()
        }
    }, [windBaseGeometry])

    const rigidBodyMaterial = useMemo(() => {
        const mat = new THREE.MeshBasicMaterial({ color: 0xffffff })
        mat.visible = false
        return mat
    }, [])

    const setCircleRadius = (value) => {
        circleRadiusRef.current = value
        terrainMaterial.uniforms.uCircleRadiusFactor.value = value
        grassMaterial.uniforms.uCircleRadiusFactor.value = value
        stoneMaterial.uniforms.uCircleRadiusFactor.value = value
        if (treeMaterial.uniforms?.uCircleRadiusFactor) {
            treeMaterial.uniforms.uCircleRadiusFactor.value = value
        }
        windMaterial.uniforms.uCircleRadiusFactor.value = value
    }

    useEffect(() => {
        return () => {
            if (radiusAnimationRef.current) {
                radiusAnimationRef.current.kill()
                radiusAnimationRef.current = null
            }
            stoneGeometry.dispose()
            rigidBodyMaterial.dispose()
            noiseTexture.dispose()
            alphaMap.dispose()
        }
    }, [stoneGeometry, rigidBodyMaterial, noiseTexture, alphaMap])

    useEffect(() => {
        const wasStarted = prevPhaseRef.current === PHASES.start

        if (phase === PHASES.start) {
            if (!wasStarted) {
                const targetRadius = borderCircleRadius
                const startRadius = START_CIRCLE_RADIUS

                if (radiusAnimationRef.current) {
                    radiusAnimationRef.current.kill()
                    radiusAnimationRef.current = null
                }

                setCircleRadius(startRadius)

                const radiusObj = { value: startRadius }
                radiusAnimationRef.current = gsap.to(radiusObj, {
                    value: targetRadius,
                    duration: 2.0,
                    delay: START_RADIUS_DELAY,
                    ease: 'power2.out',
                    onUpdate: () => {
                        setCircleRadius(radiusObj.value)
                    },
                    onComplete: () => {
                        radiusAnimationRef.current = null
                    },
                })
            } else if (!radiusAnimationRef.current) {
                setCircleRadius(borderCircleRadius)
            }
        } else if (!radiusAnimationRef.current) {
            setCircleRadius(START_CIRCLE_RADIUS)
        }

        prevPhaseRef.current = phase
    }, [phase, borderCircleRadius])

    useFrame(({ clock }) => {
        const state = useStore.getState()
        // Update terrain material uniforms
        terrainMaterial.uniforms.uCircleCenter.value.copy(state.smoothedCircleCenter)

        // Update grass material uniforms
        grassMaterial.uniforms.uTime.value = clock.elapsedTime
        grassMaterial.uniforms.uTrailTexture.value = state.trailTexture
        grassMaterial.uniforms.uBallPosition.value.copy(state.ballPosition)
        grassMaterial.uniforms.uCircleCenter.value.copy(state.smoothedCircleCenter)

        // Update stones uniforms (no rerenders required)
        stoneMaterial.uniforms.uCircleCenter.value.copy(state.smoothedCircleCenter)

        // Update tree material uniforms
        if (treesEnabled && treeMaterial.uniforms) {
            treeMaterial.uniforms.uTime.value = clock.elapsedTime
            treeMaterial.uniforms.uCircleCenter.value.copy(state.smoothedCircleCenter)
            treeMaterial.uniforms.uBallPosition.value.copy(state.ballPosition)
        }

        // Update wind uniforms
        windMaterial.uniforms.uTime.value = clock.elapsedTime
        windMaterial.uniforms.uCircleCenter.value.copy(state.smoothedCircleCenter)

        // Chunk management
        const ballPosition = state.ballPosition
        const safeChunkSize = Math.max(0.0001, chunkSize)
        const chunkX = Math.round(ballPosition.x / safeChunkSize)
        const chunkZ = Math.round(ballPosition.z / safeChunkSize)

        if (chunkX !== currentChunk.current.x || chunkZ !== currentChunk.current.z || currentChunk.current.size !== safeChunkSize || activeChunks.length === 0) {
            currentChunk.current = { x: chunkX, z: chunkZ, size: safeChunkSize }

            const newChunks = []
            for (let x = -1; x <= 1; x++) {
                for (let z = -1; z <= 1; z++) {
                    newChunks.push({
                        x: chunkX + x,
                        z: chunkZ + z,
                        key: `${chunkX + x},${chunkZ + z}`,
                    })
                }
            }
            setActiveChunks(newChunks)
        }
    })

    return (
        <group>
            {activeChunks.map((chunk) => (
                <TerrainChunk
                    key={chunk.key}
                    x={chunk.x}
                    z={chunk.z}
                    size={chunkSize}
                    noise2D={noise2D}
                    noiseTexture={noiseTexture}
                    terrainMaterial={terrainMaterial}
                    grassMaterial={grassMaterial}
                    stoneMaterial={stoneMaterial}
                    stoneGeometry={stoneGeometry}
                    windBaseGeometry={windBaseGeometry}
                    windMaterial={windMaterial}
                    windLineParameters={windLineParameters}
                    windDirection={windDirection}
                    windEnabled={windEnabled}
                    obstacleCollisionsEnabled={obstacleCollisionsEnabled}
                    worldSeed={worldSeed}
                    terrainScaleOverride={effectiveTerrainScale}
                    terrainAmplitudeOverride={effectiveTerrainAmplitude}
                />
            ))}
            {treesEnabled && (
                <>
                    <Trees
                        activeChunks={activeChunks}
                        chunkSize={chunkSize}
                        noise2D={noise2D}
                        stoneParameters={stoneParameters}
                        terrainScale={effectiveTerrainScale}
                        terrainAmplitude={effectiveTerrainAmplitude}
                        worldSeed={worldSeed}
                        treeMaterial={treeMaterial}
                        rigidBodyMaterial={rigidBodyMaterial}
                        enableColliders={obstacleCollisionsEnabled}
                    />
                    {foliageEnabled && (
                        <Foliage
                            activeChunks={activeChunks}
                            chunkSize={chunkSize}
                            noise2D={noise2D}
                            stoneParameters={stoneParameters}
                            terrainScale={terrainScale}
                            terrainAmplitude={terrainAmplitude}
                            treeMaterialUniforms={treeMaterial.uniforms}
                            noiseTexture={noiseTexture}
                        />
                    )}
                </>
            )}
        </group>
    )
}
