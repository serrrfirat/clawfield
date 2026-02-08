import * as THREE from 'three';
import type { ProjectileState, Vec3 } from '@clawfield/shared';
import { GRAVITY } from '@clawfield/shared';
import type { ParticleSystem } from './particle-system';

/** Maximum number of point lights attached to projectiles (performance cap) */
const MAX_PROJECTILE_LIGHTS = 5;

/** Tracked projectile with mesh and interpolation data */
interface TrackedProjectile {
  mesh: THREE.Mesh;
  light: THREE.PointLight | null;
  velocity: Vec3;
  lastUpdate: number;
  /** Max range — local projectiles are cleaned up when they exceed this */
  maxRange?: number;
  /** Distance traveled so far (local projectiles only) */
  distanceTraveled?: number;
}

/**
 * Manages visible projectile meshes in the scene.
 *
 * For the local player: spawns client-predicted projectiles immediately
 * at the camera/muzzle position for instant visual feedback.
 * For other players: receives authoritative state from the server.
 */
/** Impact spark particle colors (bright yellows and oranges) */
const IMPACT_COLORS: [number, number, number][] = [
  [1.0, 0.85, 0.2],
  [1.0, 0.65, 0.1],
  [1.0, 0.9, 0.5],
  [0.9, 0.5, 0.1],
];

export class ProjectileRenderer {
  private scene: THREE.Scene;
  private projectiles = new Map<number, TrackedProjectile>();
  private particles: ParticleSystem | null = null;

  /** Local player ID — used to skip own projectiles from server data */
  private localPlayerId: string | null = null;

  /** Counter for client-predicted projectile IDs (negative to avoid server ID conflicts) */
  private localNextId = -1;

  /** Shared geometry and material for all projectile meshes (reused for performance) */
  private readonly sharedGeometry: THREE.BoxGeometry;
  private readonly sharedMaterial: THREE.MeshBasicMaterial;

  /** Count of currently active projectile lights */
  private activeLightCount = 0;

  constructor(scene: THREE.Scene) {
    this.scene = scene;

    // Elongated box that looks like a tracer round
    this.sharedGeometry = new THREE.BoxGeometry(0.1, 0.1, 0.2);
    this.sharedMaterial = new THREE.MeshBasicMaterial({ color: 0xffcc00 });
  }

  /** Set the particle system used for bullet impact effects */
  setParticleSystem(ps: ParticleSystem): void {
    this.particles = ps;
  }

  /** Set the local player ID so we can skip our own server-side projectiles */
  setLocalPlayerId(id: string): void {
    this.localPlayerId = id;
  }

  /**
   * Spawn a client-predicted projectile immediately from the muzzle.
   * Called when the local player fires for instant visual feedback.
   */
  spawnLocal(position: Vec3, direction: Vec3, speed: number, maxRange: number): void {
    const velocity: Vec3 = {
      x: direction.x * speed,
      y: direction.y * speed,
      z: direction.z * speed,
    };

    const id = this.localNextId--;
    const mesh = new THREE.Mesh(this.sharedGeometry, this.sharedMaterial);
    mesh.position.set(position.x, position.y, position.z);
    this.orientMesh(mesh, velocity);
    this.scene.add(mesh);

    let light: THREE.PointLight | null = null;
    if (this.activeLightCount < MAX_PROJECTILE_LIGHTS) {
      light = new THREE.PointLight(0xffcc00, 0.6, 4);
      light.position.copy(mesh.position);
      this.scene.add(light);
      this.activeLightCount++;
    }

    this.projectiles.set(id, {
      mesh,
      light,
      velocity,
      lastUpdate: performance.now(),
      maxRange,
      distanceTraveled: 0,
    });
  }

  /**
   * Update from server state.
   * Adds new projectiles, updates existing ones, and removes any
   * that are no longer present in the server's list.
   * Skips projectiles owned by the local player (we use client-predicted ones instead).
   */
  updateFromServer(serverProjectiles: ProjectileState[]): void {
    const serverIds = new Set<number>();

    for (const sp of serverProjectiles) {
      // Skip our own projectiles — we use client-predicted ones for instant feedback
      if (sp.ownerId === this.localPlayerId) continue;

      serverIds.add(sp.id);

      const existing = this.projectiles.get(sp.id);
      if (existing) {
        // Update existing projectile position and velocity
        existing.mesh.position.set(sp.position.x, sp.position.y, sp.position.z);
        existing.velocity = { ...sp.velocity };
        existing.lastUpdate = performance.now();

        // Orient the mesh along the velocity direction
        this.orientMesh(existing.mesh, sp.velocity);

        // Sync light position if present
        if (existing.light) {
          existing.light.position.copy(existing.mesh.position);
        }
      } else {
        // Create new projectile
        this.createProjectile(sp);
      }
    }

    // Remove server projectiles that are no longer on the server
    // (don't touch local predicted ones, which have negative IDs)
    for (const [id, tracked] of this.projectiles) {
      if (id > 0 && !serverIds.has(id)) {
        this.removeProjectile(id, tracked);
      }
    }
  }

