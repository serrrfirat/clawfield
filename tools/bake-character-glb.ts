#!/usr/bin/env tsx
/**
 * Offline bake script: convert character FBX + 21 animation FBXs → single GLB.
 *
 * Usage: pnpm bake:soldier
 *
 * Requires: jsdom, three (installed as devDependencies)
 */

import { JSDOM } from 'jsdom'
import path from 'path'
import fs from 'fs'
import { createCanvas, type Canvas as NapiCanvas } from '@napi-rs/canvas'

// ── Bootstrap a minimal DOM so Three.js runs in Node ──────────────
const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
  url: 'http://localhost',
  pretendToBeVisual: true,
})

// Patch globals Three.js expects
;(globalThis as any).window = dom.window
;(globalThis as any).document = dom.window.document
;(globalThis as any).navigator = dom.window.navigator
;(globalThis as any).self = dom.window
;(globalThis as any).HTMLCanvasElement = dom.window.HTMLCanvasElement
;(globalThis as any).XMLHttpRequest = dom.window.XMLHttpRequest
// Use Node.js native Blob (has .arrayBuffer()) instead of jsdom's (which doesn't)
;(globalThis as any).Blob = globalThis.Blob ?? dom.window.Blob
;(globalThis as any).URL = dom.window.URL

// Monkey-patch document.createElement to return @napi-rs/canvas for 'canvas'
const origCreateElement = dom.window.document.createElement.bind(dom.window.document)
;(dom.window.document as any).createElement = (tagName: string, ...args: any[]) => {
  if (tagName === 'canvas') {
    const canvas = createCanvas(1, 1) as any
    // GLTFExporter uses canvas.toBlob() — polyfill it from toBuffer
    canvas.toBlob = (cb: (blob: Blob) => void, mimeType?: string) => {
      const mime = mimeType || 'image/png'
      const buf = canvas.toBuffer(mime)
      cb(new dom.window.Blob([buf], { type: mime }) as Blob)
    }
    return canvas
  }
  return origCreateElement(tagName, ...args)
}

// Custom OffscreenCanvas with Symbol.hasInstance so @napi-rs/canvas passes instanceof
class FakeOffscreenCanvas {
  width: number
  height: number
  constructor(w: number, h: number) {
    this.width = w
    this.height = h
  }
  getContext() {
    return null
  }
  static [Symbol.hasInstance](instance: any): boolean {
    // Accept @napi-rs/canvas Canvas objects
    return instance && typeof instance.getContext === 'function'
      && typeof instance.toBuffer === 'function'
  }
}
;(globalThis as any).OffscreenCanvas = FakeOffscreenCanvas

// ImageData polyfill for GLTFExporter's DataTexture path
;(globalThis as any).ImageData = class ImageData {
  data: Uint8ClampedArray
  width: number
  height: number
  constructor(data: Uint8ClampedArray, width: number, height?: number) {
    this.data = data
    this.width = width
    this.height = height ?? (data.length / 4 / width)
  }
}

// ImageBitmap stub
;(globalThis as any).createImageBitmap = undefined

// FileReader polyfill for GLTFExporter
;(globalThis as any).FileReader = class FileReader {
  result: any = null
  onload: (() => void) | null = null
  onloadend: (() => void) | null = null
  readAsArrayBuffer(blob: any) {
    const self = this
    // Use setImmediate/nextTick to ensure onloadend is assigned before firing
    const finish = (ab: ArrayBuffer) => {
      self.result = ab
      // Defer callback to next tick so caller can set onloadend after readAsArrayBuffer
      setImmediate(() => {
        self.onload?.()
        self.onloadend?.()
      })
    }
    if (typeof blob.arrayBuffer === 'function') {
      blob.arrayBuffer().then(finish)
    } else {
      // Fallback: synchronous for simple blobs
      finish(new ArrayBuffer(0))
    }
  }
  readAsDataURL(_blob: any) {
    // Not needed for binary export
    setImmediate(() => {
      this.onload?.()
      this.onloadend?.()
    })
  }
}

