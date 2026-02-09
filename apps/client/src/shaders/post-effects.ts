import * as THREE from 'three';

/** Simple vertex shader shared by all full-screen post-effect passes. */
const fullscreenVert = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// ---------------------------------------------------------------------------
// Vignette — darken screen edges for a cinematic / goggle look
// ---------------------------------------------------------------------------

export const VignetteShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    darkness: { value: 0.35 },
  },
  vertexShader: fullscreenVert,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float darkness;
    varying vec2 vUv;

    void main() {
      vec4 color = texture2D(tDiffuse, vUv);
      vec2 uv = (vUv - 0.5) * 2.0;
      float vig = 1.0 - dot(uv, uv) * darkness;
      color.rgb *= clamp(vig, 0.0, 1.0);
      gl_FragColor = color;
    }
  `,
};

// ---------------------------------------------------------------------------
// Color grading — desaturation, contrast boost, cool shadows / warm highlights
// ---------------------------------------------------------------------------

export const ColorGradeShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    saturation: { value: 0.85 },
    contrast: { value: 1.1 },
    brightness: { value: 0.0 },
  },
  vertexShader: fullscreenVert,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float saturation;
    uniform float contrast;
    uniform float brightness;
    varying vec2 vUv;

    void main() {
      vec4 color = texture2D(tDiffuse, vUv);

      // Brightness
      color.rgb += brightness;

      // Contrast (pivot around mid-grey)
      color.rgb = (color.rgb - 0.5) * contrast + 0.5;

      // Saturation
      float lum = dot(color.rgb, vec3(0.299, 0.587, 0.114));
      color.rgb = mix(vec3(lum), color.rgb, saturation);

      // Cool tint in shadows, warm tint in highlights (military look)
      color.rgb += mix(vec3(-0.02, 0.0, 0.03), vec3(0.02, 0.01, -0.01), lum);

      gl_FragColor = color;
    }
  `,
};

// ---------------------------------------------------------------------------
// Film grain — animated per-pixel noise for gritty war-footage feel
// ---------------------------------------------------------------------------

export const FilmGrainShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    time: { value: 0.0 },
    intensity: { value: 0.04 },
  },
  vertexShader: fullscreenVert,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float time;
    uniform float intensity;
    varying vec2 vUv;

    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
    }

    void main() {
      vec4 color = texture2D(tDiffuse, vUv);
      float noise = hash(vUv * 1000.0 + time) * 2.0 - 1.0;
      color.rgb += noise * intensity;
      gl_FragColor = color;
    }
  `,
};

// ---------------------------------------------------------------------------
// Chromatic aberration — subtle RGB split at screen edges (lens effect)
// ---------------------------------------------------------------------------

export const ChromaticAberrationShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    strength: { value: 0.0015 },
  },
  vertexShader: fullscreenVert,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float strength;
    varying vec2 vUv;

    void main() {
      vec2 dir = vUv - 0.5;
      float dist = length(dir);
      vec2 offset = dir * dist * strength;

      float r = texture2D(tDiffuse, vUv + offset).r;
      float g = texture2D(tDiffuse, vUv).g;
      float b = texture2D(tDiffuse, vUv - offset).b;
      float a = texture2D(tDiffuse, vUv).a;

      gl_FragColor = vec4(r, g, b, a);
    }
  `,
};
