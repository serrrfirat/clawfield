import type { Vec3, ProjectileState } from '@clawfield/shared';
import {
  Team,
  GRAVITY,
  rayVoxelMarch,
  rayHeightmapMarch,
  rayIntersectAABB,
  playerAABB,
  type VoxelGetter,
  type WeaponStats,
  type HeightGetter,
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

/** Result of a projectile hitting a voxel wall */
export interface ProjectileVoxelHit {
  position: Vec3;
  direction: Vec3;
}

/**
 * Manages all active projectiles in the game world.
 * Spawns projectiles when players fire, advances them each tick,
 * and checks for collisions against voxels and enemy players.
 */
export class ProjectileManager {
  private projectiles: Projectile[] = [];
  private nextId = 1;

  /** Optional resolver for lag-compensated target positions. */
  private resolveTargetPosition(
    target: PlayerSim,
    nowMs: number | undefined,
    lagCompMs: number,
    getHistoricalPosition?: (playerId: string, targetTimeMs: number) => Vec3 | undefined,
  ): Vec3 {
    if (!getHistoricalPosition || nowMs === undefined || lagCompMs <= 0) {
      return target.position;
    }

    return getHistoricalPosition(target.id, nowMs - lagCompMs) ?? target.position;
  }

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
    players: Map<string, PlayerSim>,
    nowMs?: number,
    lagCompMs: number = 0,
    getHistoricalPosition?: (playerId: string, targetTimeMs: number) => Vec3 | undefined,
  ): { playerHits: ProjectileHit[]; voxelHits: ProjectileVoxelHit[] } {
    const playerHits: ProjectileHit[] = [];
    const voxelHits: ProjectileVoxelHit[] = [];

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

        const targetPos = this.resolveTargetPosition(target, nowMs, lagCompMs, getHistoricalPosition);
        const aabb = playerAABB(targetPos);
        const hit = rayIntersectAABB(oldPos, dir, aabb, stepDist);

        if (hit && hit.t < closestPlayerDist) {
          closestPlayerDist = hit.t;
          closestPlayerId = target.id;
        }
      }

      if (closestPlayerId !== null) {
        // Hit a player
        proj.alive = false;
        playerHits.push({
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
        // Hit a wall — record for destruction system
        proj.alive = false;
        proj.position = {
          x: oldPos.x + dir.x * voxelHitDist,
          y: oldPos.y + dir.y * voxelHitDist,
          z: oldPos.z + dir.z * voxelHitDist,
        };
        voxelHits.push({
          position: { ...proj.position },
          direction: { ...dir },
        });
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

    return { playerHits, voxelHits };
  }

  /**
   * Advance projectiles using heightmap terrain collision instead of voxels.
   * Player AABB intersection is identical to update().
   */
  updateHeightmap(
    dt: number,
    getHeight: HeightGetter,
    players: Map<string, PlayerSim>,
    nowMs?: number,
    lagCompMs: number = 0,
    getHistoricalPosition?: (playerId: string, targetTimeMs: number) => Vec3 | undefined,
  ): { playerHits: ProjectileHit[]; voxelHits: ProjectileVoxelHit[] } {
    const playerHits: ProjectileHit[] = [];
    const voxelHits: ProjectileVoxelHit[] = [];

    for (const proj of this.projectiles) {
      if (!proj.alive) continue;

      proj.velocity.y += GRAVITY * dt;

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

      // Terrain collision via heightmap ray march
      const terrainHitDist = rayHeightmapMarch(oldPos, dir, stepDist, getHeight);

      // Player collision
      let closestPlayerDist = terrainHitDist;
      let closestPlayerId: string | null = null;

      for (const target of players.values()) {
        if (target.id === proj.ownerId) continue;
        if (!target.alive) continue;
        if (target.team === proj.ownerTeam) continue;

        const targetPos = this.resolveTargetPosition(target, nowMs, lagCompMs, getHistoricalPosition);
        const aabb = playerAABB(targetPos);
        const hit = rayIntersectAABB(oldPos, dir, aabb, stepDist);

        if (hit && hit.t < closestPlayerDist) {
          closestPlayerDist = hit.t;
          closestPlayerId = target.id;
        }
      }

      if (closestPlayerId !== null) {
        proj.alive = false;
        playerHits.push({
          projectileId: proj.id,
          ownerId: proj.ownerId,
          ownerTeam: proj.ownerTeam,
          weapon: proj.weapon,
          targetId: closestPlayerId,
          distance: proj.distanceTraveled + closestPlayerDist,
        });
        proj.position = {
          x: oldPos.x + dir.x * closestPlayerDist,
          y: oldPos.y + dir.y * closestPlayerDist,
          z: oldPos.z + dir.z * closestPlayerDist,
        };
      } else if (terrainHitDist < stepDist) {
        proj.alive = false;
        proj.position = {
          x: oldPos.x + dir.x * terrainHitDist,
          y: oldPos.y + dir.y * terrainHitDist,
          z: oldPos.z + dir.z * terrainHitDist,
        };
        voxelHits.push({
          position: { ...proj.position },
          direction: { ...dir },
        });
      } else {
        proj.position = {
          x: oldPos.x + proj.velocity.x * dt,
          y: oldPos.y + proj.velocity.y * dt,
          z: oldPos.z + proj.velocity.z * dt,
        };
      }

      proj.distanceTraveled += stepDist;
      if (proj.distanceTraveled > proj.weapon.maxRange) {
        proj.alive = false;
      }
    }

    this.projectiles = this.projectiles.filter((p) => p.alive);
    return { playerHits, voxelHits };
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
