import { useRef, useEffect } from 'react'
import { useThree, useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import useEditorStore from './useEditorStore'

const POLAR_ANGLE = Math.PI * 0.2 // ~36° overhead
const PAN_SPEED = 30
const ZOOM_STEP = 3

const _offset = new THREE.Vector3()
const _target = new THREE.Vector3()

export default function EditorCamera() {
  const { camera } = useThree()
  const keys = useRef<Set<string>>(new Set())

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // Don't capture if user is typing in an input
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return
      keys.current.add(e.code)
    }
    const onKeyUp = (e: KeyboardEvent) => {
      keys.current.delete(e.code)
    }
    const onWheel = (e: WheelEvent) => {
      const store = useEditorStore.getState()
      store.setCameraZoom(store.cameraZoom + (e.deltaY > 0 ? ZOOM_STEP : -ZOOM_STEP))
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('wheel', onWheel, { passive: true })
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('wheel', onWheel)
    }
  }, [])

  useFrame((_, dt) => {
    const store = useEditorStore.getState()
    const k = keys.current
    let dx = 0
    let dz = 0
    if (k.has('KeyW') || k.has('ArrowUp')) dz -= 1
    if (k.has('KeyS') || k.has('ArrowDown')) dz += 1
    if (k.has('KeyA') || k.has('ArrowLeft')) dx -= 1
    if (k.has('KeyD') || k.has('ArrowRight')) dx += 1

    if (dx !== 0 || dz !== 0) {
      const len = Math.sqrt(dx * dx + dz * dz)
      dx /= len
      dz /= len
      const speed = PAN_SPEED * dt
      const [tx, ty, tz] = store.cameraTarget
      store.setCameraTarget([tx + dx * speed, ty, tz + dz * speed])
    }

    // Position camera at polar offset from target
    const [tx, ty, tz] = store.cameraTarget
    const zoom = store.cameraZoom
    const sinP = Math.sin(POLAR_ANGLE)
    const cosP = Math.cos(POLAR_ANGLE)
    _offset.set(0, cosP * zoom, sinP * zoom)

    const cam = camera as unknown as THREE.PerspectiveCamera
    cam.position.set(tx + _offset.x, ty + _offset.y, tz + _offset.z)
    _target.set(tx, ty, tz)
    cam.lookAt(_target)
  })

  return null
}
