import * as THREE from 'three';
import type { ProjectileState, Vec3 } from '@clawfield/shared';
import { GRAVITY, MAT_METAL, MAT_WOOD, MAT_WOOD_DARK, MAT_CONCRETE, MAT_CONCRETE_DARK, MAT_ROAD } from '@clawfield/shared';
import type { ParticleSystem } from './particle-system';
import { soundManager, SoundId } from '../audio/sound-manager';

/** Maximum number of point lights attached to projectiles (performance cap) */
const MAX_PROJECTILE_LIGHTS = 5;

/** Tracked projectile with mesh and interpolation data */
interface TrackedProjectile {
  mesh: THREE.Mesh;
  light: THREE.PointLight | null;
  velocity: Vec3;
  ownerId?: string;
  nearMissUntil?: number;
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
  private voxelGetter: ((wx: number, wy: number, wz: number) => number) | null = null;

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

  setVoxelGetter(getter: (wx: number, wy: number, wz: number) => number): void {
    this.voxelGetter = getter;
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
      ownerId: this.localPlayerId ?? undefined,
      nearMissUntil: 0,
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
        existing.ownerId = sp.ownerId;
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
   * Called every frame to smooth movement at 60fps between server ticks.
   * Also cleans up local predicted projectiles that exceed max range.
   */
  update(dt: number, listenerPos?: Vec3, onNearMiss?: (intensity: number) => void): void {
    for (const [id, tracked] of this.projectiles) {
      const prevPos = {
        x: tracked.mesh.position.x,
        y: tracked.mesh.position.y,
        z: tracked.mesh.position.z,
      };

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

      if (listenerPos && id > 0 && tracked.ownerId !== this.localPlayerId && speed > 60) {
        const now = performance.now();
        if (!tracked.nearMissUntil || now >= tracked.nearMissUntil) {
          const closest = this.closestPointOnSegment(listenerPos, prevPos, {
            x: tracked.mesh.position.x,
            y: tracked.mesh.position.y,
            z: tracked.mesh.position.z,
          });
          const dx = closest.x - listenerPos.x;
          const dy = closest.y - listenerPos.y;
          const dz = closest.z - listenerPos.z;
          const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

          if (dist < 1.6) {
            const intensity = Math.max(0.15, 1 - dist / 1.6);
            soundManager.play3D(SoundId.BulletCrack, closest, {
              volume: 0.2 + intensity * 0.4,
              pitch: 0.9 + Math.random() * 0.2,
              refDistance: 3,
            });
            onNearMiss?.(0.2 + intensity * 0.5);
            tracked.nearMissUntil = now + 220;
          }
        }
      }

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
      ownerId: sp.ownerId,
      nearMissUntil: 0,
      lastUpdate: performance.now(),
    });
  }

  private closestPointOnSegment(p: Vec3, a: Vec3, b: Vec3): Vec3 {
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const abz = b.z - a.z;
    const apx = p.x - a.x;
    const apy = p.y - a.y;
    const apz = p.z - a.z;
    const abLenSq = abx * abx + aby * aby + abz * abz;
    if (abLenSq < 1e-8) return { ...a };
    const t = Math.max(0, Math.min(1, (apx * abx + apy * aby + apz * abz) / abLenSq));
    return {
      x: a.x + abx * t,
      y: a.y + aby * t,
      z: a.z + abz * t,
    };
  }

  /** Remove a projectile from the scene and clean up its resources */
  private removeProjectile(id: number, tracked: TrackedProjectile): void {
    const pos = tracked.mesh.position;

    // Spawn impact sparks at the projectile's last position
    if (this.particles) {
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

    if (id > 0) {
      const wx = Math.floor(pos.x);
      const wy = Math.floor(pos.y);
      const wz = Math.floor(pos.z);
      const mat = this.voxelGetter ? this.voxelGetter(wx, wy, wz) : 0;

      let impactSound = SoundId.ImpactDirt;
      if (mat === MAT_METAL) impactSound = SoundId.ImpactMetal;
      else if (mat === MAT_WOOD || mat === MAT_WOOD_DARK) impactSound = SoundId.ImpactWood;
      else if (mat === MAT_CONCRETE || mat === MAT_CONCRETE_DARK || mat === MAT_ROAD) impactSound = SoundId.ImpactConcrete;

      soundManager.play3D(impactSound, { x: pos.x, y: pos.y, z: pos.z }, {
        volume: 0.2 + Math.random() * 0.12,
        pitch: 0.9 + Math.random() * 0.2,
        refDistance: 6,
      });

      if ((impactSound === SoundId.ImpactConcrete || impactSound === SoundId.ImpactMetal) && Math.random() < 0.35) {
        soundManager.play3D(SoundId.Ricochet, { x: pos.x, y: pos.y, z: pos.z }, {
          volume: 0.16 + Math.random() * 0.1,
          pitch: 0.95 + Math.random() * 0.15,
          refDistance: 9,
        });
      }
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
