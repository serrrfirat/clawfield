import * as THREE from "three"
import { useEffect, useMemo, useRef } from "react"
import { useGLTF } from "@react-three/drei"
import { useFrame } from "@react-three/fiber"
import { useControls } from "leva"
import CustomShaderMaterial from "three-custom-shader-material"

import { useStore } from "../../hooks/useStore"

import vertexShader from "./shaders/vertex.glsl"
import fragmentShader from "./shaders/fragment.glsl"

export function Rocks() {
  // Global states
  const waterLevel = useStore((state) => state.waterLevel)
  const waveSpeed = useStore((state) => state.waveSpeed)
  const waveAmplitude = useStore((state) => state.waveAmplitude)
  const foamDepth = useStore((state) => state.foamDepth)

  // Load model
  const { nodes } = useGLTF("/models/rocks.glb")

  // Interactive color parameters
  const { ROCK_BASE_COLOR, MOSS_BASE_COLOR } = useControls("Rocks", {
    ROCK_BASE_COLOR: { value: "#b2baa0", label: "Color" },
    MOSS_BASE_COLOR: { value: "#8aa72d", label: "Moss" }
  })

  // Convert color hex values to Three.js Color objects
  const MOSS_COLOR = useMemo(
    () => new THREE.Color(MOSS_BASE_COLOR),
    [MOSS_BASE_COLOR]
  )

  // Material
  const materialRef = useRef()

  // Update shader uniforms whenever control values change
  useEffect(() => {
    if (!materialRef.current) return

    materialRef.current.uniforms.uMossColor.value = MOSS_COLOR
    materialRef.current.uniforms.uWaterLevel.value = waterLevel
    materialRef.current.uniforms.uWaveSpeed.value = waveSpeed
    materialRef.current.uniforms.uWaveAmplitude.value = waveAmplitude
    materialRef.current.uniforms.uFoamDepth.value = foamDepth
  }, [MOSS_COLOR, waterLevel, waveSpeed, waveAmplitude, foamDepth])

  // Update shader time
  useFrame(({ clock }) => {
    if (!materialRef.current) return
    materialRef.current.uniforms.uTime.value = clock.getElapsedTime()
  })

  return (
    <group rotation-y={Math.PI * 0.5} position={[8, 0.5, -5]} dispose={null}>
      <mesh geometry={nodes.rocks.geometry} castShadow>
        <CustomShaderMaterial
          ref={materialRef}
          baseMaterial={THREE.MeshStandardMaterial}
          color={ROCK_BASE_COLOR}
          vertexShader={vertexShader}
          fragmentShader={fragmentShader}
          uniforms={{
            uTime: { value: 0 },
            uMossColor: { value: MOSS_COLOR },
            uWaterLevel: { value: waterLevel },
            uWaveSpeed: { value: waveSpeed },
            uFoamDepth: { value: foamDepth },
            uWaveAmplitude: { value: waveAmplitude }
          }}
        />
      </mesh>
    </group>
  )
}

useGLTF.preload("/models/rocks.glb")
