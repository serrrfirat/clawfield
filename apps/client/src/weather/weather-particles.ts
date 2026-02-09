import * as THREE from 'three';

/**
 * Dedicated weather particle system for rain and snow.
 *
 * Separate from the combat ParticleSystem so weather doesn't compete for
 * the combat particle pool. Uses the same GPU-efficient THREE.Points approach
 * but with a larger pool, no additive blending (rain/snow aren't glowing),
 * and continuous emission around the camera.
 */

const MAX_WEATHER_PARTICLES = 4000;

/** Per-particle CPU state */
interface WeatherParticle {
  alive: boolean;
  age: number;
  lifetime: number;
  velX: number;
  velY: number;
  velZ: number;
}

export type WeatherType = 'none' | 'rain' | 'snow';

/** Tuning parameters per weather type */
interface WeatherPreset {
  /** Particles emitted per second */
  emitRate: number;
  /** Spawn radius around camera (XZ) */
  spawnRadius: number;
  /** Spawn height above camera */
  spawnHeight: number;
  /** Vertical fall speed range [min, max] (negative = downward) */
  fallSpeedMin: number;
  fallSpeedMax: number;
  /** Horizontal drift range (wind wobble) */
  driftX: number;
  driftZ: number;
  /** Particle lifetime seconds */
  lifetimeMin: number;
  lifetimeMax: number;
  /** Point size range */
  sizeMin: number;
  sizeMax: number;
  /** Color (r, g, b in 0-1) */
  color: [number, number, number];
  /** Alpha */
  alpha: number;
}

const PRESETS: Record<'rain' | 'snow', WeatherPreset> = {
  rain: {
    emitRate: 1200,
    spawnRadius: 60,
    spawnHeight: 50,
    fallSpeedMin: -25,
    fallSpeedMax: -20,
    driftX: 1.5,
    driftZ: 0.5,
    lifetimeMin: 1.5,
    lifetimeMax: 2.5,
    sizeMin: 0.08,
    sizeMax: 0.15,
    color: [0.7, 0.75, 0.85],
    alpha: 0.5,
  },
  snow: {
    emitRate: 400,
    spawnRadius: 50,
    spawnHeight: 40,
    fallSpeedMin: -3,
    fallSpeedMax: -1.5,
    driftX: 1.0,
    driftZ: 0.8,
    lifetimeMin: 4,
    lifetimeMax: 8,
    sizeMin: 0.1,
    sizeMax: 0.25,
    color: [0.95, 0.95, 1.0],
    alpha: 0.8,
  },
};

export class WeatherParticles {
  private scene: THREE.Scene;
  private particles: WeatherParticle[];
  private points: THREE.Points;

  private positions: Float32Array;
  private alphas: Float32Array;
  private sizes: Float32Array;

  private posAttr: THREE.BufferAttribute;
  private alphaAttr: THREE.BufferAttribute;
  private sizeAttr: THREE.BufferAttribute;

  private aliveCount = 0;
  private emitAccumulator = 0;

  /** Current active weather type */
  weatherType: WeatherType = 'none';

  /** Intensity multiplier 0-1 (scales emit rate and alpha) */
  intensity = 1.0;

