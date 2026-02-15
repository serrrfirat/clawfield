import { useRef } from 'react'
import * as THREE from 'three'
import { Bloom, BrightnessContrast, EffectComposer, GodRays, HueSaturation } from '@react-three/postprocessing'
import { useFrame } from '@react-three/fiber'
import useStore from '../stores/useStore'
import { getDayNightFactors, getFuzzySunPosition, getTimeOfDayTintFactors } from './dayNight'

export default function PostProcessing() {
  const post = useStore((s) => s.postProcessingParameters)
  const dayNight = useStore((s) => s.dayNightParameters)
  const temporaryExplosionBloomSuppression = useStore((s: any) => Number(s.temporaryExplosionBloomSuppression ?? 0))
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
  const { dayFactor } = getDayNightFactors(sunHeightNorm, true)
  const explosionSuppression = THREE.MathUtils.clamp(temporaryExplosionBloomSuppression, 0, 1)
  const raysWeight = post.godRaysWeight * dayFactor
  const raysExposure = post.godRaysExposure * THREE.MathUtils.lerp(0.35, 1, dayFactor)
  const tintStrength = post.screenTintStrength ?? 1
    const { morningOrange, middayYellow, afternoonOrangePurple, nightIndigo } = getTimeOfDayTintFactors(dayNight.timeOfDay)

    const hue = (morningOrange * 0.018 + middayYellow * 0.01 + afternoonOrangePurple * 0.038 - nightIndigo * 0.085) * tintStrength
    const saturation = (morningOrange * 0.055 + middayYellow * 0.024 + afternoonOrangePurple * 0.082 - nightIndigo * 0.115) * tintStrength
    const brightness = (morningOrange * 0.028 + middayYellow * 0.02 + afternoonOrangePurple * 0.008 - nightIndigo * 0.1) * tintStrength
    const contrast = (middayYellow * 0.015 + afternoonOrangePurple * 0.05 + nightIndigo * 0.14) * tintStrength

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
                    intensity={post.bloomIntensity * (1 - explosionSuppression * 0.95)}
                    luminanceThreshold={THREE.MathUtils.lerp(1, post.bloomThreshold, 1 - explosionSuppression)}
                    luminanceSmoothing={post.bloomSmoothing}
                    height={Math.max(64, Math.floor(post.bloomHeight))}
                    mipmapBlur
                />
                <HueSaturation hue={hue} saturation={saturation} />
                <BrightnessContrast brightness={brightness - explosionSuppression * 0.08} contrast={contrast} />
            </EffectComposer>
        </>
    )
}
