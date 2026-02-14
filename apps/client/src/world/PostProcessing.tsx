import { useRef } from 'react'
import * as THREE from 'three'
import { Bloom, BrightnessContrast, EffectComposer, GodRays, HueSaturation } from '@react-three/postprocessing'
import { useFrame } from '@react-three/fiber'
import useStore from '../stores/useStore'
import { getDayNightFactors, getFuzzySunPosition } from './dayNight'

export default function PostProcessing() {
    const post = useStore((s) => s.postProcessingParameters)
    const dayNight = useStore((s) => s.dayNightParameters)
    const sunRef = useRef<THREE.Mesh>(null)

    useFrame(({ clock }) => {
        if (!sunRef.current) return
        const state = useStore.getState()
        const p = state.dayNightParameters
        const sunPos = getFuzzySunPosition(p.timeOfDay, clock.elapsedTime, p.sunRadius)
        sunRef.current.position.copy(sunPos)
        sunRef.current.visible = !p.enabled || sunPos.y > 0
    })

    if (!post?.enabled) return null

    const sunPos = getFuzzySunPosition(dayNight.timeOfDay, 0, dayNight.sunRadius)
    const sunHeightNorm = THREE.MathUtils.clamp(sunPos.y / Math.max(1, dayNight.sunRadius), -1, 1)
    const { dayFactor, sunsetFactor, nightFactor } = getDayNightFactors(sunHeightNorm, dayNight.enabled)
    const raysWeight = post.godRaysWeight * dayFactor
    const raysExposure = post.godRaysExposure * THREE.MathUtils.lerp(0.35, 1, dayFactor)
    const tintStrength = post.screenTintStrength ?? 1
    const morningFactor = dayNight.enabled
        ? THREE.MathUtils.clamp(1 - Math.abs(dayNight.timeOfDay - 7.4) / 2.6, 0, 1) * dayFactor
        : 0
    const hue = (morningFactor * 0.015 + sunsetFactor * 0.02 - nightFactor * 0.06) * tintStrength
    const saturation = (-0.01 + morningFactor * 0.03 + sunsetFactor * 0.06 - nightFactor * 0.08) * tintStrength
    const brightness = (morningFactor * 0.01 + sunsetFactor * 0.015 - nightFactor * 0.08) * tintStrength
    const contrast = (sunsetFactor * 0.04 + nightFactor * 0.09) * tintStrength

    return (
        <>
            <mesh ref={sunRef} position={[sunPos.x, sunPos.y, sunPos.z]}>
                <sphereGeometry args={[10, 32, 32]} />
                <meshBasicMaterial color="#fff4cf" toneMapped={false} />
            </mesh>
            <EffectComposer multisampling={0}>
                <GodRays
                    sun={sunRef}
                    density={post.godRaysDensity}
                    weight={raysWeight}
                    decay={post.godRaysDecay}
                    exposure={raysExposure}
                    samples={Math.max(16, Math.floor(post.godRaysSamples))}
                    clampMax={post.godRaysClampMax}
                    blur
                />
                <Bloom
                    intensity={post.bloomIntensity}
                    luminanceThreshold={post.bloomThreshold}
                    luminanceSmoothing={post.bloomSmoothing}
                    height={Math.max(64, Math.floor(post.bloomHeight))}
                    mipmapBlur
                />
                <HueSaturation hue={hue} saturation={saturation} />
                <BrightnessContrast brightness={brightness} contrast={contrast} />
            </EffectComposer>
        </>
    )
}