  constructor(scene: THREE.Scene) {
    this.scene = scene;

    this.particles = new Array(MAX_WEATHER_PARTICLES);
    for (let i = 0; i < MAX_WEATHER_PARTICLES; i++) {
      this.particles[i] = {
        alive: false,
        age: 0,
        lifetime: 0,
        velX: 0,
        velY: 0,
        velZ: 0,
      };
    }

    this.positions = new Float32Array(MAX_WEATHER_PARTICLES * 3);
    this.alphas = new Float32Array(MAX_WEATHER_PARTICLES);
    this.sizes = new Float32Array(MAX_WEATHER_PARTICLES);

    const geometry = new THREE.BufferGeometry();

    this.posAttr = new THREE.BufferAttribute(this.positions, 3);
    this.alphaAttr = new THREE.BufferAttribute(this.alphas, 1);
    this.sizeAttr = new THREE.BufferAttribute(this.sizes, 1);

    this.posAttr.setUsage(THREE.DynamicDrawUsage);
    this.alphaAttr.setUsage(THREE.DynamicDrawUsage);
    this.sizeAttr.setUsage(THREE.DynamicDrawUsage);

    geometry.setAttribute('position', this.posAttr);
    geometry.setAttribute('aAlpha', this.alphaAttr);
    geometry.setAttribute('aSize', this.sizeAttr);

    const material = new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: new THREE.Vector3(0.7, 0.75, 0.85) },
      },
      vertexShader: /* glsl */ `
        attribute float aSize;
        attribute float aAlpha;
        varying float vAlpha;

        void main() {
          vAlpha = aAlpha;
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aSize * (200.0 / -mvPosition.z);
          gl_PointSize = clamp(gl_PointSize, 1.0, 32.0);
          gl_Position = projectionMatrix * mvPosition;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        varying float vAlpha;

        void main() {
          float dist = length(gl_PointCoord - vec2(0.5));
          if (dist > 0.5) discard;
          float edge = 1.0 - smoothstep(0.3, 0.5, dist);
          gl_FragColor = vec4(uColor, vAlpha * edge);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
    });

    this.points = new THREE.Points(geometry, material);
    this.points.frustumCulled = false;
    this.scene.add(this.points);

    // Init off-screen
    for (let i = 0; i < MAX_WEATHER_PARTICLES; i++) {
      this.positions[i * 3 + 1] = -1000;
      this.alphas[i] = 0;
      this.sizes[i] = 0;
    }
  }

  /** Call every frame with dt and camera position */
  update(dt: number, cameraPos: { x: number; y: number; z: number }): void {
    if (this.weatherType === 'none') {
      // Kill all remaining particles naturally
      this._updateExisting(dt);
      return;
    }

    const preset = PRESETS[this.weatherType];

    // Update color uniform
    const mat = this.points.material as THREE.ShaderMaterial;
    (mat.uniforms.uColor.value as THREE.Vector3).set(
      preset.color[0],
      preset.color[1],
      preset.color[2],
    );

    // Emit new particles
    this.emitAccumulator += preset.emitRate * this.intensity * dt;
    const toEmit = Math.floor(this.emitAccumulator);
    this.emitAccumulator -= toEmit;

    let spawned = 0;
    for (let i = 0; i < MAX_WEATHER_PARTICLES && spawned < toEmit; i++) {
      if (this.particles[i].alive) continue;

      const p = this.particles[i];
      p.alive = true;
      p.age = 0;
      p.lifetime =
        preset.lifetimeMin + Math.random() * (preset.lifetimeMax - preset.lifetimeMin);

      // Random velocity
      p.velX = (Math.random() - 0.5) * preset.driftX * 2;
      p.velY =
        preset.fallSpeedMin + Math.random() * (preset.fallSpeedMax - preset.fallSpeedMin);
      p.velZ = (Math.random() - 0.5) * preset.driftZ * 2;

      // Spawn in a random position around the camera
      const angle = Math.random() * Math.PI * 2;
      const radius = Math.random() * preset.spawnRadius;
      const idx3 = i * 3;
      this.positions[idx3] = cameraPos.x + Math.cos(angle) * radius;
      this.positions[idx3 + 1] = cameraPos.y + preset.spawnHeight + (Math.random() - 0.5) * 10;
      this.positions[idx3 + 2] = cameraPos.z + Math.sin(angle) * radius;

      this.sizes[i] =
        preset.sizeMin + Math.random() * (preset.sizeMax - preset.sizeMin);
      this.alphas[i] = preset.alpha * this.intensity;

      spawned++;
      this.aliveCount++;
    }

    this._updateExisting(dt);
  }

  /** Advance all alive particles */
  private _updateExisting(dt: number): void {
    if (this.aliveCount === 0) return;

    let alive = 0;
    for (let i = 0; i < MAX_WEATHER_PARTICLES; i++) {
      const p = this.particles[i];
      if (!p.alive) continue;

      p.age += dt;
      if (p.age >= p.lifetime) {
        p.alive = false;
        this.alphas[i] = 0;
        this.sizes[i] = 0;
        this.positions[i * 3 + 1] = -1000;
        continue;
      }

      alive++;
      const idx3 = i * 3;
      this.positions[idx3] += p.velX * dt;
      this.positions[idx3 + 1] += p.velY * dt;
      this.positions[idx3 + 2] += p.velZ * dt;

      // Fade out near end of life
      const progress = p.age / p.lifetime;
      if (progress > 0.8) {
        this.alphas[i] *= 1.0 - (progress - 0.8) / 0.2 * dt * 3;
      }
    }

    this.aliveCount = alive;

    this.posAttr.needsUpdate = true;
    this.alphaAttr.needsUpdate = true;
    this.sizeAttr.needsUpdate = true;
  }

  dispose(): void {
    this.scene.remove(this.points);
    this.points.geometry.dispose();
    (this.points.material as THREE.ShaderMaterial).dispose();
  }
}
