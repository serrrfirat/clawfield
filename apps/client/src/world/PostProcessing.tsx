import { useRef } from 'react'
import * as THREE from 'three'
import { Bloom, EffectComposer, GodRays } from '@react-three/postprocessing'
import useStore from '../stores/useStore'

export default function PostProcessing() {
    const post = useStore((s) => s.postProcessingParameters)
    const sunRef = useRef<THREE.Mesh>(null)

    if (!post?.enabled) return null

    return (
        <>
            <mesh ref={sunRef} position={[72, 120, 18]}>
                <sphereGeometry args={[10, 32, 32]} />
                <meshBasicMaterial color="#fff4cf" toneMapped={false} />
            </mesh>
            <EffectComposer multisampling={0}>
                <GodRays
                    sun={sunRef}
                    density={post.godRaysDensity}
                    weight={post.godRaysWeight}
                    decay={post.godRaysDecay}
                    exposure={post.godRaysExposure}
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
            </EffectComposer>
        </>
    )
}