// ── Paths ──────────────────────────────────────────────────────────
const ROOT = path.resolve(__dirname, '..')
const CHARACTER_FBX = path.join(
  ROOT,
  'assets/models/characters/data/1256207/39c0c8ea-038d-48ab-a4c3-ccf19d534d9a/39c0c8ea-038d-48ab-a4c3-ccf19d534d9a.fbx',
)
const TEXTURE_PATH = path.join(
  ROOT,
  'assets/models/characters/data/1256207/39c0c8ea-038d-48ab-a4c3-ccf19d534d9a/Base Color.png',
)
const ANIM_DIR = path.join(ROOT, 'assets/animations/Animations Soldier')
const OUTPUT_DIR = path.join(ROOT, 'apps/client/public/models')
const OUTPUT_PATH = path.join(OUTPUT_DIR, 'soldier-animated.glb')

// ── Clip name mapping: FBX filename → clean clip name ──────────────
const CLIP_NAME_MAP: Record<string, string> = {
  'Rifle Aiming Idle.fbx': 'rifle_idle',
  'Walk Forward from Mixamo.fbx': 'walk_forward',
  'Run Forward from Mixamo.fbx': 'run_forward',
  'Sprint Forward Mixamo.fbx': 'sprint_forward',
  'Walk Left from Mixamo.fbx': 'walk_left',
  'Walk Right Mixamo.fbx': 'walk_right',
  'Walk Forward Left.fbx': 'walk_forward_left',
  'Walk Crouching Forward.fbx': 'crouch_walk',
  'Idle Crouching from Mixamo.fbx': 'crouch_idle',
  'Crawl Forward from Mixamo.fbx': 'crawl_forward',
  'Firing Rifle from Mixamo.fbx': 'fire_rifle',
  'Firing Rifle Mixamo.fbx': 'fire_rifle_alt',
  'Reloading Mixamo.fbx': 'reload',
  'Rifle Turn.fbx': 'rifle_turn',
  'Turn Left 45 Degrees.fbx': 'turn_left_45',
  'Rifle Crouch Idle to Walk (1).fbx': 'crouch_idle_to_walk',
  'Rifle Crouch Walk to Kneel (1).fbx': 'crouch_walk_to_kneel',
  'Running To Stop.fbx': 'run_to_stop',
  'Stepping Forward from Mixamo.fbx': 'step_forward',
  'Death From The Front.fbx': 'death_front',
  'Death From Back Headshot.fbx': 'death_back',
  'Dying.fbx': 'dying',
  'Rifle Jump Mixamo.fbx': 'jump',
  'Backward Jump from Mixamo.fbx': 'jump_backward',
  'Crouch Rapid Fire.fbx': 'crouch_fire',
}

/** Locomotion clips that should have root motion stripped (hips X/Z translation) */
const STRIP_ROOT_MOTION = new Set([
  'walk_forward',
  'run_forward',
  'sprint_forward',
  'walk_left',
  'walk_right',
  'walk_forward_left',
  'crouch_walk',
  'crouch_idle',
  'crawl_forward',
  'rifle_idle',
  'fire_rifle',
  'fire_rifle_alt',
  'crouch_fire',
  'reload',
  'jump',
  'jump_backward',
])

// ── Main ───────────────────────────────────────────────────────────

