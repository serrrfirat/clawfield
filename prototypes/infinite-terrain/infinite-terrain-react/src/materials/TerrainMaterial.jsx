import { useEffect, useMemo } from 'react'
import * as THREE from 'three'

import terrainVertexShader from '../shaders/terrain/vertex.glsl'
import terrainFragmentShader from '../shaders/terrain/fragment.glsl'
import useStore from '../stores/useStore.jsx'

export default function useTerrainMaterial({
    chunkSize,
    initialCircleRadius,
    noiseTexture,
}) {
    const terrainColor = useStore((s) => s.terrainParameters.color)
    const borderNoiseStrength = useStore((s) => s.borderParameters.noiseStrength)
    const borderNoiseScale = useStore((s) => s.borderParameters.noiseScale)
    const borderGrassFadeOffset = useStore((s) => s.borderParameters.grassFadeOffset)
    const borderGroundOffset = useStore((s) => s.borderParameters.groundOffset)
    const borderGroundFadeOffset = useStore((s) => s.borderParameters.groundFadeOffset)
    const pixelSize = useStore((s) => s.ditheringParameters.pixelSize)
    const ditherModeValue = useStore((s) => (s.ditheringParameters.ditherMode === 'Bayer' ? 1 : 0))

    const material = useMemo(() => {
        return new THREE.ShaderMaterial({
            uniforms: {
                uBaseColor: { value: new THREE.Color(terrainColor) },
                uCircleCenter: { value: new THREE.Vector3() },
                uTrailPatchSize: { value: chunkSize },
                uCircleRadiusFactor: { value: initialCircleRadius },
                uGrassFadeOffset: { value: borderGrassFadeOffset },
                uGroundOffset: { value: borderGroundOffset },
                uGroundFadeOffset: { value: borderGroundFadeOffset },
                uNoiseTexture: { value: noiseTexture },
                uNoiseStrength: { value: borderNoiseStrength },
                uNoiseScale: { value: borderNoiseScale },
                uPixelSize: { value: pixelSize },
                uDitherMode: { value: ditherModeValue }, // 0: Diamond, 1: Bayer
            },
            vertexShader: terrainVertexShader,
            fragmentShader: terrainFragmentShader,
        })
    }, [])

    useEffect(() => {
        const u = material.uniforms
        u.uBaseColor.value.set(terrainColor)
        u.uTrailPatchSize.value = chunkSize
        u.uGrassFadeOffset.value = borderGrassFadeOffset
        u.uGroundOffset.value = borderGroundOffset
        u.uGroundFadeOffset.value = borderGroundFadeOffset
        u.uNoiseTexture.value = noiseTexture
        u.uNoiseStrength.value = borderNoiseStrength
        u.uNoiseScale.value = borderNoiseScale
        u.uPixelSize.value = pixelSize
        u.uDitherMode.value = ditherModeValue
    }, [
        material,
        terrainColor,
        chunkSize,
        borderGrassFadeOffset,
        borderGroundOffset,
        borderGroundFadeOffset,
        noiseTexture,
        borderNoiseStrength,
        borderNoiseScale,
        pixelSize,
        ditherModeValue,
    ])

    useEffect(() => {
        return () => {
            material.dispose()
        }
    }, [material])

    return material
}
