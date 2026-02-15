import * as THREE from 'three';
import type { GrenadeState, SmokeGrenadeState, FlashGrenadeState, Vec3 } from '@clawfield/shared';
import { GRAVITY, GRENADE_FUSE_TIME, SMOKE_GRENADE_FUSE_TIME } from '@clawfield/shared';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { ParticleSystem } from './particle-system';
import { FRAG_GRENADE_VISUAL, SMOKE_GRENADE_VISUAL, type WeaponVisualDef } from '../player/weapon-visuals';
import noiseTextureUrl from '../assets/textures/noiseTexture.png';

/** Maximum number of point lights for grenades (performance cap) */
const MAX_GRENADE_LIGHTS = 4;

/** Grenade mesh size (voxel-style small cube) */
const GRENADE_SIZE = 0.15;



/** Smoke cloud visuals for deployed smoke grenades */
const SMOKE_CLOUD_OPACITY = 0.82;
const SMOKE_CLOUD_MIN_DURATION = 8;
const SMOKE_CLOUD_SEGMENTS = 26;
const SMOKE_CLOUD_STEPS = 28;

/** Tracked grenade with mesh and interpolation data */
interface TrackedGrenade {
  mesh: THREE.Object3D;
  light: THREE.PointLight | null;
  velocity: Vec3;
  fuseRemaining: number;
  lastUpdate: number;
}

const modelLoader = new GLTFLoader();
const modelTemplateCache = new Map<string, Promise<THREE.Object3D | null>>();

function centerObject(root: THREE.Object3D): void {
  const box = new THREE.Box3().setFromObject(root);
  if (box.isEmpty()) return;
  const center = new THREE.Vector3();
  box.getCenter(center);
  root.position.sub(center);
}

function loadModelTemplate(visual: WeaponVisualDef): Promise<THREE.Object3D | null> {
  const existing = modelTemplateCache.get(visual.path);
  if (existing) return existing;

  const promise = modelLoader
    .loadAsync(visual.path)
    .then((gltf) => {
      const root = gltf.scene.clone(true);
      centerObject(root);
      root.scale.setScalar(visual.scale);
      root.rotation.set(...visual.rotation);
      root.position.set(...visual.position);
      return root;
    })
    .catch(() => null);

  modelTemplateCache.set(visual.path, promise);
  return promise;
}


interface TrackedSmokeCloud {
  mesh: THREE.Mesh;
  material: THREE.ShaderMaterial;
  elapsed: number;
  lifetime: number;
  startRadius: number;
  maxRadius: number;
  drift: THREE.Vector3;
  wobblePhase: number;
  wobbleSpeed: number;
}

const SMOKE_VERTEX_SHADER = /* glsl */`
varying vec3 vLocalPos;
varying vec3 vCameraLocal;

void main() {
  vLocalPos = position;
  mat4 invModel = inverse(modelMatrix);
  vCameraLocal = (invModel * vec4(cameraPosition, 1.0)).xyz;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const SMOKE_FRAGMENT_SHADER = /* glsl */`
uniform sampler2D uNoiseTex;
uniform float uTime;
uniform float uOpacity;
uniform float uDensity;
uniform float uSeed;
uniform vec3 uTint;

varying vec3 vLocalPos;
varying vec3 vCameraLocal;

mat2 rot(float a) { return mat2(cos(a), sin(a), -sin(a), cos(a)); }

float noise3(vec3 x) {
  vec3 p = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  vec2 uv = (p.xy + vec2(37.0, 17.0) * p.z) + f.xy;
  vec2 rg = texture(uNoiseTex, (uv + 0.5) / 256.0).yx;
  return -1.0 + 2.0 * mix(rg.x, rg.y, f.z);
}

float smokeDensity(vec3 p) {
  vec3 q = 1.2 * p;
  float f = 0.0;
  float a = 0.5;
  for (int i = 0; i < 5; ++i) {
    q += uTime * vec3(0.17 + uSeed * 0.03, -0.5, 0.07 * sin(uSeed * 6.2831));
    q += vec3(uSeed * 3.1, uSeed * 1.7, uSeed * 2.3);
    f += a * noise3(q);
    a *= 0.4;
    q *= 2.1;
  }
  float shape = 0.5 + 0.7 * max(p.y, 0.0) - 0.15 * length(p.xz);
  return clamp(1.0 + shape * f - length(p), 0.0, 1.0);
}

