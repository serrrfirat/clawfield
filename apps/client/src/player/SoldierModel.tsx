import { useRef, useEffect, useMemo, forwardRef, useImperativeHandle } from 'react'
import { useFrame } from '@react-three/fiber'
import { useGLTF, useAnimations, useTexture } from '@react-three/drei'
import { SkeletonUtils } from 'three-stdlib'
import * as THREE from 'three'
import { AnimState, CROSSFADE_DURATIONS, DEFAULT_CROSSFADE } from './animation-state'
import useStore from '../stores/useStore'
import noiseTextureUrl from '../assets/textures/noiseTexture.png'
import { ALL_WEAPON_MODEL_PATHS, getWeaponVisualForName } from './weapon-visuals'
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
  weaponName?: string
}

function findRightHandBone(root: THREE.Object3D): THREE.Bone | null {
  const bones: THREE.Bone[] = []
  root.traverse((child) => {
    if ((child as THREE.Bone).isBone) bones.push(child as THREE.Bone)
  })

  if (bones.length === 0) return null

  const byName = new Map<string, THREE.Bone>()
  for (const bone of bones) byName.set(bone.name.toLowerCase(), bone)

  const exactCandidates = ['mixamorigrighthand', 'righthand', 'hand_r', 'r_hand']
  for (const candidate of exactCandidates) {
    const hit = byName.get(candidate)
    if (hit) return hit
  }

  const fingerTokens = ['thumb', 'index', 'middle', 'ring', 'pinky']
  const handNoFinger = bones.find((bone) => {
    const n = bone.name.toLowerCase()
    return (n.includes('righthand') || (n.includes('right') && n.includes('hand'))) && !fingerTokens.some((t) => n.includes(t))
  })
  if (handNoFinger) return handNoFinger

  const forearm = bones.find((bone) => {
    const n = bone.name.toLowerCase()
    return n.includes('rightforearm') || n.includes('forearm_r') || n.includes('r_forearm')
  })
  if (forearm) return forearm

  return bones.find((bone) => {
    const n = bone.name.toLowerCase()
    return n.includes('right') && (n.includes('arm') || n.includes('hand'))
  }) ?? null
}

function centerObject(root: THREE.Object3D): void {
  const box = new THREE.Box3().setFromObject(root)
  if (box.isEmpty()) return
  const center = new THREE.Vector3()
  box.getCenter(center)
  root.position.sub(center)
}

function countMeshes(root: THREE.Object3D): number {
  let count = 0
  root.traverse((child) => {
    if ((child as THREE.Mesh).isMesh) count += 1
  })
  return count
}

const SoldierModel = forwardRef<SoldierModelHandle, SoldierModelProps>(
  function SoldierModel({ initialAnimState = AnimState.Idle, teamColor, weaponName }, ref) {
    const activeWeaponVisual = useMemo(() => getWeaponVisualForName(weaponName), [weaponName])
    const { scene, animations } = useGLTF(MODEL_PATH)
    const weaponGLTF = useGLTF(activeWeaponVisual.path) as { scene: THREE.Group }
    const baseColorTex = useTexture(TEXTURE_PATH)
    const noiseTexture = useTexture(noiseTextureUrl)
    const groupRef = useRef<THREE.Group>(null!)
    const currentAnimRef = useRef<AnimState>(initialAnimState)
    const activeAnimRef = useRef<AnimState | null>(null)
    const handBoneRef = useRef<THREE.Bone | null>(null)
    const weaponMountRef = useRef<THREE.Group | null>(null)
    const weaponObjectRef = useRef<THREE.Object3D | null>(null)

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

    useEffect(() => {
      const handBone = findRightHandBone(cloned)
      handBoneRef.current = handBone
      const mount = new THREE.Group()
      mount.name = 'weapon_mount'
      cloned.add(mount)
      if (!handBone) mount.position.set(0.2, 1.35, 0)
      weaponMountRef.current = mount

      return () => {
        handBoneRef.current = null
        weaponObjectRef.current?.removeFromParent()
        weaponObjectRef.current = null
        mount.removeFromParent()
        weaponMountRef.current = null
      }
    }, [cloned])

    useEffect(() => {
      const mount = weaponMountRef.current
      if (!mount) return

      weaponObjectRef.current?.removeFromParent()

      const weaponObject = weaponGLTF.scene.clone(true) as THREE.Object3D
      if (countMeshes(weaponObject) === 0) {
        const fallback = new THREE.Mesh(
          new THREE.BoxGeometry(0.2, 0.05, 0.7),
          new THREE.MeshStandardMaterial({ color: 0x88ccff }),
        )
        weaponObject.add(fallback)
      }
      centerObject(weaponObject)
      weaponObject.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) {
          const mesh = child as THREE.Mesh
          mesh.frustumCulled = false
          mesh.castShadow = true
          mesh.receiveShadow = true
        }
      })
      weaponObject.scale.setScalar(activeWeaponVisual.scale)
      weaponObject.position.set(...activeWeaponVisual.position)
      weaponObject.rotation.set(...activeWeaponVisual.rotation)
      mount.add(weaponObject)
      weaponObjectRef.current = weaponObject

      return () => {
        if (weaponObjectRef.current === weaponObject) {
          weaponObjectRef.current = null
        }
        weaponObject.removeFromParent()
      }
    }, [weaponGLTF.scene, activeWeaponVisual])

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

      const mount = weaponMountRef.current
      const hand = handBoneRef.current
      if (mount && hand) {
        const worldPos = new THREE.Vector3()
        const worldQuat = new THREE.Quaternion()
        const parentWorldQuat = new THREE.Quaternion()
        const localQuat = new THREE.Quaternion()
        hand.getWorldPosition(worldPos)
        hand.getWorldQuaternion(worldQuat)
        cloned.worldToLocal(worldPos)
        cloned.getWorldQuaternion(parentWorldQuat)
        localQuat.copy(parentWorldQuat).invert().multiply(worldQuat)
        mount.position.copy(worldPos)
        mount.quaternion.copy(localQuat)
        mount.scale.set(1, 1, 1)
      }

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
for (const path of ALL_WEAPON_MODEL_PATHS) {
  useGLTF.preload(path)
}
useTexture.preload(TEXTURE_PATH)
useTexture.preload(noiseTextureUrl)
