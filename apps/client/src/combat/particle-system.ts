import * as THREE from 'three';
import type { Vec3 } from '@clawfield/shared';
import { GRAVITY } from '@clawfield/shared';

/** Maximum number of particles in the pool */
const MAX_PARTICLES = 2000;

/** CPU-side particle state (velocities and timing not stored in GPU buffers) */
interface Particle {
  alive: boolean;
  age: number;
  lifetime: number;
  velX: number;
  velY: number;
  velZ: number;
  gravityScale: number;
}

/** Configuration for emitting a burst of particles */
export interface EmitConfig {
  /** World position to spawn particles at */
  position: Vec3;
  /** Number of particles to spawn */
  count: number;
  /** Base direction for the emission cone (omit for spherical) */
  direction?: Vec3;
  /** Speed range [min, max] m/s */
  speedMin: number;
  speedMax: number;
  /** Cone half-angle in radians (PI = hemisphere, 2*PI = full sphere) */
  spread: number;
  /** Lifetime range [min, max] seconds */
  lifetimeMin: number;
  lifetimeMax: number;
  /** Point size range [min, max] */
  sizeMin: number;
  sizeMax: number;
  /** Colors to pick randomly from (r, g, b in 0-1 range) */
  colors: [number, number, number][];
  /** How much gravity affects particles (0 = none, 1 = full). Default 1 */
  gravityScale?: number;
}

/**
 * GPU-efficient pooled particle system using THREE.Points.
 *
 * Uses a single draw call for all particles. Dead particles have alpha=0
 * and are effectively invisible. Custom ShaderMaterial provides per-particle
 * color, size, and alpha with additive blending for bright spark effects.
 */
export class ParticleSystem {
  private scene: THREE.Scene;
  private particles: Particle[];
  private points: THREE.Points;

  private positions: Float32Array;
  private colors: Float32Array;
  private sizes: Float32Array;
  private alphas: Float32Array;

  private posAttr: THREE.BufferAttribute;
  private colorAttr: THREE.BufferAttribute;
  private sizeAttr: THREE.BufferAttribute;
  private alphaAttr: THREE.BufferAttribute;

  private aliveCount = 0;

