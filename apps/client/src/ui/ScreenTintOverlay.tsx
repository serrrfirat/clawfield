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
  const suppression = useStore((s: any) => s.suppression ?? 0)

  const style = useMemo<React.CSSProperties>(() => {
    const suppressionLevel = THREE.MathUtils.clamp(suppression, 0, 1)
    const hasTimeTint = !!post?.enabled && !!post?.screenTintEnabled && !!post?.dynamicPostFX

    const suppressionVignetteAlpha = THREE.MathUtils.lerp(0.06, 0.62, suppressionLevel)
    const suppressionBlurPx = THREE.MathUtils.lerp(0, 2.4, suppressionLevel)
    const suppressionRadius = `${Math.round(52 - suppressionLevel * 8)}%`

    const suppressionLayer = suppressionLevel <= 0.01
      ? ''
      : `radial-gradient(ellipse at center, rgba(0, 0, 0, 0) ${suppressionRadius}, rgba(0, 0, 0, ${suppressionVignetteAlpha.toFixed(3)}) 100%)`

    if (!hasTimeTint && !suppressionLayer) {
      return { ...overlayBase, opacity: 0 }
    }

    let background = suppressionLayer

    if (hasTimeTint) {
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
      const tintBackground = `linear-gradient(to bottom, rgba(${Math.round(top.r * 255)}, ${Math.round(top.g * 255)}, ${Math.round(top.b * 255)}, ${topAlpha.toFixed(3)}), rgba(${Math.round(bottom.r * 255)}, ${Math.round(bottom.g * 255)}, ${Math.round(bottom.b * 255)}, ${bottomAlpha.toFixed(3)}))`

      background = suppressionLayer ? `${tintBackground}, ${suppressionLayer}` : tintBackground
    }

    return {
      ...overlayBase,
      background,
      opacity: 1,
      filter: `blur(${suppressionBlurPx.toFixed(2)}px)`,
    }
  }, [
    post?.enabled,
    post?.screenTintEnabled,
    post?.dynamicPostFX,
    post?.screenTintStrength,
    dayNight?.timeOfDay,
    dayNight?.sunRadius,
    suppression,
  ])

  return <div style={style} />
}

const overlayBase: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  pointerEvents: 'none',
  mixBlendMode: 'normal',
  zIndex: 3,
}
