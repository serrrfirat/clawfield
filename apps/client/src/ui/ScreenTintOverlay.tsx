import { useMemo } from 'react'
import * as THREE from 'three'
import useStore from '../stores/useStore'
import { getTimeOfDayTintFactors } from '../world/dayNight'

const tintMorning = new THREE.Color('#ffb36a')
const tintMidday = new THREE.Color('#f6e39a')
const tintAfternoon = new THREE.Color('#d08ec5')
const tintNight = new THREE.Color('#3f4f98')

export default function ScreenTintOverlay() {
  const post = useStore((s: any) => s.postProcessingParameters)
  const dayNight = useStore((s: any) => s.dayNightParameters)

  const style = useMemo<React.CSSProperties>(() => {
    if (!post?.enabled) {
      return { ...overlayBase, opacity: 0 }
    }

    const strength = post.screenTintStrength ?? 1
    const { morningOrange, middayYellow, afternoonOrangePurple, nightIndigo } = getTimeOfDayTintFactors(dayNight?.timeOfDay ?? 14)

    const tint = tintMidday.clone()
      .lerp(tintMorning, morningOrange)
      .lerp(tintMidday, middayYellow)
      .lerp(tintAfternoon, afternoonOrangePurple)
      .lerp(tintNight, nightIndigo)

    const alpha = THREE.MathUtils.clamp(
      (morningOrange * 0.18 + middayYellow * 0.1 + afternoonOrangePurple * 0.2 + nightIndigo * 0.3) * strength,
      0,
      0.55,
    )

    const top = tint.clone().multiplyScalar(1.06)
    const bottom = tint.clone().multiplyScalar(0.88)
    const topAlpha = THREE.MathUtils.clamp(alpha * 0.92, 0, 0.55)
    const bottomAlpha = THREE.MathUtils.clamp(alpha * 1.08, 0, 0.6)

    return {
      ...overlayBase,
      background: `linear-gradient(to bottom, rgba(${Math.round(top.r * 255)}, ${Math.round(top.g * 255)}, ${Math.round(top.b * 255)}, ${topAlpha.toFixed(3)}), rgba(${Math.round(bottom.r * 255)}, ${Math.round(bottom.g * 255)}, ${Math.round(bottom.b * 255)}, ${bottomAlpha.toFixed(3)}))`,
      opacity: 1,
    }
  }, [post?.enabled, post?.screenTintStrength, dayNight?.timeOfDay, dayNight?.sunRadius])

  return <div style={style} />
}

const overlayBase: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  pointerEvents: 'none',
  mixBlendMode: 'normal',
  zIndex: 3,
}
