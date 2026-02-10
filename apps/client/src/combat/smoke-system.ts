import * as THREE from 'three';
import type { Vec3 } from '@clawfield/shared';

/** Maximum number of billboard puffs across all smoke clouds */
const MAX_PUFFS = 1024;

/** Number of billboard puffs per smoke cloud */
const PUFFS_PER_CLOUD = 48;

/** Maximum simultaneous smoke clouds */
const MAX_CLOUDS = Math.floor(MAX_PUFFS / PUFFS_PER_CLOUD);

/** Time for smoke to fully expand (seconds) */
const EXPAND_TIME = 2.5;

/** Time for smoke to fade out at end of lifetime (seconds) */
const FADE_OUT_TIME = 4.0;

/** Time for smoke to fade in at start (seconds) */
const FADE_IN_TIME = 1.0;

/** Upward drift speed for smoke puffs (m/s) */
const DRIFT_UP_SPEED = 0.25;

/** Turbulence strength — how much puffs wobble */
const TURBULENCE = 0.35;

/** Smoke puff color (light gray) */
const SMOKE_COLOR = new THREE.Color(0.82, 0.82, 0.80);

/** Explosion smoke color (darker gray-brown) */
const EXPLOSION_SMOKE_COLOR = new THREE.Color(0.4, 0.38, 0.35);

/** Storm fog color (dark gray-blue, matches storm sky) */
const STORM_FOG_COLOR = new THREE.Color(0.35, 0.38, 0.42);

/** Storm fog: how many clouds to keep alive around the player */
const STORM_FOG_COUNT = 5;

/** Storm fog: seconds between spawning new fog volumes */
const STORM_FOG_INTERVAL = 3.0;

/** Storm fog: cloud lifetime */
const STORM_FOG_LIFETIME = 10.0;

/** Storm fog: cloud radius (big, diffuse volumes) */
const STORM_FOG_RADIUS = 18;

// ---------------------------------------------------------------------------
// Procedural smoke texture (generated once on a canvas)
// ---------------------------------------------------------------------------

function generateSmokeTexture(size = 256): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  // Start transparent
  ctx.clearRect(0, 0, size, size);

  const cx = size / 2;
  const cy = size / 2;
  const maxR = size / 2;

  // Draw many overlapping translucent radial gradients at random offsets
  // to create an organic, blobby smoke puff
  const blobs = 24;
  for (let i = 0; i < blobs; i++) {
    const angle = Math.random() * Math.PI * 2;
    const dist = Math.random() * maxR * 0.35;
    const bx = cx + Math.cos(angle) * dist;
    const by = cy + Math.sin(angle) * dist;
    const br = maxR * (0.4 + Math.random() * 0.5);

    const grad = ctx.createRadialGradient(bx, by, 0, bx, by, br);
    const a = 0.06 + Math.random() * 0.06;
    grad.addColorStop(0, `rgba(255, 255, 255, ${a})`);
    grad.addColorStop(0.4, `rgba(240, 240, 240, ${a * 0.7})`);
    grad.addColorStop(0.7, `rgba(220, 220, 220, ${a * 0.3})`);
    grad.addColorStop(1, 'rgba(200, 200, 200, 0)');

    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);
  }

  // Soft outer falloff — multiply with a radial gradient to clip edges
  const falloff = ctx.createRadialGradient(cx, cy, maxR * 0.15, cx, cy, maxR);
  falloff.addColorStop(0, 'rgba(255,255,255,1)');
  falloff.addColorStop(0.6, 'rgba(255,255,255,0.9)');
  falloff.addColorStop(0.85, 'rgba(255,255,255,0.3)');
  falloff.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.globalCompositeOperation = 'destination-in';
  ctx.fillStyle = falloff;
  ctx.fillRect(0, 0, size, size);
  ctx.globalCompositeOperation = 'source-over';

  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}

// ---------------------------------------------------------------------------

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
  /** Tagged as storm fog (managed by updateStormFog, auto-killed when storm ends) */
  stormFog: boolean;
}