async function main() {
  // Dynamic imports must be inside async function (no top-level await in CJS)
  const THREE = await import('three')
  const { FBXLoader } = await import('three/examples/jsm/loaders/FBXLoader.js')
  const { GLTFExporter } = await import('three/examples/jsm/exporters/GLTFExporter.js')

  function loadFBX(filePath: string): THREE.Group {
    const loader = new FBXLoader()
    const buffer = fs.readFileSync(filePath)
    return loader.parse(buffer.buffer as ArrayBuffer, path.dirname(filePath) + '/')
  }

  /**
   * Strip root motion: zero out X/Z position tracks for hips bone.
   * Keeps Y translation (vertical bob).
   */
  function stripRootMotion(clip: THREE.AnimationClip): void {
    for (const track of clip.tracks) {
      if (track.name.match(/hips\.position/i) && track instanceof THREE.VectorKeyframeTrack) {
        const values = track.values
        for (let i = 0; i < values.length; i += 3) {
          values[i] = 0     // X
          values[i + 2] = 0 // Z
        }
      }
    }
  }

  // The character FBX is NOT rigged (static mesh only).
  // The animation FBXs are Mixamo "With Skin" exports that include the full
  // SkinnedMesh + skeleton. We use the idle animation FBX as the base mesh
  // (all animation FBXs share the same rig).
  const idleFile = 'Rifle Aiming Idle.fbx'
  console.log(`Loading base mesh from: ${idleFile}`)
  const character = loadFBX(path.join(ANIM_DIR, idleFile))

  // Normalize scale — Mixamo exports at 0.01 (centimeters → meters)
  character.scale.set(0.01, 0.01, 0.01)
  character.updateMatrixWorld(true)

  // Strip ALL textures from FBX materials.
  // FBX loader creates broken texture refs (.fbm files) that crash GLTFExporter.
  // Also convert non-standard materials (Phong/Lambert) to MeshStandardMaterial.
  console.log('Cleaning up FBX materials...')
  character.traverse((child) => {
    if ((child as THREE.Mesh).isMesh) {
      const mesh = child as THREE.Mesh
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
      for (let i = 0; i < materials.length; i++) {
        const mat = materials[i]
        if (!mat) continue
        if (!(mat as any).isMeshStandardMaterial) {
          const newMat = new THREE.MeshStandardMaterial()
          if ((mat as any).color) newMat.color.copy((mat as any).color)
          if (Array.isArray(mesh.material)) {
            ;(mesh.material as THREE.Material[])[i] = newMat
          } else {
            mesh.material = newMat
          }
          continue
        }
        const stdMat = mat as THREE.MeshStandardMaterial
        stdMat.map = null
        stdMat.normalMap = null
        stdMat.roughnessMap = null
        stdMat.metalnessMap = null
        stdMat.emissiveMap = null
        stdMat.aoMap = null
        stdMat.needsUpdate = true
      }
    }
  })

  // Copy texture to output dir — loaded separately at runtime
  if (fs.existsSync(TEXTURE_PATH)) {
    const texOutputPath = path.join(OUTPUT_DIR, 'soldier-base-color.png')
    fs.copyFileSync(TEXTURE_PATH, texOutputPath)
    console.log(`Copied texture to: ${texOutputPath}`)
  }

  // Clear idle animation from character (we'll add all clips fresh)
  character.animations = []

  // Load each animation FBX and extract clips
  const animFiles = fs.readdirSync(ANIM_DIR).filter((f) => f.endsWith('.fbx'))
  console.log(`Loading ${animFiles.length} animation FBXs...`)

  for (const animFile of animFiles) {
    const clipName = CLIP_NAME_MAP[animFile]
    if (!clipName) {
      console.warn(`  Skipping unmapped animation: ${animFile}`)
      continue
    }

    try {
      const animScene = loadFBX(path.join(ANIM_DIR, animFile))
      if (animScene.animations.length > 0) {
        const clip = animScene.animations[0]
        clip.name = clipName

        // Strip root motion for locomotion clips
        if (STRIP_ROOT_MOTION.has(clipName)) {
          stripRootMotion(clip)
        }

        character.animations.push(clip)
        console.log(`  + ${clipName} (${clip.duration.toFixed(2)}s, ${clip.tracks.length} tracks)`)
      } else {
        console.warn(`  No animations found in ${animFile}`)
      }
    } catch (e) {
      console.error(`  Failed to load ${animFile}:`, e)
    }
  }

  console.log(`\nTotal clips: ${character.animations.length}`)

  // Export as GLB
  console.log('Exporting GLB...')
  fs.mkdirSync(OUTPUT_DIR, { recursive: true })

  const exporter = new GLTFExporter()
  const glb = await new Promise<ArrayBuffer>((resolve, reject) => {
    exporter.parse(
      character,
      (result) => resolve(result as ArrayBuffer),
      (error) => reject(error),
      {
        binary: true,
        animations: character.animations,
        includeCustomExtensions: false,
      },
    )
  })

  fs.writeFileSync(OUTPUT_PATH, Buffer.from(glb))
  const sizeMB = (glb.byteLength / 1024 / 1024).toFixed(2)
  console.log(`\nWritten: ${OUTPUT_PATH} (${sizeMB} MB)`)
  console.log('Done!')
}

main().catch((e) => {
  console.error('Bake failed:', e)
  process.exit(1)
})
