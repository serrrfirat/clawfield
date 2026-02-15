import * as THREE from 'three'

const MAX_DECALS = 16
const FADE_IN_DURATION = 0.3

interface ActiveDecal {
  mesh: THREE.Mesh
  material: THREE.MeshBasicMaterial
  elapsed: number
  fadingIn: boolean
}

/** Generate a procedural burnt scorch mark texture on canvas. */
function createScorchTexture(size = 256): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!
  const c = size * 0.5

  // Dark center, rough fading edges — much more opaque for visibility
  const grad = ctx.createRadialGradient(c, c, 0, c, c, c)
  grad.addColorStop(0.0, 'rgba(10,8,6,1.0)')
  grad.addColorStop(0.3, 'rgba(20,16,12,0.9)')
  grad.addColorStop(0.6, 'rgba(30,25,18,0.65)')
  grad.addColorStop(0.85, 'rgba(35,30,22,0.3)')
  grad.addColorStop(1.0, 'rgba(0,0,0,0)')
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, size, size)

  // More noise blobs with stronger alpha for organic edges
  for (let i = 0; i < 20; i++) {
    const angle = Math.random() * Math.PI * 2
    const dist = c * (0.3 + Math.random() * 0.5)
    const bx = c + Math.cos(angle) * dist
    const by = c + Math.sin(angle) * dist
    const br = size * (0.05 + Math.random() * 0.1)
    const bGrad = ctx.createRadialGradient(bx, by, 0, bx, by, br)
    bGrad.addColorStop(0, 'rgba(20,16,12,0.6)')
    bGrad.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = bGrad
    ctx.fillRect(0, 0, size, size)
  }

  const tex = new THREE.CanvasTexture(canvas)
  tex.wrapS = THREE.ClampToEdgeWrapping
  tex.wrapT = THREE.ClampToEdgeWrapping
  tex.needsUpdate = true
  return tex
}

export class ScorchDecalSystem {
  private scene: THREE.Scene
  private decals: ActiveDecal[] = []
  private geometry: THREE.PlaneGeometry
  private texture: THREE.CanvasTexture
  private heightGetter: ((x: number, z: number) => number) | null = null

  constructor(scene: THREE.Scene) {
    this.scene = scene
    this.geometry = new THREE.PlaneGeometry(1, 1)
    this.texture = createScorchTexture()
  }

  setHeightGetter(getter: ((x: number, z: number) => number) | null): void {
    this.heightGetter = getter
  }

  addScorch(position: THREE.Vector3, radius: number): void {
    // Recycle oldest if pool full
    while (this.decals.length >= MAX_DECALS) {
      const oldest = this.decals.shift()!
      this.scene.remove(oldest.mesh)
      oldest.material.dispose()
    }

    const groundY = this.heightGetter
      ? this.heightGetter(position.x, position.z)
      : position.y

    const material = new THREE.MeshBasicMaterial({
      map: this.texture,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
      side: THREE.DoubleSide,
    })

    const mesh = new THREE.Mesh(this.geometry, material)
    const scaledRadius = radius * (2.0 + Math.random() * 0.8)
    mesh.scale.set(scaledRadius, scaledRadius, 1)
    mesh.position.set(position.x, groundY + 0.08, position.z)
    // Lay flat on ground (rotate to XZ plane)
    mesh.rotation.x = -Math.PI / 2
    // Random rotation around Y for variety
    mesh.rotation.z = Math.random() * Math.PI * 2
    mesh.renderOrder = 1
    this.scene.add(mesh)

    this.decals.push({
      mesh,
      material,
      elapsed: 0,
      fadingIn: true,
    })
  }

  update(dt: number): void {
    for (const decal of this.decals) {
      if (!decal.fadingIn) continue
      decal.elapsed += dt
      const t = Math.min(1, decal.elapsed / FADE_IN_DURATION)
      decal.material.opacity = t * 0.95
      if (t >= 1) decal.fadingIn = false
    }
  }

  dispose(): void {
    for (const decal of this.decals) {
      this.scene.remove(decal.mesh)
      decal.material.dispose()
    }
    this.decals.length = 0
    this.geometry.dispose()
    this.texture.dispose()
  }
}
