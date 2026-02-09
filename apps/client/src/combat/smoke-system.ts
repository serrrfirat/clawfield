import * as THREE from 'three';
import type { Vec3 } from '@clawfield/shared';

/** Maximum number of billboard puffs across all smoke clouds */
const MAX_PUFFS = 512;

/** Number of billboard puffs per smoke cloud */
const PUFFS_PER_CLOUD = 24;

/** Maximum simultaneous smoke clouds */
const MAX_CLOUDS = Math.floor(MAX_PUFFS / PUFFS_PER_CLOUD);

/** Time for smoke to fully expand (seconds) */
const EXPAND_TIME = 2.0;

/** Time for smoke to fade out at end of lifetime (seconds) */
const FADE_OUT_TIME = 3.0;

/** Time for smoke to fade in at start (seconds) */
const FADE_IN_TIME = 0.8;

/** Upward drift speed for smoke puffs (m/s) */
const DRIFT_UP_SPEED = 0.3;

/** Turbulence strength — how much puffs wobble */
const TURBULENCE = 0.4;

/** Smoke puff color (light gray) */
const SMOKE_COLOR = new THREE.Color(0.78, 0.78, 0.76);

/** Explosion smoke color (darker gray-brown) */
const EXPLOSION_SMOKE_COLOR = new THREE.Color(0.4, 0.38, 0.35);

/** Per-puff CPU data */
interface PuffData {
  alive: boolean;
  cloudIndex: number;
  /** Offset from cloud center in local space */
  localX: number;
  localY: number;
  localZ: number;
  /** Current world position */
  worldX: number;
  worldY: number;
  worldZ: number;
  /** Billboard size */
  size: number;
  maxSize: number;
  /** Alpha */
  baseAlpha: number;
  /** Rotation */
  rotation: number;
  rotationSpeed: number;
  /** Slow drift velocity */
  driftX: number;
  driftY: number;
  driftZ: number;
  /** Noise phase offset for turbulence */
  noisePhase: number;
}

/** Tracked smoke cloud */
interface SmokeCloud {
  active: boolean;
  centerX: number;
  centerY: number;
  centerZ: number;
  age: number;
  lifetime: number;
  maxRadius: number;
  puffStart: number;
  puffCount: number;
  color: THREE.Color;
}

/**
 * Volumetric smoke rendering system using instanced camera-facing billboards.
 *
 * Each smoke cloud is a cluster of overlapping semi-transparent quads
 * with procedural noise edges, giving a convincing volumetric appearance.
 * Uses a single draw call via THREE.InstancedMesh for performance.
 */
export class SmokeSystem {
  private scene: THREE.Scene;
  private camera: THREE.Camera;

  private clouds: SmokeCloud[];
  private puffs: PuffData[];
  private mesh: THREE.InstancedMesh;
  private dummy = new THREE.Object3D();

  /** Per-instance alpha attribute */
  private instanceAlphas: Float32Array;
  private alphaAttr: THREE.InstancedBufferAttribute;

  /** Per-instance color attribute */
  private instanceColors: Float32Array;
  private colorAttr: THREE.InstancedBufferAttribute;

  /** Elapsed time for shader animation */
  private elapsedTime = 0;

