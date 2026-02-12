import { useRef, useEffect } from 'react'
import { useThree, useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import type { Vec3 } from '@clawfield/shared'

const _raycaster = new THREE.Raycaster()
const _mouseNDC = new THREE.Vector2()
const _groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
const _intersection = new THREE.Vector3()
const _smoothedPos = new THREE.Vector3()
const _lookTarget = new THREE.Vector3()
const _offset = new THREE.Vector3()

interface TopDownCameraState {
  followPos: THREE.Vector3
  cursorWorldPos: THREE.Vector3
  hasCursor: boolean
  mouseX: number
  mouseY: number
}

const POLAR_ANGLE = Math.PI * 0.2   // ~36°
const CAMERA_DISTANCE = 25
const FOLLOW_SMOOTHING = 0.15
const CURSOR_LEAD_BLEND = 0.2
const AZIMUTH = 0

export function useTopDownCamera() {
  const { camera } = useThree()
  const state = useRef<TopDownCameraState>({
    followPos: new THREE.Vector3(),
    cursorWorldPos: new THREE.Vector3(),
    hasCursor: false,
    mouseX: 0,
    mouseY: 0,
  })

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      state.current.mouseX = e.clientX
      state.current.mouseY = e.clientY
      state.current.hasCursor = true
    }
    document.addEventListener('mousemove', onMouseMove)
    return () => document.removeEventListener('mousemove', onMouseMove)
  }, [])

  const update = (playerPos: Vec3, dt: number) => {
    const s = state.current
    const cam = camera as THREE.PerspectiveCamera

    // Update ground plane
    _groundPlane.constant = -playerPos.y

    // Smooth follow
    _smoothedPos.set(playerPos.x, playerPos.y, playerPos.z)
    s.followPos.lerp(_smoothedPos, 1 - Math.pow(1 - FOLLOW_SMOOTHING, dt * 60))

    // Camera offset
    const sinP = Math.sin(POLAR_ANGLE)
    const cosP = Math.cos(POLAR_ANGLE)
    _offset.set(
      Math.sin(AZIMUTH) * sinP * CAMERA_DISTANCE,
      cosP * CAMERA_DISTANCE,
      Math.cos(AZIMUTH) * sinP * CAMERA_DISTANCE,
    )

    cam.position.set(
      s.followPos.x + _offset.x,
      s.followPos.y + _offset.y,
      s.followPos.z + _offset.z,
    )

    cam.updateMatrixWorld()

    // Raycast cursor
    if (s.hasCursor) {
      _mouseNDC.x = (s.mouseX / window.innerWidth) * 2 - 1
      _mouseNDC.y = -(s.mouseY / window.innerHeight) * 2 + 1
      _raycaster.setFromCamera(_mouseNDC, cam)
      const hit = _raycaster.ray.intersectPlane(_groundPlane, _intersection)
      if (hit) s.cursorWorldPos.copy(_intersection)
    }

    // Look target blend
    if (s.hasCursor) {
      _lookTarget.set(
        s.followPos.x + (s.cursorWorldPos.x - s.followPos.x) * CURSOR_LEAD_BLEND,
        s.followPos.y,
        s.followPos.z + (s.cursorWorldPos.z - s.followPos.z) * CURSOR_LEAD_BLEND,
      )
    } else {
      _lookTarget.copy(s.followPos)
    }

    cam.lookAt(_lookTarget)
  }

  const getAimYaw = (playerPos: Vec3): number => {
    const dx = state.current.cursorWorldPos.x - playerPos.x
    const dz = state.current.cursorWorldPos.z - playerPos.z
    return Math.atan2(dx, -dz)
  }

  const getCursorWorldPos = (): THREE.Vector3 => state.current.cursorWorldPos

  return { update, getAimYaw, getCursorWorldPos }
}
