import { useEffect, useMemo, useRef } from 'react'
import { SoftShadows, useTexture } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import useStore from '../stores/useStore'
import noiseTextureUrl from '../assets/textures/noiseTexture.png'
import { getDayNightFactors, getFuzzySunPosition } from './dayNight'

const SUN_DAY_COLOR = new THREE.Color('#ffe58f')
const SUN_SUNSET_COLOR = new THREE.Color('#ff8a4f')
const SUN_NIGHT_COLOR = new THREE.Color('#5d66c3')
const AMBIENT_DAY_COLOR = new THREE.Color('#8ea36f')
const AMBIENT_NIGHT_COLOR = new THREE.Color('#33406f')
const HEMI_GROUND_DAY = new THREE.Color('#8d8552')
const HEMI_GROUND_NIGHT = new THREE.Color('#353257')
const FUZZY_WARM_DAY = new THREE.Color('#ffd76e')
const FUZZY_WARM_SUNSET = new THREE.Color('#ff9945')
const FUZZY_INDIGO = new THREE.Color('#4c4fa0')

export default function Lights() {
  const cloud = useStore((s: any) => s.cloudShadowParameters)
  const soft = useStore((s: any) => s.softShadowParameters)
  const dayNight = useStore((s: any) => s.dayNightParameters)

  const cookie = useTexture(noiseTextureUrl)
  const sunRef = useRef<THREE.DirectionalLight>(null)
  const ambientRef = useRef<THREE.AmbientLight>(null)
  const hemiRef = useRef<THREE.HemisphereLight>(null)
  const cloudSpotRef = useRef<THREE.SpotLight>(null)
  const sunTargetRef = useMemo(() => new THREE.Object3D(), [])

  useEffect(() => {
    cookie.wrapS = THREE.RepeatWrapping
    cookie.wrapT = THREE.RepeatWrapping
    cookie.repeat.set(cloud.scale, cloud.scale)
    cookie.needsUpdate = true
  }, [cookie, cloud.scale])

  useFrame(({ clock }, dt) => {
    cookie.offset.x = (cookie.offset.x + cloud.speedX * dt) % 1
    cookie.offset.y = (cookie.offset.y + cloud.speedY * dt) % 1

    const state = useStore.getState() as any
    const p = state.dayNightParameters

    let timeOfDay = p.timeOfDay
    if (p.enabled && p.autoCycle) {
      timeOfDay = (timeOfDay + dt * p.cycleSpeed) % 24
      useStore.setState({
        dayNightParameters: {
          ...p,
          timeOfDay,
        },
      })
    }

    const sunPos = p.enabled
      ? getFuzzySunPosition(timeOfDay, clock.elapsedTime, p.sunRadius)
      : new THREE.Vector3(45, 90, 28)
    const sunHeightNorm = p.enabled
      ? THREE.MathUtils.clamp(sunPos.y / Math.max(1, p.sunRadius), -1, 1)
      : 1
    const { dayFactor, sunsetFactor, nightFactor } = getDayNightFactors(sunHeightNorm, p.enabled)
    const cloudOcclusion =
      0.87 +
      0.08 * (0.5 + 0.5 * Math.sin(clock.elapsedTime * 0.19 + 0.6)) +
      0.05 * (0.5 + 0.5 * Math.sin(clock.elapsedTime * 0.07 + 1.4))

    const fuzzyWarmPulse = 0.5 + 0.5 * Math.sin(clock.elapsedTime * 0.11)
    const fuzzyCoolPulse = 0.5 + 0.5 * Math.sin(clock.elapsedTime * 0.08 + 2.2)

    const sunColor = SUN_DAY_COLOR.clone()
      .lerp(SUN_SUNSET_COLOR, sunsetFactor)
      .lerp(SUN_NIGHT_COLOR, nightFactor * 0.85)
      .lerp(FUZZY_WARM_DAY, dayFactor * 0.08 * fuzzyWarmPulse)
      .lerp(FUZZY_WARM_SUNSET, sunsetFactor * 0.16)
      .lerp(FUZZY_INDIGO, nightFactor * 0.16 * fuzzyCoolPulse)
    const ambientColor = AMBIENT_DAY_COLOR.clone().lerp(AMBIENT_NIGHT_COLOR, nightFactor)

    if (sunRef.current) {
      sunRef.current.position.copy(sunPos)
      sunTargetRef.position.set(0, 0, 0)
      sunRef.current.target = sunTargetRef
      const targetSunIntensity = THREE.MathUtils.lerp(0.18, 3.8, dayFactor) * cloudOcclusion
      sunRef.current.intensity = THREE.MathUtils.lerp(sunRef.current.intensity, targetSunIntensity, 0.08)
      sunRef.current.color.lerp(sunColor, 0.08)
    }

    if (ambientRef.current) {
      const targetAmbient = THREE.MathUtils.lerp(0.2, 0.95, dayFactor)
      ambientRef.current.intensity = THREE.MathUtils.lerp(ambientRef.current.intensity, targetAmbient, 0.06)
      ambientRef.current.color.lerp(ambientColor, 0.08)
    }

    if (hemiRef.current) {
      const targetHemiIntensity = THREE.MathUtils.lerp(0.08, 0.35, dayFactor)
      hemiRef.current.intensity = THREE.MathUtils.lerp(hemiRef.current.intensity, targetHemiIntensity, 0.06)
      hemiRef.current.color.lerp(sunColor, 0.08)
      const ground = HEMI_GROUND_DAY.clone().lerp(HEMI_GROUND_NIGHT, nightFactor)
      hemiRef.current.groundColor.lerp(ground, 0.08)
    }

    if (cloudSpotRef.current) {
      cloudSpotRef.current.intensity = cloud.enabled ? cloud.spotlightIntensity * cloud.intensity * dayFactor : 0
    }
  })

  return (
    <>
      {soft.enabled && (
        <SoftShadows size={soft.size} samples={Math.max(1, Math.floor(soft.samples))} focus={soft.focus} />
      )}

      <primitive object={sunTargetRef} position={[0, 0, 0]} />

      <directionalLight
        ref={sunRef}
        position={[45, 90, 28]}
        intensity={3.8}
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

      <spotLight
        ref={cloudSpotRef}
        position={[0, 140, 0]}
        target-position={[0, 0, 0]}
        intensity={cloud.enabled ? cloud.spotlightIntensity * cloud.intensity : 0}
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

      <ambientLight ref={ambientRef} intensity={0.95} color="#9a968b" />
      <hemisphereLight ref={hemiRef} color="#fff3d9" groundColor="#a38a66" intensity={0.35} />
    </>
  )
}