  constructor(scene: THREE.Scene, camera: THREE.Camera) {
    this.scene = scene;
    this.camera = camera;

    // Init cloud pool
    this.clouds = new Array(MAX_CLOUDS);
    for (let i = 0; i < MAX_CLOUDS; i++) {
      this.clouds[i] = {
        active: false,
        centerX: 0,
        centerY: 0,
        centerZ: 0,
        age: 0,
        lifetime: 0,
        maxRadius: 0,
        puffStart: i * PUFFS_PER_CLOUD,
        puffCount: PUFFS_PER_CLOUD,
        color: SMOKE_COLOR.clone(),
      };
    }

    // Init puff pool
    this.puffs = new Array(MAX_PUFFS);
    for (let i = 0; i < MAX_PUFFS; i++) {
      this.puffs[i] = {
        alive: false,
        cloudIndex: -1,
        localX: 0,
        localY: 0,
        localZ: 0,
        worldX: 0,
        worldY: -1000,
        worldZ: 0,
        size: 0,
        maxSize: 1,
        baseAlpha: 0,
        rotation: 0,
        rotationSpeed: 0,
        driftX: 0,
        driftY: 0,
        driftZ: 0,
        noisePhase: 0,
      };
    }

    // Billboard quad geometry
    const geometry = new THREE.PlaneGeometry(1, 1);

    // Custom shader material for volumetric-looking smoke puffs
    const material = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
      },
      vertexShader: /* glsl */ `
        attribute float aAlpha;
        attribute vec3 aColor;
        varying float vAlpha;
        varying vec2 vUv;
        varying vec3 vColor;

        void main() {
          vAlpha = aAlpha;
          vUv = uv;
          vColor = aColor;
          gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        varying float vAlpha;
        varying vec2 vUv;
        varying vec3 vColor;

        // Simple hash-based noise for organic edges
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

        float fbm(vec2 p) {
          float v = 0.0;
          v += 0.5 * noise(p); p *= 2.01;
          v += 0.25 * noise(p); p *= 2.02;
          v += 0.125 * noise(p);
          return v;
        }

        void main() {
          vec2 center = vUv - 0.5;
          float dist = length(center);

          // Base radial falloff — soft circle
          float radial = 1.0 - smoothstep(0.15, 0.5, dist);

          // Apply noise to break up the circular shape
          float n = fbm(center * 4.0 + uTime * 0.1);
          float noisyAlpha = radial * (0.6 + 0.4 * n);

          // Final alpha
          float alpha = noisyAlpha * vAlpha;
          if (alpha < 0.01) discard;

          // Slightly lighter in center, darker at edges
          vec3 color = vColor * (0.9 + 0.1 * radial);

          gl_FragColor = vec4(color, alpha);
        }
      `,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.NormalBlending,
    });

    this.mesh = new THREE.InstancedMesh(geometry, material, MAX_PUFFS);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 10; // Render after opaque geometry

    // Per-instance alpha
    this.instanceAlphas = new Float32Array(MAX_PUFFS);
    this.alphaAttr = new THREE.InstancedBufferAttribute(this.instanceAlphas, 1);
    this.alphaAttr.setUsage(THREE.DynamicDrawUsage);
    this.mesh.geometry.setAttribute('aAlpha', this.alphaAttr);

    // Per-instance color
    this.instanceColors = new Float32Array(MAX_PUFFS * 3);
    this.colorAttr = new THREE.InstancedBufferAttribute(this.instanceColors, 3);
    this.colorAttr.setUsage(THREE.DynamicDrawUsage);
    this.mesh.geometry.setAttribute('aColor', this.colorAttr);

    // Initialize all puffs as invisible
    for (let i = 0; i < MAX_PUFFS; i++) {
      this.dummy.position.set(0, -1000, 0);
      this.dummy.scale.set(0, 0, 0);
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(i, this.dummy.matrix);
      this.instanceAlphas[i] = 0;
      this.instanceColors[i * 3] = SMOKE_COLOR.r;
      this.instanceColors[i * 3 + 1] = SMOKE_COLOR.g;
      this.instanceColors[i * 3 + 2] = SMOKE_COLOR.b;
    }
    this.mesh.instanceMatrix.needsUpdate = true;

    this.scene.add(this.mesh);
  }

  /**
   * Spawn a smoke cloud at the given position.
   * Used for both smoke grenades and post-explosion smoke.
   */
  spawnCloud(
    position: Vec3,
    options: {
      lifetime?: number;
      radius?: number;
      color?: THREE.Color;
      puffCount?: number;
    } = {},
  ): void {
    const lifetime = options.lifetime ?? 15;
    const radius = options.radius ?? 6;
    const color = options.color ?? SMOKE_COLOR;
    const puffCount = Math.min(options.puffCount ?? PUFFS_PER_CLOUD, PUFFS_PER_CLOUD);

    // Find a free cloud slot
    let cloudIdx = -1;
    for (let i = 0; i < MAX_CLOUDS; i++) {
      if (!this.clouds[i].active) {
        cloudIdx = i;
        break;
      }
    }
    if (cloudIdx === -1) return; // All cloud slots full

    const cloud = this.clouds[cloudIdx];
    cloud.active = true;
    cloud.centerX = position.x;
    cloud.centerY = position.y;
    cloud.centerZ = position.z;
    cloud.age = 0;
    cloud.lifetime = lifetime;
    cloud.maxRadius = radius;
    cloud.color.copy(color);

    // Scatter puffs in a sphere around the center
    const start = cloud.puffStart;
    for (let i = 0; i < puffCount; i++) {
      const puff = this.puffs[start + i];
      puff.alive = true;
      puff.cloudIndex = cloudIdx;

      // Random position within a sphere
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const r = Math.pow(Math.random(), 0.4) * radius; // Bias toward edges for volume
      puff.localX = r * Math.sin(phi) * Math.cos(theta);
      puff.localY = r * Math.sin(phi) * Math.sin(theta) * 0.6 + radius * 0.15; // Flatten vertically, raise slightly
      puff.localZ = r * Math.cos(phi);

      puff.worldX = position.x;
      puff.worldY = position.y;
      puff.worldZ = position.z;

      // Billboard size: larger puffs for more coverage
      puff.maxSize = radius * (0.5 + Math.random() * 0.6);
      puff.size = 0;

      // Alpha: inner puffs more opaque
      const dist01 = r / radius;
      puff.baseAlpha = 0.35 + (1 - dist01) * 0.3;

      // Rotation
      puff.rotation = Math.random() * Math.PI * 2;
      puff.rotationSpeed = (Math.random() - 0.5) * 0.3;

      // Slow drift
      puff.driftX = (Math.random() - 0.5) * 0.2;
      puff.driftY = DRIFT_UP_SPEED * (0.5 + Math.random() * 0.5);
      puff.driftZ = (Math.random() - 0.5) * 0.2;

      // Noise phase for turbulence
      puff.noisePhase = Math.random() * 100;

      // Set color
      const ci = (start + i) * 3;
      this.instanceColors[ci] = color.r;
      this.instanceColors[ci + 1] = color.g;
      this.instanceColors[ci + 2] = color.b;
    }

    // Kill unused puffs in this cloud's slot
    for (let i = puffCount; i < PUFFS_PER_CLOUD; i++) {
      this.puffs[start + i].alive = false;
      this.instanceAlphas[start + i] = 0;
    }
  }

  /** Per-frame update: animate all active smoke clouds and their puffs */
  update(dt: number): void {
    this.elapsedTime += dt;

    // Update shader time
    const material = this.mesh.material as THREE.ShaderMaterial;
    material.uniforms['uTime'].value = this.elapsedTime;

    // Camera orientation for billboarding
    const camQuat = this.camera.quaternion;

    let anyActive = false;

    for (let ci = 0; ci < MAX_CLOUDS; ci++) {
      const cloud = this.clouds[ci];
      if (!cloud.active) continue;

      cloud.age += dt;

      // Cloud lifetime check
      if (cloud.age >= cloud.lifetime) {
        cloud.active = false;
        // Kill all puffs
        for (let i = 0; i < cloud.puffCount; i++) {
          const pi = cloud.puffStart + i;
          this.puffs[pi].alive = false;
          this.instanceAlphas[pi] = 0;
          this.dummy.position.set(0, -1000, 0);
          this.dummy.scale.set(0, 0, 0);
          this.dummy.updateMatrix();
          this.mesh.setMatrixAt(pi, this.dummy.matrix);
        }
        continue;
      }

      anyActive = true;

      // Compute cloud-level multipliers
      const expandProgress = Math.min(1, cloud.age / EXPAND_TIME);
      const expandEased = 1 - Math.pow(1 - expandProgress, 3); // Ease-out cubic

      // Fade in
      let fadeIn = 1;
      if (cloud.age < FADE_IN_TIME) {
        fadeIn = cloud.age / FADE_IN_TIME;
      }

      // Fade out
      let fadeOut = 1;
      const timeLeft = cloud.lifetime - cloud.age;
      if (timeLeft < FADE_OUT_TIME) {
        fadeOut = timeLeft / FADE_OUT_TIME;
      }

      const cloudAlpha = fadeIn * fadeOut;

      // Update each puff in this cloud
      for (let i = 0; i < cloud.puffCount; i++) {
        const pi = cloud.puffStart + i;
        const puff = this.puffs[pi];
        if (!puff.alive) continue;

        // Drift over time
        puff.localX += puff.driftX * dt;
        puff.localY += puff.driftY * dt;
        puff.localZ += puff.driftZ * dt;

        // Turbulence
        const turbX = Math.sin(this.elapsedTime * 0.7 + puff.noisePhase) * TURBULENCE * dt;
        const turbZ = Math.cos(this.elapsedTime * 0.5 + puff.noisePhase * 1.3) * TURBULENCE * dt;
        puff.localX += turbX;
        puff.localZ += turbZ;

        // Compute world position: cloud center + local offset scaled by expand
        puff.worldX = cloud.centerX + puff.localX * expandEased;
        puff.worldY = cloud.centerY + puff.localY * expandEased;
        puff.worldZ = cloud.centerZ + puff.localZ * expandEased;

        // Size: grows with expansion
        puff.size = puff.maxSize * expandEased;

        // Rotation
        puff.rotation += puff.rotationSpeed * dt;

        // Alpha
        const alpha = puff.baseAlpha * cloudAlpha;
        this.instanceAlphas[pi] = alpha;

        // Update instance matrix: position + camera-facing rotation + scale
        this.dummy.position.set(puff.worldX, puff.worldY, puff.worldZ);
        this.dummy.quaternion.copy(camQuat); // Face camera
        this.dummy.rotateZ(puff.rotation); // Local rotation for variety
        this.dummy.scale.set(puff.size, puff.size, puff.size);
        this.dummy.updateMatrix();
        this.mesh.setMatrixAt(pi, this.dummy.matrix);
      }
    }

    if (anyActive) {
      this.mesh.instanceMatrix.needsUpdate = true;
      this.alphaAttr.needsUpdate = true;
      this.colorAttr.needsUpdate = true;
    }
  }

  /** Convenience: spawn a smoke grenade cloud (white smoke, long duration) */
  spawnSmokeGrenade(position: Vec3, radius: number, duration: number): void {
    this.spawnCloud(position, {
      lifetime: duration,
      radius,
      color: SMOKE_COLOR,
    });
  }

  /** Convenience: spawn post-explosion smoke (darker, shorter, smaller) */
  spawnExplosionSmoke(position: Vec3): void {
    this.spawnCloud(position, {
      lifetime: 4,
      radius: 3,
      color: EXPLOSION_SMOKE_COLOR,
      puffCount: 16,
    });
  }

  /** Clean up GPU resources */
  dispose(): void {
    this.scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.ShaderMaterial).dispose();
  }
}
