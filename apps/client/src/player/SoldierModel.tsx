import { useRef, useEffect, useMemo, forwardRef, useImperativeHandle } from 'react'
import { useFrame } from '@react-three/fiber'
import { useGLTF, useAnimations, useTexture } from '@react-three/drei'
import { SkeletonUtils } from 'three-stdlib'
import * as THREE from 'three'
import { AnimState, CROSSFADE_DURATIONS, DEFAULT_CROSSFADE } from './animation-state'
import useStore from '../stores/useStore'
import noiseTextureUrl from '../assets/textures/noiseTexture.png'
import {
  createDitherUniforms,
  patchMaterialWithDither,
  updateDitherUniforms,
} from '../render/dither-reveal'

const MODEL_PATH = '/models/soldier-animated.glb'
const TEXTURE_PATH = '/models/soldier-base-color.png'

export interface SoldierModelHandle {
  /** Set the current animation state imperatively (avoids React re-renders) */
  setAnimState: (state: AnimState) => void
}

interface SoldierModelProps {
  /** Initial animation state */
  initialAnimState?: AnimState
  teamColor?: number
}

const SoldierModel = forwardRef<SoldierModelHandle, SoldierModelProps>(
  function SoldierModel({ initialAnimState = AnimState.Idle, teamColor }, ref) {
    const { scene, animations } = useGLTF(MODEL_PATH)
    const baseColorTex = useTexture(TEXTURE_PATH)
    const noiseTexture = useTexture(noiseTextureUrl)
    const groupRef = useRef<THREE.Group>(null!)
    const currentAnimRef = useRef<AnimState>(initialAnimState)
    const activeAnimRef = useRef<AnimState | null>(null)

    const chunkSize = useStore((s) => s.terrainParameters.chunkSize)
    const borderParams = useStore((s) => s.borderParameters)
    const ditheringParams = useStore((s) => s.ditheringParameters)

    const ditherUniforms = useMemo(
      () =>
        createDitherUniforms({
          circleCenter: useStore.getState().smoothedCircleCenter,
          chunkSize,
          radiusFactor: borderParams.circleRadiusFactor,
          fadeOffset: borderParams.grassFadeOffset,
          borderMult: borderParams.borderTreesMultiplier,
          pixelSize: ditheringParams.pixelSize,
          ditherModeVal: ditheringParams.ditherMode === 'Bayer' ? 1 : 0,
          noiseTex: noiseTexture,
          noiseStr: borderParams.noiseStrength,
          noiseScl: borderParams.noiseScale,
        }),
      [],
    )

    // Clone scene per instance so each player has its own skeleton
    const cloned = useMemo(() => SkeletonUtils.clone(scene), [scene])

    // Apply base color texture to all meshes
    useEffect(() => {
      baseColorTex.flipY = false
      baseColorTex.colorSpace = THREE.SRGBColorSpace
      noiseTexture.wrapS = THREE.RepeatWrapping
      noiseTexture.wrapT = THREE.RepeatWrapping
      noiseTexture.minFilter = THREE.LinearFilter
      noiseTexture.magFilter = THREE.LinearFilter

      cloned.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) {
          const mesh = child as THREE.Mesh
          const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
          const patched = mats.map((m) => {
            if (!(m as THREE.MeshStandardMaterial).isMeshStandardMaterial) return m
            const mat = (m as THREE.MeshStandardMaterial).clone()
            mat.map = baseColorTex
            patchMaterialWithDither(mat, ditherUniforms, 'soldier-dither-v1')
            return mat
          })
          mesh.material = Array.isArray(mesh.material) ? patched : patched[0]
        }
      })
    }, [cloned, baseColorTex, noiseTexture, ditherUniforms])

    useEffect(() => {
      updateDitherUniforms(ditherUniforms, {
        circleCenter: useStore.getState().smoothedCircleCenter,
        chunkSize,
        radiusFactor: borderParams.circleRadiusFactor,
        fadeOffset: borderParams.grassFadeOffset,
        borderMult: borderParams.borderTreesMultiplier,
        pixelSize: ditheringParams.pixelSize,
        ditherModeVal: ditheringParams.ditherMode === 'Bayer' ? 1 : 0,
        noiseTex: noiseTexture,
        noiseStr: borderParams.noiseStrength,
        noiseScl: borderParams.noiseScale,
      })
    }, [chunkSize, borderParams, ditheringParams, noiseTexture, ditherUniforms])

    // Set up animation mixer + actions
    const { actions } = useAnimations(animations, groupRef)

    // Expose imperative handle
    useImperativeHandle(ref, () => ({
      setAnimState: (state: AnimState) => {
        currentAnimRef.current = state
      },
    }))

    // Apply team color tint to materials
    useEffect(() => {
      if (teamColor === undefined) return
      const color = new THREE.Color(teamColor)
      cloned.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) {
          const mesh = child as THREE.Mesh
          const mat = mesh.material
          if (mat && (mat as THREE.MeshStandardMaterial).color) {
            ;(mat as THREE.MeshStandardMaterial).color.lerp(color, 0.3)
          }
        }
      })
    }, [cloned, teamColor])

    // Poll for animation state changes every frame and crossfade
    useFrame(() => {
      ditherUniforms.uDitherCircleCenter.value.copy(useStore.getState().smoothedCircleCenter)

      const desired = currentAnimRef.current
      if (desired === activeAnimRef.current) return

      const newAction = actions[desired]
      if (!newAction) return

      const prevState = activeAnimRef.current
      const prevAction = prevState ? actions[prevState] : null

      const fadeDuration = CROSSFADE_DURATIONS[desired] ?? DEFAULT_CROSSFADE

      // Configure loop mode
      const isOneShot =
        desired === AnimState.DeathFront ||
        desired === AnimState.DeathBack ||
        desired === AnimState.Dying ||
        desired === AnimState.Reload ||
        desired === AnimState.Jump ||
        desired === AnimState.JumpBackward
      if (isOneShot) {
        newAction.setLoop(THREE.LoopOnce, 1)
        newAction.clampWhenFinished = true
      } else {
        newAction.setLoop(THREE.LoopRepeat, Infinity)
        newAction.clampWhenFinished = false
      }

      newAction.reset()
      newAction.setEffectiveTimeScale(1)
      newAction.setEffectiveWeight(1)
      newAction.fadeIn(fadeDuration)
      newAction.play()

      if (prevAction && prevAction !== newAction) {
        prevAction.fadeOut(fadeDuration)
      }

      activeAnimRef.current = desired
    })

    return (
      <group ref={groupRef}>
        <primitive object={cloned} rotation-y={Math.PI} />
      </group>
    )
  },
)

export default SoldierModel

// Preload model + texture eagerly
useGLTF.preload(MODEL_PATH)
useTexture.preload(TEXTURE_PATH)
useTexture.preload(noiseTextureUrl)