/**
 * Volumetric smoke rendering system using instanced camera-facing billboards
 * with a procedural smoke texture for organic, realistic appearance.
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

  private smokeTexture: THREE.CanvasTexture;

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
        stormFog: false,
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

    // Generate procedural smoke texture
    this.smokeTexture = generateSmokeTexture(256);

    // Billboard quad geometry
    const geometry = new THREE.PlaneGeometry(1, 1);

    // Texture-based shader — samples the smoke texture and tints with per-instance color
    const material = new THREE.ShaderMaterial({
      uniforms: {
        uSmokeMap: { value: this.smokeTexture },
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
        uniform sampler2D uSmokeMap;
        varying float vAlpha;
        varying vec2 vUv;
        varying vec3 vColor;

        void main() {
          vec4 texel = texture2D(uSmokeMap, vUv);

          // Use texture alpha for organic shape, tint with per-instance color
          float alpha = texel.a * vAlpha;
          if (alpha < 0.005) discard;

          // Blend texture luminance with the tint color
          vec3 color = vColor * (0.7 + 0.3 * texel.r);

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

      // Billboard size: larger puffs for dense coverage, overlapping heavily
      puff.maxSize = radius * (0.7 + Math.random() * 0.8);
      puff.size = 0;

      // Alpha: inner puffs more opaque — thick enough to fully block vision
      const dist01 = r / radius;
      puff.baseAlpha = 0.6 + (1 - dist01) * 0.35;

      // Slow rotation — the key to organic smoke appearance
      puff.rotation = Math.random() * Math.PI * 2;
      puff.rotationSpeed = (Math.random() - 0.5) * 0.15;

      // Slow drift
      puff.driftX = (Math.random() - 0.5) * 0.15;
      puff.driftY = DRIFT_UP_SPEED * (0.5 + Math.random() * 0.5);
      puff.driftZ = (Math.random() - 0.5) * 0.15;

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
    // Camera orientation for billboarding
    const camQuat = this.camera.quaternion;
    const time = performance.now() * 0.001;

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
        const turbX = Math.sin(time * 0.7 + puff.noisePhase) * TURBULENCE * dt;
        const turbZ = Math.cos(time * 0.5 + puff.noisePhase * 1.3) * TURBULENCE * dt;
        puff.localX += turbX;
        puff.localZ += turbZ;

        // Compute world position: cloud center + local offset scaled by expand
        puff.worldX = cloud.centerX + puff.localX * expandEased;
        puff.worldY = cloud.centerY + puff.localY * expandEased;
        puff.worldZ = cloud.centerZ + puff.localZ * expandEased;

        // Size: grows with expansion
        puff.size = puff.maxSize * expandEased;

        // Rotation — slow continuous spin for organic feel
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

  // ── Storm volumetric fog ────────────────────────────────────────────

  /** Accumulator for spawn timer */
  private stormFogTimer = 0;

  /**
   * Call every frame from WeatherManager.
   * When active, continuously spawns large translucent fog volumes around the camera
   * to produce dramatic storm visibility loss. When deactivated, existing storm fog
   * clouds are killed immediately.
   */
  updateStormFog(
    active: boolean,
    cameraPos: { x: number; y: number; z: number },
    dt: number,
  ): void {
    if (!active) {
      // Kill all storm fog clouds
      for (let i = 0; i < MAX_CLOUDS; i++) {
        const cloud = this.clouds[i];
        if (cloud.active && cloud.stormFog) {
          cloud.active = false;
          for (let j = 0; j < cloud.puffCount; j++) {
            const pi = cloud.puffStart + j;
            this.puffs[pi].alive = false;
            this.instanceAlphas[pi] = 0;
            this.dummy.position.set(0, -1000, 0);
            this.dummy.scale.set(0, 0, 0);
            this.dummy.updateMatrix();
            this.mesh.setMatrixAt(pi, this.dummy.matrix);
          }
        }
      }
      this.stormFogTimer = 0;
      return;
    }

    // Count active storm fog clouds
    let stormCount = 0;
    for (let i = 0; i < MAX_CLOUDS; i++) {
      if (this.clouds[i].active && this.clouds[i].stormFog) stormCount++;
    }

    // Spawn new fog volumes on a timer, up to STORM_FOG_COUNT
    this.stormFogTimer += dt;
    if (stormCount < STORM_FOG_COUNT && this.stormFogTimer >= STORM_FOG_INTERVAL) {
      this.stormFogTimer = 0;
      this._spawnStormFogCloud(cameraPos);
    }

    // On first activation, seed several clouds immediately
    if (stormCount === 0) {
      for (let i = 0; i < STORM_FOG_COUNT; i++) {
        this._spawnStormFogCloud(cameraPos);
      }
      this.stormFogTimer = 0;
    }
  }

  /** Spawn a single storm fog volume near the camera */
  private _spawnStormFogCloud(cameraPos: { x: number; y: number; z: number }): void {
    // Find a free cloud slot
    let cloudIdx = -1;
    for (let i = 0; i < MAX_CLOUDS; i++) {
      if (!this.clouds[i].active) {
        cloudIdx = i;
        break;
      }
    }
    if (cloudIdx === -1) return;

    // Random offset from camera — scatter in a ring around the player
    const angle = Math.random() * Math.PI * 2;
    const dist = 8 + Math.random() * 25; // 8–33m from camera
    const pos: Vec3 = {
      x: cameraPos.x + Math.cos(angle) * dist,
      y: cameraPos.y - 2 + Math.random() * 6, // slightly below to above eye level
      z: cameraPos.z + Math.sin(angle) * dist,
    };

    const cloud = this.clouds[cloudIdx];
    cloud.active = true;
    cloud.stormFog = true;
    cloud.centerX = pos.x;
    cloud.centerY = pos.y;
    cloud.centerZ = pos.z;
    cloud.age = 0;
    cloud.lifetime = STORM_FOG_LIFETIME + Math.random() * 4; // 10-14s
    cloud.maxRadius = STORM_FOG_RADIUS + Math.random() * 6; // 18-24m
    cloud.color.copy(STORM_FOG_COLOR);

    // Spawn puffs — fewer per cloud but larger, more translucent
    const puffCount = 24; // Half of normal — big and diffuse
    const start = cloud.puffStart;
    const radius = cloud.maxRadius;

    for (let i = 0; i < puffCount; i++) {
      const puff = this.puffs[start + i];
      puff.alive = true;
      puff.cloudIndex = cloudIdx;

      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const r = Math.pow(Math.random(), 0.3) * radius;
      puff.localX = r * Math.sin(phi) * Math.cos(theta);
      puff.localY = r * Math.sin(phi) * Math.sin(theta) * 0.4; // Very flat — fog hugs the ground
      puff.localZ = r * Math.cos(phi);

      puff.worldX = pos.x;
      puff.worldY = pos.y;
      puff.worldZ = pos.z;

      // Large billboards for thick coverage
      puff.maxSize = radius * (0.9 + Math.random() * 0.8);
      puff.size = 0;

      // Low alpha — translucent fog, not opaque smoke
      puff.baseAlpha = 0.12 + Math.random() * 0.12; // 0.12–0.24

      puff.rotation = Math.random() * Math.PI * 2;
      puff.rotationSpeed = (Math.random() - 0.5) * 0.08; // Slow spin

      // Wind-driven drift (matches storm wind direction)
      puff.driftX = 1.5 + Math.random() * 1.0; // Strong lateral wind
      puff.driftY = 0.05 + Math.random() * 0.1; // Barely rising
      puff.driftZ = 0.5 + Math.random() * 0.5;

      puff.noisePhase = Math.random() * 100;

      const ci = (start + i) * 3;
      this.instanceColors[ci] = STORM_FOG_COLOR.r;
      this.instanceColors[ci + 1] = STORM_FOG_COLOR.g;
      this.instanceColors[ci + 2] = STORM_FOG_COLOR.b;
    }

    // Kill unused puffs in this slot
    for (let i = puffCount; i < PUFFS_PER_CLOUD; i++) {
      this.puffs[start + i].alive = false;
      this.instanceAlphas[start + i] = 0;
    }
  }

  /** Clean up GPU resources */
  dispose(): void {
    this.scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.ShaderMaterial).dispose();
    this.smokeTexture.dispose();
  }
}
