import * as THREE from 'three'

export type WindSwayParams = {
  speed: number
  strength: number
  direction: number
}

export type WindNoiseFn = (x: number, y: number) => number

export type WindSwayConfig = {
  phaseScaleX?: number
  phaseScaleZ?: number
  phaseMultiplier?: number
  gustScale?: number
  gustTimeScale?: number
  baseStrength?: number
  gustBoost?: number
  swayFrequency?: number
}

const DEFAULT_CFG: Required<WindSwayConfig> = {
  phaseScaleX: 0.37,
  phaseScaleZ: 0.71,
  phaseMultiplier: 2.0,
  gustScale: 0.05,
  gustTimeScale: 0.3,
  baseStrength: 0.12,
  gustBoost: 0.5,
  swayFrequency: 1.2,
}

/**
 * Compute wind sway euler offsets for an object at world position.
 * Reusable for foliage, props, or character accessories.
 */
export function computeWindSwayEuler(
  worldPos: THREE.Vector3,
  time: number,
  wind: WindSwayParams,
  noise2D: WindNoiseFn,
  config?: WindSwayConfig,
): { x: number; z: number } {
  const cfg = { ...DEFAULT_CFG, ...config }

  const phase = (worldPos.x * cfg.phaseScaleX + worldPos.z * cfg.phaseScaleZ) * cfg.phaseMultiplier
  const gust = noise2D(worldPos.x * cfg.gustScale + time * cfg.gustTimeScale, worldPos.z * cfg.gustScale) * 0.5 + 0.5
  const swayAmount = wind.strength * cfg.baseStrength * (1 + gust * cfg.gustBoost)
  const swayAngle = Math.sin(time * wind.speed * cfg.swayFrequency + phase) * swayAmount

  return {
    x: swayAngle * Math.sin(wind.direction),
    z: swayAngle * Math.cos(wind.direction),
  }
}