  /**
   * Interpolate projectile positions between server updates.
   * Called every frame to smooth movement at 60fps between 20Hz server ticks.
   * Also cleans up local predicted projectiles that exceed max range.
   */
  update(dt: number): void {
    for (const [id, tracked] of this.projectiles) {
      // Apply gravity to velocity (matches server-side arc)
      tracked.velocity.y += GRAVITY * dt;

      // Advance position by velocity * dt
      const speed = Math.sqrt(
        tracked.velocity.x * tracked.velocity.x +
        tracked.velocity.y * tracked.velocity.y +
        tracked.velocity.z * tracked.velocity.z
      );

      tracked.mesh.position.x += tracked.velocity.x * dt;
      tracked.mesh.position.y += tracked.velocity.y * dt;
      tracked.mesh.position.z += tracked.velocity.z * dt;

      // Re-orient the mesh to follow the (gravity-curved) trajectory
      this.orientMesh(tracked.mesh, tracked.velocity);

      // Sync light position if present
      if (tracked.light) {
        tracked.light.position.copy(tracked.mesh.position);
      }

      // Clean up local predicted projectiles that exceed max range
      if (id < 0 && tracked.maxRange !== undefined && tracked.distanceTraveled !== undefined) {
        tracked.distanceTraveled += speed * dt;
        if (tracked.distanceTraveled > tracked.maxRange) {
          this.removeProjectile(id, tracked);
        }
      }
    }
  }

  /** Clean up all projectiles and shared resources */
  dispose(): void {
    for (const [id, tracked] of this.projectiles) {
      this.removeProjectile(id, tracked);
    }
    this.sharedGeometry.dispose();
    this.sharedMaterial.dispose();
  }

  /** Create a projectile mesh and optional light, add to scene */
  private createProjectile(sp: ProjectileState): void {
    const mesh = new THREE.Mesh(this.sharedGeometry, this.sharedMaterial);
    mesh.position.set(sp.position.x, sp.position.y, sp.position.z);
    this.orientMesh(mesh, sp.velocity);
    this.scene.add(mesh);

    // Add a small glow light for the first few projectiles (performance cap)
    let light: THREE.PointLight | null = null;
    if (this.activeLightCount < MAX_PROJECTILE_LIGHTS) {
      light = new THREE.PointLight(0xffcc00, 0.6, 4);
      light.position.copy(mesh.position);
      this.scene.add(light);
      this.activeLightCount++;
    }

    this.projectiles.set(sp.id, {
      mesh,
      light,
      velocity: { ...sp.velocity },
      lastUpdate: performance.now(),
    });
  }

  /** Remove a projectile from the scene and clean up its resources */
  private removeProjectile(id: number, tracked: TrackedProjectile): void {
    // Spawn impact sparks at the projectile's last position
    if (this.particles) {
      const pos = tracked.mesh.position;
      this.particles.emit({
        position: { x: pos.x, y: pos.y, z: pos.z },
        count: 10,
        speedMin: 3,
        speedMax: 8,
        spread: Math.PI * 2,
        lifetimeMin: 0.1,
        lifetimeMax: 0.3,
        sizeMin: 0.06,
        sizeMax: 0.15,
        colors: IMPACT_COLORS,
        gravityScale: 0.5,
      });
    }

    this.scene.remove(tracked.mesh);
    // Geometry and material are shared, so don't dispose per-projectile

    if (tracked.light) {
      this.scene.remove(tracked.light);
      tracked.light.dispose();
      this.activeLightCount--;
    }

    this.projectiles.delete(id);
  }

  /**
   * Orient a mesh to face along a velocity vector.
   * Makes the elongated box point in the direction of travel.
   */
  private orientMesh(mesh: THREE.Mesh, velocity: Vec3): void {
    const speed = Math.sqrt(
      velocity.x * velocity.x +
      velocity.y * velocity.y +
      velocity.z * velocity.z
    );
    if (speed < 0.001) return;

    // lookAt a point ahead in the velocity direction
    mesh.lookAt(
      mesh.position.x + velocity.x,
      mesh.position.y + velocity.y,
      mesh.position.z + velocity.z
    );
  }
}
