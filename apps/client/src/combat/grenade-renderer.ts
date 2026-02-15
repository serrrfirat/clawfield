import * as THREE from 'three';
import type { GrenadeState, SmokeGrenadeState, FlashGrenadeState, Vec3 } from '@clawfield/shared';
import { GRAVITY, GRENADE_FUSE_TIME, GRENADE_DAMAGE_RADIUS, SMOKE_GRENADE_FUSE_TIME } from '@clawfield/shared';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { soundManager, SoundId } from '../audio/sound-manager';
import type { ParticleSystem } from './particle-system';
import { FRAG_GRENADE_VISUAL, SMOKE_GRENADE_VISUAL, type WeaponVisualDef } from '../player/weapon-visuals';

/** Maximum number of point lights for grenades (performance cap) */
const MAX_GRENADE_LIGHTS = 4;

/** Maximum number of explosion lights active at once */
const MAX_EXPLOSION_LIGHTS = 3;

/** Grenade mesh size (voxel-style small cube) */
const GRENADE_SIZE = 0.15;

/** Explosion effect duration in seconds */
const EXPLOSION_LIFETIME = 0.5;

/** Explosion initial sphere radius */
const EXPLOSION_START_RADIUS = 0.5;

/** Explosion visual intensity tuned for visible blast feedback */
const EXPLOSION_MESH_OPACITY = 0.9;
const EXPLOSION_LIGHT_INTENSITY = 3;
const EXPLOSION_LIGHT_DISTANCE_SCALE = 2;

/** Explosion particle counts and speed ranges */
const EXPLOSION_SPARK_COUNT = 40;
const EXPLOSION_DEBRIS_COUNT = 20;
const EXPLOSION_SMOKE_COUNT = 16;

/** Bright spark colors for explosion particles */
const EXPLOSION_SPARK_COLORS: [number, number, number][] = [
  [1.0, 0.9, 0.3],
  [1.0, 0.6, 0.1],
  [1.0, 0.8, 0.2],
  [1.0, 1.0, 0.6],
];

/** Dark debris colors for explosion particles */
const EXPLOSION_DEBRIS_COLORS: [number, number, number][] = [
  [0.3, 0.25, 0.15],
  [0.2, 0.15, 0.1],
  [0.4, 0.3, 0.2],
  [0.15, 0.12, 0.08],
];

/** Smoke cloud visuals for deployed smoke grenades */
const SMOKE_CLOUD_OPACITY = 0.38;
const SMOKE_CLOUD_MIN_DURATION = 4;
const SMOKE_CLOUD_SEGMENTS = 10;

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

/** Tracked explosion animation */
interface TrackedExplosion {
  mesh: THREE.Mesh;
  light: THREE.PointLight | null;
  material: THREE.MeshBasicMaterial;
  elapsed: number;
  lifetime: number;
  targetRadius: number;
  lightIntensity: number;
}

