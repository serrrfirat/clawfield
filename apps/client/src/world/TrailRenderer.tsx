import * as THREE from 'three'
import { useFrame, useThree, createPortal } from '@react-three/fiber'
import { useFBO } from '@react-three/drei'
import { useRef, useMemo, useEffect, useState } from 'react'
import useStore from '../stores/useStore'

const RESOLUTION = 256

export default function TrailRenderer() {
  const { gl } = useThree()
  const setTrailTexture = useStore((state) => state.setTrailTexture)
  const trailParameters = useStore((state) => state.trailParameters)
  const terrainParameters = useStore((state) => state.terrainParameters)
  const ballPosition = useStore((state) => state.ballPosition)
  
  // We need ping-pong buffers for the feedback loop (fade trail)
  const renderTargetA = useFBO(RESOLUTION, RESOLUTION, {
    format: THREE.RedFormat, // We only need one channel for trail intensity
    type: THREE.HalfFloatType, // Higher precision for smooth fades
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    wrapS: THREE.ClampToEdgeWrapping,
    wrapT: THREE.ClampToEdgeWrapping,
  })
  
  const renderTargetB = useFBO(RESOLUTION, RESOLUTION, {
    format: THREE.RedFormat,
    type: THREE.HalfFloatType,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    wrapS: THREE.ClampToEdgeWrapping,
    wrapT: THREE.ClampToEdgeWrapping,
  })

  // Scene for trail rendering
  const trailScene = useMemo(() => new THREE.Scene(), [])
  const trailCamera = useMemo(() => new THREE.OrthographicCamera(-0.5, 0.5, 0.5, -0.5, 0, 10), [])
  trailCamera.position.z = 1

  // Brush material (the "pen" that draws the trail)
  const brushMaterial = useMemo(() => new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Vector3(1, 1, 1) },
      uAlpha: { value: 1.0 },
      uSize: { value: 0.15 }, // Size relative to chunk (0.5 = full width)
    },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      varying vec2 vUv;
      uniform float uSize;
      uniform float uAlpha;
      void main() {
        float dist = distance(vUv, vec2(0.5));
        float strength = 1.0 - smoothstep(0.0, uSize, dist);
        gl_FragColor = vec4(strength * uAlpha, 0.0, 0.0, 1.0);
      }
    `,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    blending: THREE.AdditiveBlending, // Additive to accumulate trail
  }), [])

  // Fade material (renders previous frame with offset and fade)
  const fadeMaterial = useMemo(() => new THREE.ShaderMaterial({
    uniforms: {
      uTexture: { value: null },
      uOpacity: { value: 0.98 },
      uOffset: { value: new THREE.Vector2(0, 0) },
    },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      varying vec2 vUv;
      uniform sampler2D uTexture;
      uniform float uOpacity;
      uniform vec2 uOffset;
      void main() {
        vec2 uv = vUv + uOffset;
        // Clamp to avoid tiling artifacts
        if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
          gl_FragColor = vec4(0.0);
        } else {
          float val = texture2D(uTexture, uv).r;
          gl_FragColor = vec4(val * uOpacity, 0.0, 0.0, 1.0);
        }
      }
    `,
    depthTest: false,
    depthWrite: false,
  }), [])

  const quadGeometry = useMemo(() => new THREE.PlaneGeometry(1, 1), [])
  const fadeMesh = useMemo(() => new THREE.Mesh(quadGeometry, fadeMaterial), [quadGeometry, fadeMaterial])
  const brushMesh = useMemo(() => new THREE.Mesh(quadGeometry, brushMaterial), [quadGeometry, brushMaterial])

  // Refs for ping-pong
  const currentTarget = useRef(renderTargetA)
  const prevTarget = useRef(renderTargetB)
  const lastPos = useRef(new THREE.Vector3())
  const firstFrame = useRef(true)

  // Initialize scene
  useEffect(() => {
    trailScene.add(fadeMesh) // Background (faded previous frame)
    trailScene.add(brushMesh) // Foreground (new brush)
    
    // Ensure fade mesh is behind brush
    fadeMesh.renderOrder = 0
    brushMesh.renderOrder = 1
    
    return () => {
      trailScene.remove(fadeMesh)
      trailScene.remove(brushMesh)
    }
  }, [trailScene, fadeMesh, brushMesh])

  useEffect(() => {
    if (ballPosition) {
      lastPos.current.copy(ballPosition)
    }
  }, []) // Initialize start pos

  useFrame((state, delta) => {
    // 1. Calculate player movement offset in UV space
    // The shader uses chunk size. We need to match this scale.
    // If player moves +X by 1 unit, they move 1/chunkSize of the texture.
    // The trail texture should shift -1/chunkSize to keep the old trail in place relative to the world.
    const CHUNK_SIZE = terrainParameters.chunkSize || 30
    
    const dx = ballPosition.x - lastPos.current.x
    const dz = ballPosition.z - lastPos.current.z
    lastPos.current.copy(ballPosition)

    // Offset is normalized UV coordinates (0..1)
    // We flip X because texture coordinates might be flipped relative to world, 
    // but let's stick to standard logic: UV moves opposite to player.
    // Note: vertex shader has `trailUv.x = 1.0 - trailUv.x`.
    // Let's assume standard UV first.
    const uvOffsetX = dx / CHUNK_SIZE
    const uvOffsetY = dz / CHUNK_SIZE // Y in texture is Z in world

    // Note: The vertex shader does `1.0 - trailUv.x`. This flips X.
    // If we move +X, world moves -X relative to us. 
    // If texture is flipped, we might need to invert offset.
    // Let's try standard offset first.
    fadeMaterial.uniforms.uOffset.value.set(uvOffsetX * -1, uvOffsetY) // Usually we shift UV *towards* movement to sample "behind"??
    // No, if we want to sample where the ground *was*, we look at `uv + offset`.
    // If player moves RIGHT (+u), the ground moves LEFT relative to camera.
    // So the pixel at center now corresponds to a pixel that was to the right previously.
    // So we sample at `uv + offset`.
    // If player moves +X (Right), `uvOffsetX` is positive.
    // We sample at `uv + uvOffsetX`.
    
    // However, vertex shader flips X: `trailUv.x = 1.0 - trailUv.x`.
    // This means world +X corresponds to texture -U (or +U depending on origin).
    // Let's stick with standard +offset for now and fix if inverted.
    fadeMaterial.uniforms.uOffset.value.set(uvOffsetX * -1, uvOffsetY) // Flip X because of shader flip? 
    // Actually, let's look at vertex shader: `trailUv = 0.5 - deltaXZ / uGrassChunkSize`.
    // `deltaXZ` = `world - ball`.
    // If we move ball +X, `ball` increases. `deltaXZ` decreases. `trailUv` increases.
    // So texture slides +U when ball moves +X.
    // To keep world stable, we must shift the texture content -U?
    // Let's just try `uvOffsetX` and `uvOffsetY`.
    
    // Update uniforms
    fadeMaterial.uniforms.uTexture.value = prevTarget.current.texture
    fadeMaterial.uniforms.uOpacity.value = 1.0 - (trailParameters.fadeAlpha || 0.05) * (delta * 60) // Scale fade by frame time? Or just fixed.
    brushMaterial.uniforms.uSize.value = (trailParameters.glowSize || 0.18) * 0.5 // Radius
    brushMaterial.uniforms.uAlpha.value = trailParameters.glowAlpha || 0.3

    // Render to current target
    gl.setRenderTarget(currentTarget.current)
    gl.render(trailScene, trailCamera)
    gl.setRenderTarget(null)

    // Update global store texture reference
    // We only update if it changed? No, it's a stable object reference usually, 
    // but useStore might compare identity.
    // Actually, we can just set it once, but we are swapping buffers.
    // So we need to update it every frame because the *source* texture changes.
    setTrailTexture(currentTarget.current.texture)

    // Swap buffers
    const temp = currentTarget.current
    currentTarget.current = prevTarget.current
    prevTarget.current = temp
  })

  return null
}
