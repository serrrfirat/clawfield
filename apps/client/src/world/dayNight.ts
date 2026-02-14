import * as THREE from 'three'

export const DAY_NIGHT_SUN_RADIUS = 140

export function getSunAngleRadians(timeOfDay: number): number {
  // 06:00 sunrise, 12:00 noon, 18:00 sunset, 00:00 midnight
  return ((timeOfDay - 12) / 24) * Math.PI * 2
}

export function getSunPosition(timeOfDay: number, radius = DAY_NIGHT_SUN_RADIUS): THREE.Vector3 {
  const angle = getSunAngleRadians(timeOfDay)
  return new THREE.Vector3(Math.sin(angle) * radius, Math.cos(angle) * radius, 0)
}

export function getFuzzySunPosition(timeOfDay: number, elapsedTime: number, radius = DAY_NIGHT_SUN_RADIUS): THREE.Vector3 {
  const baseAngle = getSunAngleRadians(timeOfDay)
  const wobble = Math.sin(elapsedTime * 0.031) * 0.075 + Math.sin(elapsedTime * 0.013 + 1.3) * 0.035
  const angle = baseAngle + wobble
  return new THREE.Vector3(Math.sin(angle) * radius, Math.cos(angle) * radius, 0)
}

export function getDayNightFactors(sunHeightNorm: number, enabled: boolean): {
  dayFactor: number
  sunsetFactor: number
  nightFactor: number
} {
  if (!enabled) {
    return { dayFactor: 1, sunsetFactor: 0, nightFactor: 0 }
  }
  const dayFactor = THREE.MathUtils.smoothstep(sunHeightNorm, -0.04, 0.45)
  const sunsetFactor = THREE.MathUtils.clamp(1 - Math.abs(sunHeightNorm - 0.08) / 0.26, 0, 1)
  const nightFactor = THREE.MathUtils.smoothstep(-sunHeightNorm, 0.0, 0.42)
  return { dayFactor, sunsetFactor, nightFactor }
}

function cyclicHourDistance(a: number, b: number): number {
  const d = Math.abs(a - b) % 24
  return d > 12 ? 24 - d : d
}

function hourBand(timeOfDay: number, center: number, halfWidth: number): number {
  const d = cyclicHourDistance(timeOfDay, center)
  if (d >= halfWidth) return 0
  const t = 1 - d / halfWidth
  return t * t * (3 - 2 * t)
}

export function getTimeOfDayTintFactors(timeOfDay: number): {
  morningOrange: number
  middayYellow: number
  afternoonOrangePurple: number
  nightIndigo: number
} {
  const t = ((timeOfDay % 24) + 24) % 24
  return {
    morningOrange: hourBand(t, 7.25, 2.75),
    middayYellow: hourBand(t, 12.75, 3.0),
    afternoonOrangePurple: hourBand(t, 17.75, 3.0),
    nightIndigo: hourBand(t, 22.5, 5.25),
  }
}