interface TrackedSmokeCloud {
  mesh: THREE.Mesh;
  material: THREE.MeshBasicMaterial;
  elapsed: number;
  lifetime: number;
  startRadius: number;
  maxRadius: number;
}

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
  private explosions: TrackedExplosion[] = [];
  private particles: ParticleSystem | null = null;

  /** Counter for client-predicted grenade IDs (negative to avoid server ID conflicts) */
  private localNextId = -1;

  /** Shared geometry and materials for grenade meshes */
  private readonly grenadeGeometry: THREE.BoxGeometry;
  private readonly grenadeMaterial: THREE.MeshStandardMaterial;
  private readonly smokeGrenadeMaterial: THREE.MeshStandardMaterial;
  private readonly flashGrenadeMaterial: THREE.MeshStandardMaterial;
  private readonly smokeCloudGeometry: THREE.SphereGeometry;
  private readonly smokeCloudMaterial: THREE.MeshBasicMaterial;
  private fragGrenadeTemplate: THREE.Object3D | null = null;
  private smokeGrenadeTemplate: THREE.Object3D | null = null;

  /** Count of currently active grenade lights */
  private activeGrenadeLightCount = 0;

  /** Count of currently active explosion lights */
  private activeExplosionLightCount = 0;

  private smokeClouds: TrackedSmokeCloud[] = [];

  constructor(scene: THREE.Scene) {
    this.scene = scene;

    // Small dark cube for the grenade body
    this.grenadeGeometry = new THREE.BoxGeometry(GRENADE_SIZE, GRENADE_SIZE, GRENADE_SIZE);
    this.grenadeMaterial = new THREE.MeshStandardMaterial({ color: 0x333333 });
    this.smokeGrenadeMaterial = new THREE.MeshStandardMaterial({ color: 0x556b2f }); // olive green for smoke
    this.flashGrenadeMaterial = new THREE.MeshStandardMaterial({ color: 0xa8a8a8 });
    this.smokeCloudGeometry = new THREE.SphereGeometry(1, SMOKE_CLOUD_SEGMENTS, SMOKE_CLOUD_SEGMENTS);
    this.smokeCloudMaterial = new THREE.MeshBasicMaterial({
      color: 0xf1efe8,
      transparent: true,
      opacity: SMOKE_CLOUD_OPACITY,
      depthWrite: false,
      side: THREE.DoubleSide,
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

    const mesh = new THREE.Mesh(
      this.smokeCloudGeometry,
      this.smokeCloudMaterial.clone(),
    );
    mesh.position.set(position.x, position.y, position.z);
    mesh.scale.set(safeRadius * 0.2, safeRadius * 0.2, safeRadius * 0.2);
    this.scene.add(mesh);

    this.smokeClouds.push({
      mesh,
      material: mesh.material as THREE.MeshBasicMaterial,
      elapsed: 0,
      lifetime: safeDuration,
      startRadius: safeRadius * 0.2,
      maxRadius: safeRadius,
    });
  }

  /**
   * Add an explosion effect at the given position.
   * The explosion is a glowing sphere that quickly expands and fades out.
   */
  addExplosion(position: Vec3, radius: number): void {
    soundManager.play3D(SoundId.Explosion, position);

    const targetRadius = radius > 0 ? radius : GRENADE_DAMAGE_RADIUS;

    // Glowing sphere material
    const material = new THREE.MeshBasicMaterial({
      color: 0xff6e00,
      transparent: true,
      opacity: EXPLOSION_MESH_OPACITY,
      depthWrite: false,
    });

    // Start small and expand
    const geometry = new THREE.SphereGeometry(EXPLOSION_START_RADIUS, 12, 8);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(position.x, position.y, position.z);
    this.scene.add(mesh);

    // Bright point light for the explosion glow
    let light: THREE.PointLight | null = null;
    const lightIntensity = this.activeExplosionLightCount < MAX_EXPLOSION_LIGHTS ? EXPLOSION_LIGHT_INTENSITY : 0;
    if (this.activeExplosionLightCount < MAX_EXPLOSION_LIGHTS && lightIntensity > 0) {
      light = new THREE.PointLight(0xff8a1a, lightIntensity, targetRadius * EXPLOSION_LIGHT_DISTANCE_SCALE);
      light.position.set(position.x, position.y, position.z);
      this.scene.add(light);
      this.activeExplosionLightCount++;
    }

    this.explosions.push({
      mesh,
      light,
      material,
      elapsed: 0,
      lifetime: EXPLOSION_LIFETIME,
      targetRadius,
      lightIntensity,
    });

    // Emit explosion particles: bright sparks + dark debris
    if (this.particles) {
      // Bright sparks flying outward
      this.particles.emit({
        position,
        count: EXPLOSION_SPARK_COUNT,
        speedMin: 6,
        speedMax: 20,
        spread: Math.PI * 2,
        lifetimeMin: 0.2,
        lifetimeMax: 0.8,
        sizeMin: 0.1,
        sizeMax: 0.35,
        colors: EXPLOSION_SPARK_COLORS,
        gravityScale: 0.3,
      });

      // Dark debris with heavier gravity
      this.particles.emit({
        position,
        count: EXPLOSION_DEBRIS_COUNT,
        speedMin: 4,
        speedMax: 14,
        spread: Math.PI * 2,
        lifetimeMin: 0.4,
        lifetimeMax: 1.2,
        sizeMin: 0.12,
        sizeMax: 0.4,
        colors: EXPLOSION_DEBRIS_COLORS,
        gravityScale: 1.0,
      });

      // Fast expanding smoke puff
      this.particles.emit({
        position: { x: position.x, y: position.y + 0.15, z: position.z },
        count: EXPLOSION_SMOKE_COUNT,
        direction: { x: 0, y: 1, z: 0 },
        speedMin: 0.5,
        speedMax: 2.8,
        spread: Math.PI,
        lifetimeMin: 0.85,
        lifetimeMax: 1.7,
        sizeMin: 0.28,
        sizeMax: 0.72,
        colors: [
          [0.36, 0.34, 0.3],
          [0.28, 0.27, 0.25],
          [0.22, 0.21, 0.2],
        ],
        gravityScale: -0.2,
      });
    }
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

    // --- Update explosions ---
    for (let i = this.explosions.length - 1; i >= 0; i--) {
      const exp = this.explosions[i]!;
      exp.elapsed += dt;

      const progress = Math.min(1, exp.elapsed / exp.lifetime);

      // Expand sphere: ease-out curve
      const scale = EXPLOSION_START_RADIUS +
        (exp.targetRadius - EXPLOSION_START_RADIUS) * (1 - Math.pow(1 - progress, 2));
      const uniformScale = scale / EXPLOSION_START_RADIUS;
      exp.mesh.scale.set(uniformScale, uniformScale, uniformScale);

      // Fade out opacity: fast initial brightness, then fades
      exp.material.opacity = EXPLOSION_MESH_OPACITY * (1 - progress);

      // Fade out light intensity
      if (exp.light) {
        exp.light.intensity = exp.lightIntensity * (1 - progress);
      }

      // Shift color from bright yellow-orange toward dark red as it fades
      const r = 1.0;
      const g = 0.55 * (1 - progress * 0.7);
      const b = 0.0;
      exp.material.color.setRGB(r, g, b);

      // Remove finished explosions
      if (progress >= 1) {
        this.scene.remove(exp.mesh);
        exp.mesh.geometry.dispose();
        exp.material.dispose();

        if (exp.light) {
          this.scene.remove(exp.light);
          exp.light.dispose();
          this.activeExplosionLightCount--;
        }

        this.explosions.splice(i, 1);
      }
    }

    // --- Update smoke clouds ---
    for (let i = this.smokeClouds.length - 1; i >= 0; i--) {
      const cloud = this.smokeClouds[i]!;
      cloud.elapsed += dt;

      const progress = Math.min(1, cloud.elapsed / cloud.lifetime);
      const radius = cloud.startRadius + (cloud.maxRadius - cloud.startRadius) * (1 - Math.pow(1 - progress, 2));
      cloud.mesh.scale.set(radius, radius, radius);

      const baseOpacity = THREE.MathUtils.lerp(SMOKE_CLOUD_OPACITY, 0.0, progress);
      cloud.material.opacity = THREE.MathUtils.clamp(baseOpacity, 0, 1);

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

    for (const exp of this.explosions) {
      this.scene.remove(exp.mesh);
      exp.mesh.geometry.dispose();
      exp.material.dispose();

      if (exp.light) {
        this.scene.remove(exp.light);
        exp.light.dispose();
        this.activeExplosionLightCount--;
      }
    }
    this.explosions.length = 0;

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
