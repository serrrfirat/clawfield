import { useEffect, useRef } from 'react'
import { SoftShadows, useTexture } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import useStore from '../stores/useStore'
import noiseTextureUrl from '../assets/textures/noiseTexture.png'

export default function Lights() {
    const cloud = useStore((s) => s.cloudShadowParameters)
    const soft = useStore((s) => s.softShadowParameters)
    const cookie = useTexture(noiseTextureUrl)
    const cloudSpotRef = useRef<THREE.SpotLight>(null)

    useEffect(() => {
        cookie.wrapS = THREE.RepeatWrapping
        cookie.wrapT = THREE.RepeatWrapping
        cookie.repeat.set(cloud.scale, cloud.scale)
        cookie.needsUpdate = true
    }, [cookie, cloud.scale])

    useFrame((_, dt) => {
        cookie.offset.x = (cookie.offset.x + cloud.speedX * dt) % 1
        cookie.offset.y = (cookie.offset.y + cloud.speedY * dt) % 1
    })

    return (
        <>
            {soft.enabled && (
                <SoftShadows
                    size={soft.size}
                    samples={Math.max(1, Math.floor(soft.samples))}
                    focus={soft.focus}
                />
            )}
            <directionalLight
                position={[45, 90, 28]}
                intensity={4.2}
                castShadow
                shadow-mapSize-width={2048}
                shadow-mapSize-height={2048}
                shadow-camera-near={1}
                shadow-camera-far={260}
                shadow-camera-left={-120}
                shadow-camera-right={120}
                shadow-camera-top={120}
                shadow-camera-bottom={-120}
                shadow-bias={-0.00008}
            />
            {cloud.enabled && (
                <spotLight
                    ref={cloudSpotRef}
                    position={[0, 140, 0]}
                    target-position={[0, 0, 0]}
                    intensity={cloud.spotlightIntensity * cloud.intensity}
                    distance={cloud.spotlightDistance}
                    angle={cloud.spotlightAngle}
                    penumbra={cloud.spotlightPenumbra}
                    color="#ffffff"
                    map={cookie}
                    castShadow
                    shadow-mapSize-width={1024}
                    shadow-mapSize-height={1024}
                    shadow-bias={-0.00005}
                />
            )}
            <ambientLight intensity={3.2} />
            <hemisphereLight color="#fff3d9" groundColor="#b3a77f" intensity={0.45} />
        </>
    )
}
