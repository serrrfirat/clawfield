import type { Vec3, ProjectileState } from '@clawfield/shared';
import {
  Team,
  GRAVITY,
  rayVoxelMarch,
  rayIntersectAABB,
  playerAABB,
  type VoxelGetter,
  type WeaponStats,
} from '@clawfield/shared';
import type { PlayerSim } from './player-sim.js';

/** Internal projectile representation */
class Projectile {
  id: number;
  ownerId: string;
  ownerTeam: Team;
  position: Vec3;
  velocity: Vec3;
  weapon: WeaponStats;
  distanceTraveled: number;
  alive: boolean;

  constructor(
    id: number,
    ownerId: string,
    ownerTeam: Team,
    origin: Vec3,
    velocity: Vec3,
    weapon: WeaponStats
  ) {
    this.id = id;
    this.ownerId = ownerId;
    this.ownerTeam = ownerTeam;
    this.position = { ...origin };
    this.velocity = { ...velocity };
    this.weapon = weapon;
    this.distanceTraveled = 0;
    this.alive = true;
  }
}

/** Result of a projectile hitting a player */
export interface ProjectileHit {
  projectileId: number;
  ownerId: string;
  ownerTeam: Team;
  weapon: WeaponStats;
  targetId: string;
  distance: number;
}

/**
 * Manages all active projectiles in the game world.
 * Spawns projectiles when players fire, advances them each tick,
 * and checks for collisions against voxels and enemy players.
 */
export class ProjectileManager {
  private projectiles: Projectile[] = [];
  private nextId = 1;

  /** Spawn a new projectile. Direction must be normalized (with spread already applied). */
  spawn(
    ownerId: string,
    ownerTeam: Team,
    origin: Vec3,
    direction: Vec3,
    weapon: WeaponStats
  ): void {
    const speed = weapon.projectileSpeed;
    const velocity: Vec3 = {
      x: direction.x * speed,
      y: direction.y * speed,
      z: direction.z * speed,
    };

    const proj = new Projectile(
      this.nextId++,
      ownerId,
      ownerTeam,
      origin,
      velocity,
      weapon
    );

    this.projectiles.push(proj);
  }

  /**
   * Advance all projectiles by dt seconds.
   * Uses swept collision (raycast from old to new position) to avoid
   * tunnelling at high speeds.
   *
   * Returns a list of hits for the game loop to process damage.
   */
  update(
    dt: number,
    getVoxel: VoxelGetter,
    players: Map<string, PlayerSim>
  ): ProjectileHit[] {
    const hits: ProjectileHit[] = [];

    for (const proj of this.projectiles) {
      if (!proj.alive) continue;

      // Apply gravity to velocity (makes bullets arc downward over distance)
      proj.velocity.y += GRAVITY * dt;

      // Compute current speed from (gravity-affected) velocity
      const dirLen = Math.sqrt(
        proj.velocity.x * proj.velocity.x +
        proj.velocity.y * proj.velocity.y +
        proj.velocity.z * proj.velocity.z
      );
      if (dirLen < 1e-8) {
        proj.alive = false;
        continue;
      }
      const stepDist = dirLen * dt;
      const dir: Vec3 = {
        x: proj.velocity.x / dirLen,
        y: proj.velocity.y / dirLen,
        z: proj.velocity.z / dirLen,
      };

      const oldPos: Vec3 = { ...proj.position };

      // --- Swept voxel collision ---
      // Raycast from old position in the travel direction for stepDist
      const voxelHitDist = rayVoxelMarch(oldPos, dir, stepDist, getVoxel);

      // --- Swept player collision ---
      let closestPlayerDist = voxelHitDist; // voxel is the baseline
      let closestPlayerId: string | null = null;

      for (const target of players.values()) {
        // Skip owner
        if (target.id === proj.ownerId) continue;
        // Skip dead players
        if (!target.alive) continue;
        // Skip teammates
        if (target.team === proj.ownerTeam) continue;

        const aabb = playerAABB(target.position);
        const hit = rayIntersectAABB(oldPos, dir, aabb, stepDist);

        if (hit && hit.t < closestPlayerDist) {
          closestPlayerDist = hit.t;
          closestPlayerId = target.id;
        }
      }

      if (closestPlayerId !== null) {
        // Hit a player
        proj.alive = false;
        hits.push({
          projectileId: proj.id,
          ownerId: proj.ownerId,
          ownerTeam: proj.ownerTeam,
          weapon: proj.weapon,
          targetId: closestPlayerId,
          distance: proj.distanceTraveled + closestPlayerDist,
        });

        // Update position to hit point for the broadcast snapshot
        proj.position = {
          x: oldPos.x + dir.x * closestPlayerDist,
          y: oldPos.y + dir.y * closestPlayerDist,
          z: oldPos.z + dir.z * closestPlayerDist,
        };
      } else if (voxelHitDist < stepDist) {
        // Hit a wall
        proj.alive = false;
        proj.position = {
          x: oldPos.x + dir.x * voxelHitDist,
          y: oldPos.y + dir.y * voxelHitDist,
          z: oldPos.z + dir.z * voxelHitDist,
        };
      } else {
        // No collision: advance to new position
        proj.position = {
          x: oldPos.x + proj.velocity.x * dt,
          y: oldPos.y + proj.velocity.y * dt,
          z: oldPos.z + proj.velocity.z * dt,
        };
      }

      proj.distanceTraveled += stepDist;

      // Kill projectile if it has exceeded max range
      if (proj.distanceTraveled > proj.weapon.maxRange) {
        proj.alive = false;
      }
    }

    // Remove dead projectiles
    this.projectiles = this.projectiles.filter((p) => p.alive);

    return hits;
  }

  /** Get all alive projectile states for broadcasting to clients */
  getStates(): ProjectileState[] {
    return this.projectiles.map((p) => ({
      id: p.id,
      ownerId: p.ownerId,
      position: { ...p.position },
      velocity: { ...p.velocity },
      weapon: p.weapon.name,
    }));
  }
}