vec2 raySphere(vec3 ro, vec3 rd, float r) {
  float b = dot(ro, rd);
  float c = dot(ro, ro) - r * r;
  float h = b * b - c;
  if (h < 0.0) return vec2(1e9, -1e9);
  h = sqrt(h);
  return vec2(-b - h, -b + h);
}

void main() {
  vec3 ro = vCameraLocal;
  vec3 rd = normalize(vLocalPos - vCameraLocal);
  vec2 tHit = raySphere(ro, rd, 1.0);
  if (tHit.x > tHit.y) discard;

  float t0 = max(tHit.x, 0.0);
  float t1 = tHit.y;
  float stepSize = (t1 - t0) / float(${SMOKE_CLOUD_STEPS});

  vec3 ld = normalize(vec3(0.5, 1.0, -0.7));
  float sumDen = 0.0;
  float sumDif = 0.0;

  float t = t0;
  for (int i = 0; i < ${SMOKE_CLOUD_STEPS}; ++i) {
    vec3 p = ro + rd * t;
    float den = smokeDensity(p);
    sumDen += den;
    if (den > 0.02) {
      sumDif += max(0.0, den - smokeDensity(p + ld * 0.17));
    }
    t += stepSize;
  }

  vec3 lightCol = vec3(0.88, 0.86, 0.82);
  vec3 col = vec3(0.0);
  col += 0.72 * sumDen * stepSize * uTint;
  col += 0.42 * sumDif * stepSize * lightCol;
  col = mix(col, uTint, 0.36);

  float alpha = clamp(sumDen * stepSize * uDensity * uOpacity * 1.25, 0.0, 0.94);
  alpha = smoothstep(0.03, 0.88, alpha);
  if (alpha < 0.01) discard;
  gl_FragColor = vec4(col, alpha);
}
`;

/**
 * Manages grenade visuals (in-flight grenades) and explosion effects.
 *
 * For the local player: spawns client-predicted grenades immediately
 * at the throw position for instant visual feedback.
 * For other players: receives authoritative state from the server.
 * Explosions are purely visual effects triggered by server events.
 */
export class GrenadeRenderer {
  private scene: THREE.Scene;
  private grenades = new Map<number, TrackedGrenade>();
  private smokeGrenades = new Map<number, TrackedGrenade>();
  private flashGrenades = new Map<number, TrackedGrenade>();
  private particles: ParticleSystem | null = null;

  /** Counter for client-predicted grenade IDs (negative to avoid server ID conflicts) */
  private localNextId = -1;

  /** Shared geometry and materials for grenade meshes */
  private readonly grenadeGeometry: THREE.BoxGeometry;
  private readonly grenadeMaterial: THREE.MeshStandardMaterial;
  private readonly smokeGrenadeMaterial: THREE.MeshStandardMaterial;
  private readonly flashGrenadeMaterial: THREE.MeshStandardMaterial;
  private readonly smokeCloudGeometry: THREE.SphereGeometry;
  private readonly smokeCloudMaterial: THREE.ShaderMaterial;
  private readonly smokeNoiseTexture: THREE.Texture;
  private fragGrenadeTemplate: THREE.Object3D | null = null;
  private smokeGrenadeTemplate: THREE.Object3D | null = null;

  /** Count of currently active grenade lights */
  private activeGrenadeLightCount = 0;

  private smokeClouds: TrackedSmokeCloud[] = [];

  constructor(scene: THREE.Scene) {
    this.scene = scene;

    // Small dark cube for the grenade body
    this.grenadeGeometry = new THREE.BoxGeometry(GRENADE_SIZE, GRENADE_SIZE, GRENADE_SIZE);
    this.grenadeMaterial = new THREE.MeshStandardMaterial({ color: 0x333333 });
    this.smokeGrenadeMaterial = new THREE.MeshStandardMaterial({ color: 0x556b2f }); // olive green for smoke
    this.flashGrenadeMaterial = new THREE.MeshStandardMaterial({ color: 0xa8a8a8 });
    this.smokeCloudGeometry = new THREE.SphereGeometry(1, SMOKE_CLOUD_SEGMENTS, SMOKE_CLOUD_SEGMENTS);
    this.smokeNoiseTexture = new THREE.TextureLoader().load(noiseTextureUrl);
    this.smokeNoiseTexture.wrapS = THREE.RepeatWrapping;
    this.smokeNoiseTexture.wrapT = THREE.RepeatWrapping;
    this.smokeNoiseTexture.minFilter = THREE.LinearFilter;
    this.smokeNoiseTexture.magFilter = THREE.LinearFilter;
    this.smokeCloudMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uNoiseTex: { value: this.smokeNoiseTexture },
        uTime: { value: 0 },
        uOpacity: { value: SMOKE_CLOUD_OPACITY },
        uDensity: { value: 1.8 },
        uSeed: { value: 0.5 },
        uTint: { value: new THREE.Color(0.72, 0.74, 0.68) },
      },
      vertexShader: SMOKE_VERTEX_SHADER,
      fragmentShader: SMOKE_FRAGMENT_SHADER,
      transparent: true,
      depthWrite: false,
      side: THREE.BackSide,
      blending: THREE.NormalBlending,
    });
    void this.loadGrenadeModelTemplates();
  }

  private async loadGrenadeModelTemplates(): Promise<void> {
    const [fragModel, smokeModel] = await Promise.all([
      loadModelTemplate(FRAG_GRENADE_VISUAL),
      loadModelTemplate(SMOKE_GRENADE_VISUAL),
    ]);
    this.fragGrenadeTemplate = fragModel;
    this.smokeGrenadeTemplate = smokeModel;
  }

  /** Set the particle system used for explosion effects */
  setParticleSystem(ps: ParticleSystem): void {
    this.particles = ps;
  }

  /**
   * Update from server grenade states.
   * Adds new grenades, updates existing ones, removes stale ones.
   * Skips local predicted grenades (negative IDs).
   */
  updateFromServer(grenades: GrenadeState[]): void {
    const serverIds = new Set<number>();

    for (const sg of grenades) {
      serverIds.add(sg.id);

      const existing = this.grenades.get(sg.id);
      if (existing) {
        // Update position and velocity from server
        existing.mesh.position.set(sg.position.x, sg.position.y, sg.position.z);
        existing.velocity = { ...sg.velocity };
        existing.fuseRemaining = sg.fuseRemaining;
        existing.lastUpdate = performance.now();

        if (existing.light) {
          existing.light.position.copy(existing.mesh.position);
        }
      } else {
        // Create new grenade from server state
        this.createGrenade(sg.id, sg.position, sg.velocity, sg.fuseRemaining);
      }
    }

    // Remove server grenades no longer present (don't touch local predicted ones)
    for (const [id, tracked] of this.grenades) {
      if (id > 0 && !serverIds.has(id)) {
        this.removeGrenade(id, tracked);
      }
    }
  }

  /**
   * Spawn a client-predicted grenade for instant visual feedback.
   * Uses negative IDs to avoid conflicts with server-assigned IDs.
   */
  spawnLocal(position: Vec3, direction: Vec3): void {
    const id = this.localNextId--;

    // Direction is assumed to already include throw speed
    const velocity: Vec3 = {
      x: direction.x,
      y: direction.y,
      z: direction.z,
    };

    this.createGrenade(id, position, velocity, GRENADE_FUSE_TIME);
  }

  /**
   * Update from server smoke grenade states.
   * Adds new smoke grenades, updates existing, removes stale ones.
   */
  updateSmokeGrenadesFromServer(grenades: SmokeGrenadeState[]): void {
    const serverIds = new Set<number>();

    for (const sg of grenades) {
      serverIds.add(sg.id);

      const existing = this.smokeGrenades.get(sg.id);
      if (existing) {
        existing.mesh.position.set(sg.position.x, sg.position.y, sg.position.z);
        existing.velocity = { ...sg.velocity };
        existing.fuseRemaining = sg.fuseRemaining;
        existing.lastUpdate = performance.now();
        if (existing.light) {
          existing.light.position.copy(existing.mesh.position);
        }
      } else {
        this.createSmokeGrenade(sg.id, sg.position, sg.velocity, sg.fuseRemaining);
      }
    }

    // Remove stale server smoke grenades (don't touch local predicted ones)
    for (const [id, tracked] of this.smokeGrenades) {
      if (id > 0 && !serverIds.has(id)) {
        this.removeSmokeGrenade(id, tracked);
      }
    }
  }

  updateFlashGrenadesFromServer(grenades: FlashGrenadeState[]): void {
    const serverIds = new Set<number>();

    for (const sg of grenades) {
      serverIds.add(sg.id);

      const existing = this.flashGrenades.get(sg.id);
      if (existing) {
        existing.mesh.position.set(sg.position.x, sg.position.y, sg.position.z);
        existing.velocity = { ...sg.velocity };
        existing.fuseRemaining = sg.fuseRemaining;
        existing.lastUpdate = performance.now();
        if (existing.light) {
          existing.light.position.copy(existing.mesh.position);
        }
      } else {
        this.createFlashGrenade(sg.id, sg.position, sg.velocity, sg.fuseRemaining);
      }
    }

    for (const [id, tracked] of this.flashGrenades) {
      if (id > 0 && !serverIds.has(id)) {
        this.removeFlashGrenade(id, tracked);
      }
    }
  }

  /**
   * Spawn a client-predicted smoke grenade for instant visual feedback.
   */
  spawnLocalSmoke(position: Vec3, direction: Vec3): void {
    const id = this.localNextId--;
    const velocity: Vec3 = {
      x: direction.x,
      y: direction.y,
      z: direction.z,
    };
    this.createSmokeGrenade(id, position, velocity, SMOKE_GRENADE_FUSE_TIME);
  }

  /**
   * Spawn a persistent smoke cloud for a deployed smoke grenade.
   */
  addSmokeCloud(position: Vec3, radius: number, duration: number): void {
    const safeRadius = Math.max(0.5, Number(radius) || 2.5);
    const safeDuration = Math.max(SMOKE_CLOUD_MIN_DURATION, Number(duration) || SMOKE_CLOUD_MIN_DURATION);
    const plumeCount = 3;
    for (let i = 0; i < plumeCount; i++) {
      const visualStartRadius = safeRadius * (0.2 + Math.random() * 0.06);
      const visualMaxRadius = safeRadius * (0.95 + Math.random() * 0.25);
      const seed = Math.random();

      const mesh = new THREE.Mesh(
        this.smokeCloudGeometry,
        this.smokeCloudMaterial.clone(),
      );
      mesh.position.set(
        position.x + (Math.random() - 0.5) * safeRadius * 0.5,
        position.y + Math.max(0.4, safeRadius * (0.18 + Math.random() * 0.18)),
        position.z + (Math.random() - 0.5) * safeRadius * 0.5,
      );
      const sx = visualStartRadius * (0.9 + Math.random() * 0.3);
      const sy = visualStartRadius * (0.8 + Math.random() * 0.4);
      const sz = visualStartRadius * (0.9 + Math.random() * 0.3);
      mesh.scale.set(sx, sy, sz);
      const mat = mesh.material as THREE.ShaderMaterial;
      mat.uniforms.uSeed.value = seed;
      mat.uniforms.uDensity.value = 2.5 + Math.random() * 1.0;
      const tint = new THREE.Color(0.72, 0.75, 0.69).multiplyScalar(0.92 + Math.random() * 0.14);
      mat.uniforms.uTint.value = tint;
      mesh.renderOrder = 20;
      this.scene.add(mesh);

      this.smokeClouds.push({
        mesh,
        material: mat,
        elapsed: 0,
        lifetime: safeDuration,
        startRadius: visualStartRadius,
        maxRadius: visualMaxRadius,
        drift: new THREE.Vector3((Math.random() - 0.5) * 0.15, 0.08 + Math.random() * 0.12, (Math.random() - 0.5) * 0.15),
        wobblePhase: Math.random() * Math.PI * 2,
        wobbleSpeed: 0.8 + Math.random() * 1.2,
      });
    }
  }

  /**
   * @deprecated Explosion visuals are now handled by ExplosionVFXSystem.
   * Kept as no-op for backwards compatibility with any remaining callers.
   */
  addExplosion(_position: Vec3, _radius: number): void {
    // No-op: explosions now handled by ExplosionVFXSystem
  }

  /**
   * Per-frame update: interpolate grenade positions and animate explosions.
   */
  update(dt: number): void {
    // --- Update grenades ---
    for (const [id, tracked] of this.grenades) {
      // Apply gravity
      tracked.velocity.y += GRAVITY * dt;

      // Advance position
      tracked.mesh.position.x += tracked.velocity.x * dt;
      tracked.mesh.position.y += tracked.velocity.y * dt;
      tracked.mesh.position.z += tracked.velocity.z * dt;

      // Sync light position
      if (tracked.light) {
        tracked.light.position.copy(tracked.mesh.position);
      }

      // For local predicted grenades: count down fuse and remove when expired
      if (id < 0) {
        tracked.fuseRemaining -= dt;
        if (tracked.fuseRemaining <= 0) {
          this.removeGrenade(id, tracked);
        }
      }
    }

    // --- Update smoke grenades ---
    for (const [id, tracked] of this.smokeGrenades) {
      tracked.velocity.y += GRAVITY * dt;
      tracked.mesh.position.x += tracked.velocity.x * dt;
      tracked.mesh.position.y += tracked.velocity.y * dt;
      tracked.mesh.position.z += tracked.velocity.z * dt;
      if (tracked.light) {
        tracked.light.position.copy(tracked.mesh.position);
      }
      if (id < 0) {
        tracked.fuseRemaining -= dt;
        if (tracked.fuseRemaining <= 0) {
          this.removeSmokeGrenade(id, tracked);
        }
      }
    }

    for (const [id, tracked] of this.flashGrenades) {
      tracked.velocity.y += GRAVITY * dt;
      tracked.mesh.position.x += tracked.velocity.x * dt;
      tracked.mesh.position.y += tracked.velocity.y * dt;
      tracked.mesh.position.z += tracked.velocity.z * dt;
      if (tracked.light) {
        tracked.light.position.copy(tracked.mesh.position);
      }
      if (id < 0) {
        tracked.fuseRemaining -= dt;
        if (tracked.fuseRemaining <= 0) {
          this.removeFlashGrenade(id, tracked);
        }
      }
    }

    // --- Update smoke clouds ---
    for (let i = this.smokeClouds.length - 1; i >= 0; i--) {
      const cloud = this.smokeClouds[i]!;
      cloud.elapsed += dt;

      const progress = Math.min(1, cloud.elapsed / cloud.lifetime);
      const radius = cloud.startRadius + (cloud.maxRadius - cloud.startRadius) * (1 - Math.pow(1 - progress, 2));
      const wobble = 1 + Math.sin(cloud.wobblePhase + cloud.elapsed * cloud.wobbleSpeed) * 0.06;
      cloud.mesh.scale.set(radius * wobble, radius * (0.92 + (wobble - 1) * 0.5), radius / wobble);
      cloud.mesh.position.addScaledVector(cloud.drift, dt);

      const baseOpacity = THREE.MathUtils.lerp(SMOKE_CLOUD_OPACITY, 0.0, progress);
      cloud.material.uniforms.uTime.value = performance.now() * 0.001;
      cloud.material.uniforms.uOpacity.value = THREE.MathUtils.clamp(baseOpacity, 0, 1);
      cloud.material.uniforms.uDensity.value = THREE.MathUtils.lerp(2.8, 0.9, progress);

      if (progress >= 1) {
        this.scene.remove(cloud.mesh);
        cloud.material.dispose();
        this.smokeClouds.splice(i, 1);
      }
    }

  }

  /** Clean up all grenades, explosions, and shared resources. */
  dispose(): void {
    for (const [id, tracked] of this.grenades) {
      this.removeGrenade(id, tracked);
    }

    for (const [id, tracked] of this.smokeGrenades) {
      this.removeSmokeGrenade(id, tracked);
    }

    for (const [id, tracked] of this.flashGrenades) {
      this.removeFlashGrenade(id, tracked);
    }

    for (const cloud of this.smokeClouds) {
      this.scene.remove(cloud.mesh);
      cloud.material.dispose();
    }
    this.smokeClouds.length = 0;

    this.grenadeGeometry.dispose();
    this.grenadeMaterial.dispose();
    this.smokeGrenadeMaterial.dispose();
    this.flashGrenadeMaterial.dispose();
    this.smokeCloudGeometry.dispose();
    this.smokeCloudMaterial.dispose();
    this.smokeNoiseTexture.dispose();
  }

  // ── Private helpers ─────────────────────────────────────────────

  /** Create a grenade mesh with optional light and add to scene. */
  private createGrenade(
    id: number,
    position: Vec3,
    velocity: Vec3,
    fuseRemaining: number,
  ): void {
    const mesh = this.createThrowableObject(this.fragGrenadeTemplate, this.grenadeMaterial);
    mesh.position.set(position.x, position.y, position.z);
    this.scene.add(mesh);

    // Small warm-toned glow to make grenades visible
    let light: THREE.PointLight | null = null;
    if (this.activeGrenadeLightCount < MAX_GRENADE_LIGHTS) {
      light = new THREE.PointLight(0xff6600, 0.4, 3);
      light.position.copy(mesh.position);
      this.scene.add(light);
      this.activeGrenadeLightCount++;
    }

    this.grenades.set(id, {
      mesh,
      light,
      velocity: { ...velocity },
      fuseRemaining,
      lastUpdate: performance.now(),
    });
  }

  /** Remove a grenade from the scene and clean up. */
  private removeGrenade(id: number, tracked: TrackedGrenade): void {
    this.scene.remove(tracked.mesh);
    // Geometry and material are shared, so don't dispose per-grenade

    if (tracked.light) {
      this.scene.remove(tracked.light);
      tracked.light.dispose();
      this.activeGrenadeLightCount--;
    }

    this.grenades.delete(id);
  }

  /** Create a smoke grenade mesh with optional light and add to scene. */
  private createSmokeGrenade(
    id: number,
    position: Vec3,
    velocity: Vec3,
    fuseRemaining: number,
  ): void {
    const mesh = this.createThrowableObject(this.smokeGrenadeTemplate, this.smokeGrenadeMaterial);
    mesh.position.set(position.x, position.y, position.z);
    this.scene.add(mesh);

    // Subtle green glow to distinguish from frag
    let light: THREE.PointLight | null = null;
    if (this.activeGrenadeLightCount < MAX_GRENADE_LIGHTS) {
      light = new THREE.PointLight(0x88aa66, 0.3, 3);
      light.position.copy(mesh.position);
      this.scene.add(light);
      this.activeGrenadeLightCount++;
    }

    this.smokeGrenades.set(id, {
      mesh,
      light,
      velocity: { ...velocity },
      fuseRemaining,
      lastUpdate: performance.now(),
    });
  }

  /** Remove a smoke grenade from the scene and clean up. */
  private removeSmokeGrenade(id: number, tracked: TrackedGrenade): void {
    this.scene.remove(tracked.mesh);

    if (tracked.light) {
      this.scene.remove(tracked.light);
      tracked.light.dispose();
      this.activeGrenadeLightCount--;
    }

    this.smokeGrenades.delete(id);
  }

  private createFlashGrenade(
    id: number,
    position: Vec3,
    velocity: Vec3,
    fuseRemaining: number,
  ): void {
    const mesh = this.createThrowableObject(this.smokeGrenadeTemplate, this.flashGrenadeMaterial);
    mesh.position.set(position.x, position.y, position.z);
    this.scene.add(mesh);

    let light: THREE.PointLight | null = null;
    if (this.activeGrenadeLightCount < MAX_GRENADE_LIGHTS) {
      light = new THREE.PointLight(0xc9e3ff, 0.35, 3.2);
      light.position.copy(mesh.position);
      this.scene.add(light);
      this.activeGrenadeLightCount++;
    }

    this.flashGrenades.set(id, {
      mesh,
      light,
      velocity: { ...velocity },
      fuseRemaining,
      lastUpdate: performance.now(),
    });
  }

  private removeFlashGrenade(id: number, tracked: TrackedGrenade): void {
    this.scene.remove(tracked.mesh);

    if (tracked.light) {
      this.scene.remove(tracked.light);
      tracked.light.dispose();
      this.activeGrenadeLightCount--;
    }

    this.flashGrenades.delete(id);
  }

  private createThrowableObject(template: THREE.Object3D | null, fallbackMaterial: THREE.Material): THREE.Object3D {
    if (template) {
      return template.clone(true);
    }
    return new THREE.Mesh(this.grenadeGeometry, fallbackMaterial);
  }
}
