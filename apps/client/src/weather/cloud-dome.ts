import * as THREE from 'three';

/**
 * Procedural cloud dome rendered as a hemisphere mesh with a custom shader.
 *
 * Uses layered FBM noise to produce animated volumetric-looking clouds
 * on a sky dome. All rendering is a single draw call (one mesh).
 *
 * Configurable at runtime:
 * - coverage: 0 (clear) to 1 (overcast)
 * - cloudColor / skyColor
 * - windSpeed: horizontal drift
 * - thickness: how "puffy" clouds look
 * - opacity: overall cloud layer opacity
 */

const CloudDomeShader = {
  uniforms: {
    uTime: { value: 0 },
    uCoverage: { value: 0.45 },
    uThickness: { value: 1.0 },
    uOpacity: { value: 0.9 },
    uCloudColor: { value: new THREE.Color(1.0, 1.0, 1.0) },
    uCloudDarkColor: { value: new THREE.Color(0.6, 0.65, 0.7) },
    uWindSpeed: { value: new THREE.Vector2(0.01, 0.005) },
    uSunDirection: { value: new THREE.Vector3(0.6, 0.8, 0.4).normalize() },
  },

  vertexShader: /* glsl */ `
    varying vec3 vWorldPos;
    varying vec3 vNormal;

    void main() {
      vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
      vNormal = normalize((modelMatrix * vec4(normal, 0.0)).xyz);
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,

  fragmentShader: /* glsl */ `
    uniform float uTime;
    uniform float uCoverage;
    uniform float uThickness;
    uniform float uOpacity;
    uniform vec3 uCloudColor;
    uniform vec3 uCloudDarkColor;
    uniform vec2 uWindSpeed;
    uniform vec3 uSunDirection;

    varying vec3 vWorldPos;
    varying vec3 vNormal;

    // Hash-based noise
    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
    }

    float noise(vec2 p) {
      vec2 i = floor(p);
      vec2 f = fract(p);
      f = f * f * (3.0 - 2.0 * f);
      float a = hash(i);
      float b = hash(i + vec2(1.0, 0.0));
      float c = hash(i + vec2(0.0, 1.0));
      float d = hash(i + vec2(1.0, 1.0));
      return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
    }

    // Fractal Brownian Motion — 5 octaves
    float fbm(vec2 p) {
      float value = 0.0;
      float amplitude = 0.5;
      float frequency = 1.0;
      for (int i = 0; i < 5; i++) {
        value += amplitude * noise(p * frequency);
        frequency *= 2.0;
        amplitude *= 0.5;
      }
      return value;
    }

    void main() {
      // Project world position onto the dome surface for UV
      vec3 dir = normalize(vWorldPos);

      // Only draw clouds in the upper hemisphere
      if (dir.y < 0.01) discard;

      // Map direction to 2D coords for noise sampling
      vec2 uv = dir.xz / (dir.y + 0.5);
      uv *= 3.0; // Scale for cloud detail

      // Animate with wind
      vec2 windOffset = uWindSpeed * uTime;
      float n = fbm(uv + windOffset);
      // Second layer for detail
      float n2 = fbm(uv * 2.5 + windOffset * 1.3 + vec2(5.2, 1.3));

      // Combine noise layers
      float cloudNoise = n * 0.6 + n2 * 0.4;

      // Apply coverage threshold: higher coverage = more clouds
      float threshold = 1.0 - uCoverage;
      float cloud = smoothstep(threshold - 0.1, threshold + 0.15 * uThickness, cloudNoise);

      if (cloud < 0.01) discard;

      // Simple lighting: brighter on sun-facing side
      float sunDot = dot(dir, uSunDirection) * 0.5 + 0.5;
      vec3 color = mix(uCloudDarkColor, uCloudColor, sunDot * 0.6 + 0.4);

      // Add depth variation from second noise layer
      float depth = n2 * cloud;
      color = mix(color, uCloudDarkColor, depth * 0.3);

      // Fade at horizon to avoid hard cutoff
      float horizonFade = smoothstep(0.0, 0.15, dir.y);

      float alpha = cloud * uOpacity * horizonFade;
      gl_FragColor = vec4(color, alpha);
    }
  `,
};

export class CloudDome {
  readonly mesh: THREE.Mesh;
  private material: THREE.ShaderMaterial;

  constructor() {
    this.material = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.clone(CloudDomeShader.uniforms),
      vertexShader: CloudDomeShader.vertexShader,
      fragmentShader: CloudDomeShader.fragmentShader,
      transparent: true,
      depthWrite: false,
      side: THREE.BackSide,
    });

    // Large hemisphere dome
    const geometry = new THREE.SphereGeometry(350, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2);
    this.mesh = new THREE.Mesh(geometry, this.material);
    this.mesh.renderOrder = -1; // Render before scene
    this.mesh.frustumCulled = false;
  }

  /** Follow the camera so the dome always surrounds the player */
  update(dt: number, cameraPos: { x: number; y: number; z: number }): void {
    this.material.uniforms.uTime.value += dt;
    this.mesh.position.set(cameraPos.x, 0, cameraPos.z);
  }

  /** Set cloud coverage from 0 (clear sky) to 1 (fully overcast) */
  set coverage(v: number) {
    this.material.uniforms.uCoverage.value = Math.max(0, Math.min(1, v));
  }
  get coverage(): number {
    return this.material.uniforms.uCoverage.value as number;
  }

  /** Set cloud layer opacity */
  set opacity(v: number) {
    this.material.uniforms.uOpacity.value = Math.max(0, Math.min(1, v));
  }
  get opacity(): number {
    return this.material.uniforms.uOpacity.value as number;
  }

  /** Set thickness — how puffy/defined clouds appear */
  set thickness(v: number) {
    this.material.uniforms.uThickness.value = v;
  }
  get thickness(): number {
    return this.material.uniforms.uThickness.value as number;
  }

  /** Set wind speed (x, z) */
  setWind(x: number, z: number): void {
    (this.material.uniforms.uWindSpeed.value as THREE.Vector2).set(x, z);
  }

  /** Set cloud colors */
  setColors(bright: THREE.Color, dark: THREE.Color): void {
    (this.material.uniforms.uCloudColor.value as THREE.Color).copy(bright);
    (this.material.uniforms.uCloudDarkColor.value as THREE.Color).copy(dark);
  }

  /** Update sun direction for cloud lighting */
  setSunDirection(dir: THREE.Vector3): void {
    (this.material.uniforms.uSunDirection.value as THREE.Vector3).copy(dir).normalize();
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
