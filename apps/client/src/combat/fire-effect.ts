import * as THREE from 'three'

const MAX_FIRES = 8

interface ActiveFire {
  group: THREE.Group
  materials: THREE.ShaderMaterial[]
  elapsed: number
  lifetime: number
}

// Procedural fire shader — layered noise, no texture dependency
const FIRE_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  // Billboard: face camera
  vec4 viewPos = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  viewPos.xy += position.xy * vec2(length(modelMatrix[0].xyz), length(modelMatrix[1].xyz));
  gl_Position = projectionMatrix * viewPos;
}
`

const FIRE_FRAGMENT = /* glsl */ `
uniform float uTime;
uniform float uOpacity;
varying vec2 vUv;

// Simple 2D hash noise
vec2 hash22(vec2 p) {
  p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
  return -1.0 + 2.0 * fract(sin(p) * 43758.5453123);
}

float noise2(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(dot(hash22(i + vec2(0.0, 0.0)), f - vec2(0.0, 0.0)),
        dot(hash22(i + vec2(1.0, 0.0)), f - vec2(1.0, 0.0)), u.x),
    mix(dot(hash22(i + vec2(0.0, 1.0)), f - vec2(0.0, 1.0)),
        dot(hash22(i + vec2(1.0, 1.0)), f - vec2(1.0, 1.0)), u.x),
    u.y
  );
}

void main() {
  vec2 uv = vUv;

  // Scroll upward
  vec2 q = uv * 3.0 + vec2(0.0, -uTime * 2.0);
  float n1 = noise2(q);
  float n2 = noise2(uv * 6.0 + vec2(0.0, -uTime * 3.0));

  // Fire shape: tapers at top, solid at bottom
  float shape = 1.0 - uv.y;
  shape *= smoothstep(0.0, 0.15, uv.x) * smoothstep(1.0, 0.85, uv.x);
  float fire = shape * (0.5 + 0.5 * n1 + 0.25 * n2);
  fire = clamp(fire * 1.8, 0.0, 1.0);

  // Color ramp: white core -> yellow -> orange -> red -> transparent
  vec3 col;
  if (fire > 0.8) {
    col = mix(vec3(1.0, 0.95, 0.7), vec3(1.0, 1.0, 0.9), (fire - 0.8) / 0.2);
  } else if (fire > 0.5) {
    col = mix(vec3(1.0, 0.6, 0.1), vec3(1.0, 0.95, 0.7), (fire - 0.5) / 0.3);
  } else if (fire > 0.2) {
    col = mix(vec3(0.8, 0.2, 0.05), vec3(1.0, 0.6, 0.1), (fire - 0.2) / 0.3);
  } else {
    col = vec3(0.8, 0.2, 0.05) * (fire / 0.2);
  }

  // Flicker
  float flicker = 0.85 + 0.15 * sin(uTime * 12.0 + n1 * 6.0);

  float alpha = fire * uOpacity * flicker;
  if (alpha < 0.02) discard;
  gl_FragColor = vec4(col * flicker, alpha);
}
`

export class FireEffectSystem {
  private scene: THREE.Scene
  private fires: ActiveFire[] = []
  private geometry: THREE.PlaneGeometry

  constructor(scene: THREE.Scene) {
    this.scene = scene
    this.geometry = new THREE.PlaneGeometry(1, 1)
  }

  spawn(position: THREE.Vector3, scale: number, lifetime: number): void {
    // Enforce pool limit
    while (this.fires.length >= MAX_FIRES) {
      const oldest = this.fires.shift()!
      this.removeFire(oldest)
    }

    const group = new THREE.Group()
    group.position.copy(position)
    group.position.y += scale * 0.3 // lift slightly above ground

    const materials: THREE.ShaderMaterial[] = []
    const count = 3 + Math.floor(Math.random() * 3) // 3-5 sprites

    for (let i = 0; i < count; i++) {
      const mat = new THREE.ShaderMaterial({
        uniforms: {
          uTime: { value: Math.random() * 10 }, // random start phase for variety
          uOpacity: { value: 1.0 },
        },
        vertexShader: FIRE_VERTEX,
        fragmentShader: FIRE_FRAGMENT,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
      })
      materials.push(mat)

      const mesh = new THREE.Mesh(this.geometry, mat)
      const s = scale * (0.7 + Math.random() * 0.6)
      mesh.scale.set(s, s * (1.2 + Math.random() * 0.4), 1)
      mesh.position.set(
        (Math.random() - 0.5) * scale * 0.4,
        Math.random() * scale * 0.2,
        (Math.random() - 0.5) * scale * 0.4,
      )
      // Random Y rotation so they don't all face the same way
      mesh.rotation.y = Math.random() * Math.PI
      group.add(mesh)
    }

    this.scene.add(group)
    this.fires.push({ group, materials, elapsed: 0, lifetime })
  }

  update(dt: number): void {
    for (let i = this.fires.length - 1; i >= 0; i--) {
      const fire = this.fires[i]
      fire.elapsed += dt

      const progress = fire.elapsed / fire.lifetime
      // Fade out in last 40% of lifetime
      const opacity = progress > 0.6 ? 1 - (progress - 0.6) / 0.4 : 1

      for (const mat of fire.materials) {
        mat.uniforms.uTime.value += dt
        mat.uniforms.uOpacity.value = Math.max(0, opacity)
      }

      if (fire.elapsed >= fire.lifetime) {
        this.removeFire(fire)
        this.fires.splice(i, 1)
      }
    }
  }

  private removeFire(fire: ActiveFire): void {
    this.scene.remove(fire.group)
    for (const mat of fire.materials) {
      mat.dispose()
    }
  }

  dispose(): void {
    for (const fire of this.fires) {
      this.removeFire(fire)
    }
    this.fires.length = 0
    this.geometry.dispose()
  }
}
