import * as THREE from 'three';
import type { GrenadeState, Vec3 } from '@clawfield/shared';
import { GRAVITY, GRENADE_FUSE_TIME, GRENADE_DAMAGE_RADIUS } from '@clawfield/shared';
import { soundManager, SoundId } from '../audio/sound-manager';

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

/** Tracked grenade with mesh and interpolation data */
interface TrackedGrenade {
  mesh: THREE.Mesh;
  light: THREE.PointLight | null;
  velocity: Vec3;
  fuseRemaining: number;
  lastUpdate: number;
}

/** Tracked explosion animation */
interface TrackedExplosion {
  mesh: THREE.Mesh;
  light: THREE.PointLight | null;
  material: THREE.MeshBasicMaterial;
  elapsed: number;
  lifetime: number;
  targetRadius: number;
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
  private explosions: TrackedExplosion[] = [];

  /** Counter for client-predicted grenade IDs (negative to avoid server ID conflicts) */
  private localNextId = -1;

  /** Shared geometry and material for all grenade meshes */
  private readonly grenadeGeometry: THREE.BoxGeometry;
  private readonly grenadeMaterial: THREE.MeshStandardMaterial;

  /** Count of currently active grenade lights */
  private activeGrenadeLightCount = 0;

  /** Count of currently active explosion lights */
  private activeExplosionLightCount = 0;

  constructor(scene: THREE.Scene) {
    this.scene = scene;

    // Small dark cube for the grenade body
    this.grenadeGeometry = new THREE.BoxGeometry(GRENADE_SIZE, GRENADE_SIZE, GRENADE_SIZE);
    this.grenadeMaterial = new THREE.MeshStandardMaterial({ color: 0x333333 });
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
   * Add an explosion effect at the given position.
   * The explosion is a glowing sphere that quickly expands and fades out.
   */
  addExplosion(position: Vec3, radius: number): void {
    soundManager.play3D(SoundId.Explosion, position);

    const targetRadius = radius > 0 ? radius : GRENADE_DAMAGE_RADIUS;

    // Glowing sphere material
    const material = new THREE.MeshBasicMaterial({
      color: 0xff8800,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
    });

    // Start small and expand
    const geometry = new THREE.SphereGeometry(EXPLOSION_START_RADIUS, 12, 8);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(position.x, position.y, position.z);
    this.scene.add(mesh);

    // Bright point light for the flash
    let light: THREE.PointLight | null = null;
    if (this.activeExplosionLightCount < MAX_EXPLOSION_LIGHTS) {
      light = new THREE.PointLight(0xffaa00, 3, targetRadius * 2);
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
    });
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
      exp.material.opacity = 0.9 * (1 - progress);

      // Fade out light intensity
      if (exp.light) {
        exp.light.intensity = 3 * (1 - progress);
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
  }

  /** Clean up all grenades, explosions, and shared resources. */
  dispose(): void {
    for (const [id, tracked] of this.grenades) {
      this.removeGrenade(id, tracked);
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

    this.grenadeGeometry.dispose();
    this.grenadeMaterial.dispose();
  }

  // ── Private helpers ─────────────────────────────────────────────

  /** Create a grenade mesh with optional light and add to scene. */
  private createGrenade(
    id: number,
    position: Vec3,
    velocity: Vec3,
    fuseRemaining: number,
  ): void {
    const mesh = new THREE.Mesh(this.grenadeGeometry, this.grenadeMaterial);
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
}