  constructor(scene: THREE.Scene) {
    this.scene = scene;

    // Allocate CPU-side particle pool
    this.particles = new Array(MAX_PARTICLES);
    for (let i = 0; i < MAX_PARTICLES; i++) {
      this.particles[i] = {
        alive: false,
        age: 0,
        lifetime: 0,
        velX: 0,
        velY: 0,
        velZ: 0,
        gravityScale: 0,
      };
    }

    // Allocate GPU buffer arrays
    this.positions = new Float32Array(MAX_PARTICLES * 3);
    this.colors = new Float32Array(MAX_PARTICLES * 3);
    this.sizes = new Float32Array(MAX_PARTICLES);
    this.alphas = new Float32Array(MAX_PARTICLES);

    // Build geometry with dynamic buffer attributes
    const geometry = new THREE.BufferGeometry();

    this.posAttr = new THREE.BufferAttribute(this.positions, 3);
    this.colorAttr = new THREE.BufferAttribute(this.colors, 3);
    this.sizeAttr = new THREE.BufferAttribute(this.sizes, 1);
    this.alphaAttr = new THREE.BufferAttribute(this.alphas, 1);

    this.posAttr.setUsage(THREE.DynamicDrawUsage);
    this.colorAttr.setUsage(THREE.DynamicDrawUsage);
    this.sizeAttr.setUsage(THREE.DynamicDrawUsage);
    this.alphaAttr.setUsage(THREE.DynamicDrawUsage);

    geometry.setAttribute('position', this.posAttr);
    geometry.setAttribute('aColor', this.colorAttr);
    geometry.setAttribute('aSize', this.sizeAttr);
    geometry.setAttribute('aAlpha', this.alphaAttr);

    // Custom shader: per-particle color + alpha + size, additive blending
    const material = new THREE.ShaderMaterial({
      uniforms: {},
      vertexShader: /* glsl */ `
        attribute float aSize;
        attribute float aAlpha;
        attribute vec3 aColor;
        varying float vAlpha;
        varying vec3 vColor;

        void main() {
          vAlpha = aAlpha;
          vColor = aColor;
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aSize * (200.0 / -mvPosition.z);
          gl_PointSize = clamp(gl_PointSize, 1.0, 64.0);
          gl_Position = projectionMatrix * mvPosition;
        }
      `,
      fragmentShader: /* glsl */ `
        varying float vAlpha;
        varying vec3 vColor;

        void main() {
          float dist = length(gl_PointCoord - vec2(0.5));
          if (dist > 0.5) discard;
          float edge = 1.0 - smoothstep(0.3, 0.5, dist);
          gl_FragColor = vec4(vColor, vAlpha * edge);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    this.points = new THREE.Points(geometry, material);
    this.points.frustumCulled = false;
    this.scene.add(this.points);

    // Initialise all positions off-screen with zero alpha
    for (let i = 0; i < MAX_PARTICLES; i++) {
      this.positions[i * 3 + 1] = -1000;
      this.alphas[i] = 0;
      this.sizes[i] = 0;
    }
  }

  /** Emit a burst of particles with the given configuration */
  emit(config: EmitConfig): void {
    const {
      position,
      count,
      direction,
      speedMin,
      speedMax,
      spread,
      lifetimeMin,
      lifetimeMax,
      sizeMin,
      sizeMax,
      colors,
      gravityScale = 1,
    } = config;

    let spawned = 0;
    for (let i = 0; i < MAX_PARTICLES && spawned < count; i++) {
      if (this.particles[i].alive) continue;

      const p = this.particles[i];
      p.alive = true;
      p.age = 0;
      p.lifetime = lifetimeMin + Math.random() * (lifetimeMax - lifetimeMin);
      p.gravityScale = gravityScale;

      // Compute random direction within the emission cone
      let dx: number, dy: number, dz: number;

      if (direction && spread < Math.PI * 2) {
        // Cone distribution around the given direction
        const theta = Math.random() * spread;
        const phi = Math.random() * Math.PI * 2;

        const dirLen = Math.sqrt(
          direction.x * direction.x +
          direction.y * direction.y +
          direction.z * direction.z,
        );
        const ndx = direction.x / dirLen;
        const ndy = direction.y / dirLen;
        const ndz = direction.z / dirLen;

        // Build local coordinate frame around direction
        let upX = 0, upY = 1, upZ = 0;
        if (Math.abs(ndy) > 0.99) { upX = 1; upY = 0; upZ = 0; }

        let rx = ndy * upZ - ndz * upY;
        let ry = ndz * upX - ndx * upZ;
        let rz = ndx * upY - ndy * upX;
        const rLen = Math.sqrt(rx * rx + ry * ry + rz * rz);
        rx /= rLen; ry /= rLen; rz /= rLen;

        const ax = ry * ndz - rz * ndy;
        const ay = rz * ndx - rx * ndz;
        const az = rx * ndy - ry * ndx;

        const sinTheta = Math.sin(theta);
        const cosTheta = Math.cos(theta);
        const cosPhi = Math.cos(phi);
        const sinPhi = Math.sin(phi);

        dx = ndx * cosTheta + (rx * cosPhi + ax * sinPhi) * sinTheta;
        dy = ndy * cosTheta + (ry * cosPhi + ay * sinPhi) * sinTheta;
        dz = ndz * cosTheta + (rz * cosPhi + az * sinPhi) * sinTheta;
      } else {
        // Uniform spherical distribution
        const cosT = 2 * Math.random() - 1;
        const sinT = Math.sqrt(1 - cosT * cosT);
        const phi = Math.random() * Math.PI * 2;
        dx = sinT * Math.cos(phi);
        dy = sinT * Math.sin(phi);
        dz = cosT;
      }

      const speed = speedMin + Math.random() * (speedMax - speedMin);
      p.velX = dx * speed;
      p.velY = dy * speed;
      p.velZ = dz * speed;

      // Set GPU buffer data
      const idx3 = i * 3;
      this.positions[idx3] = position.x;
      this.positions[idx3 + 1] = position.y;
      this.positions[idx3 + 2] = position.z;

      const color = colors[Math.floor(Math.random() * colors.length)];
      this.colors[idx3] = color[0];
      this.colors[idx3 + 1] = color[1];
      this.colors[idx3 + 2] = color[2];

      this.sizes[i] = sizeMin + Math.random() * (sizeMax - sizeMin);
      this.alphas[i] = 1.0;

      spawned++;
      this.aliveCount++;
    }
  }

  /** Advance all particles by dt seconds */
  update(dt: number): void {
    if (this.aliveCount === 0) return;

    let alive = 0;

    for (let i = 0; i < MAX_PARTICLES; i++) {
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

      // Apply gravity
      p.velY += GRAVITY * p.gravityScale * dt;

      // Integrate position
      const idx3 = i * 3;
      this.positions[idx3] += p.velX * dt;
      this.positions[idx3 + 1] += p.velY * dt;
      this.positions[idx3 + 2] += p.velZ * dt;

      // Fade alpha over lifetime
      const progress = p.age / p.lifetime;
      this.alphas[i] = 1.0 - progress;
    }

    this.aliveCount = alive;

    // Upload modified buffers to GPU
    this.posAttr.needsUpdate = true;
    this.alphaAttr.needsUpdate = true;
    this.sizeAttr.needsUpdate = true;
    this.colorAttr.needsUpdate = true;
  }

  /** Clean up all GPU resources */
  dispose(): void {
    this.scene.remove(this.points);
    this.points.geometry.dispose();
    (this.points.material as THREE.ShaderMaterial).dispose();
  }
}
