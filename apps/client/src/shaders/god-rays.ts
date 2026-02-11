import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';

/**
 * Screen-space god rays (volumetric light scattering).
 *
 * Two-pass approach:
 *   1. Occlusion pass: renders the scene depth to determine where
 *      the sun is visible vs blocked by geometry.
 *   2. Radial blur pass: blurs outward from the sun's screen position
 *      to create light shafts, then blends additively with the scene.
 */

const GodRaysShader = {
  uniforms: {
    tDiffuse: { value: null },
    tDepth: { value: null },
    sunScreenPos: { value: new THREE.Vector2(0.5, 0.5) },
    sunVisible: { value: 1.0 },
    density: { value: 0.96 },
    weight: { value: 0.10 },
    decay: { value: 0.93 },
    exposure: { value: 0.03 },
    numSamples: { value: 30 },
    sunColor: { value: new THREE.Vector3(1.0, 0.95, 0.85) },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform vec2 sunScreenPos;
    uniform float sunVisible;
    uniform float density;
    uniform float weight;
    uniform float decay;
    uniform float exposure;
    uniform int numSamples;
    uniform vec3 sunColor;

    varying vec2 vUv;

    void main() {
      vec4 sceneColor = texture2D(tDiffuse, vUv);

      // Skip expensive sampling when sun is off-screen (uniform branch — free)
      if (sunVisible < 0.5) {
        gl_FragColor = sceneColor;
        return;
      }

      // Direction from pixel to sun in screen space
      vec2 deltaTexCoord = vUv - sunScreenPos;
      deltaTexCoord *= density / float(numSamples);

      vec2 texCoord = vUv;
      float illuminationDecay = 1.0;
      vec3 godRayColor = vec3(0.0);

      for (int i = 0; i < 30; i++) {
        if (i >= numSamples) break;
        texCoord -= deltaTexCoord;
        vec3 sampleColor = texture2D(tDiffuse, texCoord).rgb;
        // Use luminance to determine bright areas (sky vs geometry)
        float lum = dot(sampleColor, vec3(0.299, 0.587, 0.114));
        // Only scatter from truly bright pixels (sky), not fogged geometry
        float brightMask = smoothstep(0.9, 1.0, lum);
        sampleColor *= brightMask * illuminationDecay * weight;
        godRayColor += sampleColor;
        illuminationDecay *= decay;
      }

      // Tint god rays with sun color and blend additively
      vec3 rays = godRayColor * exposure * sunColor;
      gl_FragColor = vec4(sceneColor.rgb + rays, sceneColor.a);
    }
  `,
};

export class GodRaysPass extends Pass {
  private uniforms: Record<string, THREE.IUniform>;
  private material: THREE.ShaderMaterial;
  private fsQuad: FullScreenQuad;
  private sunWorldPos: THREE.Vector3;
  private camera: THREE.Camera;

  constructor(camera: THREE.Camera, sunWorldPos: THREE.Vector3) {
    super();
    this.camera = camera;
    this.sunWorldPos = sunWorldPos;

    this.uniforms = THREE.UniformsUtils.clone(GodRaysShader.uniforms);
    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: GodRaysShader.vertexShader,
      fragmentShader: GodRaysShader.fragmentShader,
      transparent: false,
    });
    this.fsQuad = new FullScreenQuad(this.material);
  }

  render(
    renderer: THREE.WebGLRenderer,
    writeBuffer: THREE.WebGLRenderTarget,
    readBuffer: THREE.WebGLRenderTarget,
  ): void {
    // Project sun position to screen space
    const sunNDC = this.sunWorldPos.clone().project(this.camera);
    const sunX = sunNDC.x * 0.5 + 0.5;
    const sunY = sunNDC.y * 0.5 + 0.5;

    // Check if sun is in front of camera and roughly on screen
    const onScreen =
      sunNDC.z < 1.0 && sunX > -0.3 && sunX < 1.3 && sunY > -0.3 && sunY < 1.3;

    this.uniforms.tDiffuse.value = readBuffer.texture;
    this.uniforms.sunScreenPos.value.set(sunX, sunY);
    this.uniforms.sunVisible.value = onScreen ? 1.0 : 0.0;

    if (this.renderToScreen) {
      renderer.setRenderTarget(null);
    } else {
      renderer.setRenderTarget(writeBuffer);
      if (this.clear) renderer.clear();
    }

    this.fsQuad.render(renderer);
  }

  dispose(): void {
    this.material.dispose();
    this.fsQuad.dispose();
  }
}
