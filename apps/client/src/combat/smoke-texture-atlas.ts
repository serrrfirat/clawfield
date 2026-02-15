import * as THREE from 'three'

/**
 * Generates a 2x2 procedural smoke atlas texture on a canvas.
 * 4 variants: circular, blobby, wispy, dense — each in a quadrant.
 * Returns a CanvasTexture with mipmaps enabled.
 */
export function generateSmokeAtlas(size = 512): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!
  const half = size / 2

  // Clear to transparent
  ctx.clearRect(0, 0, size, size)

  // Helper: draw layered radial gradient puff
  const drawPuff = (
    cx: number,
    cy: number,
    radius: number,
    layers: { r: number; alpha: number }[],
    offsets: { dx: number; dy: number }[] = [],
  ) => {
    for (let l = 0; l < layers.length; l++) {
      const layer = layers[l]
      const off = offsets[l] || { dx: 0, dy: 0 }
      const grad = ctx.createRadialGradient(
        cx + off.dx, cy + off.dy, 0,
        cx + off.dx, cy + off.dy, radius * layer.r,
      )
      grad.addColorStop(0, `rgba(255,255,255,${layer.alpha})`)
      grad.addColorStop(0.4, `rgba(240,240,235,${layer.alpha * 0.8})`)
      grad.addColorStop(0.7, `rgba(220,220,215,${layer.alpha * 0.4})`)
      grad.addColorStop(1, 'rgba(200,200,195,0)')
      ctx.fillStyle = grad
      ctx.beginPath()
      ctx.arc(cx + off.dx, cy + off.dy, radius * layer.r, 0, Math.PI * 2)
      ctx.fill()
    }
  }

  const r = half * 0.42

  // Variant 0 (top-left): circular — clean round puff
  drawPuff(half * 0.5, half * 0.5, r, [
    { r: 1.0, alpha: 0.9 },
    { r: 0.7, alpha: 0.6 },
    { r: 0.4, alpha: 0.3 },
  ])

  // Variant 1 (top-right): blobby — offset overlapping circles
  drawPuff(half * 1.5, half * 0.5, r * 0.8, [
    { r: 1.0, alpha: 0.8 },
    { r: 0.6, alpha: 0.5 },
  ], [
    { dx: -r * 0.15, dy: r * 0.1 },
    { dx: r * 0.2, dy: -r * 0.1 },
  ])
  drawPuff(half * 1.5 + r * 0.25, half * 0.5 - r * 0.15, r * 0.6, [
    { r: 1.0, alpha: 0.7 },
    { r: 0.5, alpha: 0.4 },
  ])

  // Variant 2 (bottom-left): wispy — elongated, less opaque
  drawPuff(half * 0.5, half * 1.5, r * 0.9, [
    { r: 1.2, alpha: 0.5 },
    { r: 0.8, alpha: 0.35 },
  ], [
    { dx: r * 0.3, dy: 0 },
    { dx: -r * 0.2, dy: r * 0.1 },
  ])
  drawPuff(half * 0.5 - r * 0.2, half * 1.5 + r * 0.1, r * 0.5, [
    { r: 1.0, alpha: 0.4 },
  ])

  // Variant 3 (bottom-right): dense — large opaque core
  drawPuff(half * 1.5, half * 1.5, r, [
    { r: 1.0, alpha: 1.0 },
    { r: 0.8, alpha: 0.85 },
    { r: 0.5, alpha: 0.6 },
    { r: 0.25, alpha: 0.3 },
  ])

  const texture = new THREE.CanvasTexture(canvas)
  texture.generateMipmaps = true
  texture.minFilter = THREE.LinearMipmapLinearFilter
  texture.magFilter = THREE.LinearFilter
  texture.needsUpdate = true
  return texture
}
