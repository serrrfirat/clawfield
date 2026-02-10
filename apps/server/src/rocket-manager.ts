import type { Vec3, RocketState } from '@clawfield/shared';
import {
  GRAVITY,
  ROCKET_SPEED,
  ROCKET_MOTOR_GRAVITY,
  ROCKET_MOTOR_TIME,
  ROCKET_DAMAGE,
  ROCKET_DAMAGE_RADIUS,
  ROCKET_MAX_RANGE,
  PLAYER_HEIGHT,
  rayVoxelMarch,
  rayIntersectAABB,
  playerAABB,
  type VoxelGetter,
} from '@clawfield/shared';
import type { PlayerSim } from './player-sim.js';

/** Internal rocket representation */
class Rocket {
  id: number;
  ownerId: string;
  ownerTeam: number;
  position: Vec3;
  velocity: Vec3;
  /** Time the motor has been burning (seconds) */
  motorTime: number;
  distanceTraveled: number;
  alive: boolean;

  constructor(
    id: number,
    ownerId: string,
    ownerTeam: number,
    position: Vec3,
    velocity: Vec3,
  ) {
    this.id = id;
    this.ownerId = ownerId;
    this.ownerTeam = ownerTeam;
    this.position = { ...position };
    this.velocity = { ...velocity };
    this.motorTime = 0;
    this.distanceTraveled = 0;
    this.alive = true;
  }
}

/** Result of a rocket explosion with damage details */
export interface RocketExplosionResult {
  position: Vec3;
  ownerId: string;
  ownerTeam: number;
  hits: Array<{ playerId: string; damage: number; killed: boolean }>;
}

/**
 * Manages all active rockets in the game world.
 *
 * Rockets fly in a straight line with two-phase gravity:
 * - Phase 1 (motor active, 0–1.3s): gravity = -5 m/s² (flat trajectory)
 * - Phase 2 (motor out, >1.3s): gravity = -20 m/s² (drops fast)
 *
 * Collision is swept (raycast from old→new) like ProjectileManager.
 * On any impact (voxel or player), the rocket explodes with splash damage.
 */
export class RocketManager {
  private rockets: Rocket[] = [];
  private nextId = 1;

  /** Spawn a rocket fired by a player */
  spawn(
    ownerId: string,
    ownerTeam: number,
    eyePos: Vec3,
    direction: Vec3,
  ): void {
    const velocity: Vec3 = {
      x: direction.x * ROCKET_SPEED,
      y: direction.y * ROCKET_SPEED,
      z: direction.z * ROCKET_SPEED,
    };

    const rocket = new Rocket(
      this.nextId++,
      ownerId,
      ownerTeam,
      eyePos,
      velocity,
    );

    this.rockets.push(rocket);
  }

  /**
   * Advance all rockets by dt seconds.
   * Returns explosion results for rockets that detonated this tick.
   */
  update(
    dt: number,
    getVoxel: VoxelGetter,
    players: Map<string, PlayerSim>,
  ): RocketExplosionResult[] {
    const explosions: RocketExplosionResult[] = [];

    for (const rocket of this.rockets) {
      if (!rocket.alive) continue;

      // --- Two-phase gravity ---
      rocket.motorTime += dt;
      const grav = rocket.motorTime <= ROCKET_MOTOR_TIME
        ? ROCKET_MOTOR_GRAVITY
        : GRAVITY;
      rocket.velocity.y += grav * dt;

      // --- Compute step ---
      const vx = rocket.velocity.x;
      const vy = rocket.velocity.y;
      const vz = rocket.velocity.z;
      const speed = Math.sqrt(vx * vx + vy * vy + vz * vz);
      if (speed < 1e-8) {
        rocket.alive = false;
        continue;
      }
      const stepDist = speed * dt;
      const dir: Vec3 = { x: vx / speed, y: vy / speed, z: vz / speed };
      const oldPos: Vec3 = { ...rocket.position };

      // --- Swept voxel collision ---
      const voxelHitDist = rayVoxelMarch(oldPos, dir, stepDist, getVoxel);

      // --- Swept player collision (skip owner) ---
      let closestDist = voxelHitDist;
      let hitPlayerId: string | null = null;

      for (const target of players.values()) {
        if (target.id === rocket.ownerId) continue;
        if (!target.alive) continue;
        // Rockets damage everyone except teammates
        if (target.team === rocket.ownerTeam) continue;

        const aabb = playerAABB(target.position);
        const hit = rayIntersectAABB(oldPos, dir, aabb, stepDist);

        if (hit && hit.t < closestDist) {
          closestDist = hit.t;
          hitPlayerId = target.id;
        }
      }

      // --- Collision resolution ---
      const hitSomething = hitPlayerId !== null || voxelHitDist < stepDist;

      if (hitSomething) {
        // Move to impact point
        rocket.position = {
          x: oldPos.x + dir.x * closestDist,
          y: oldPos.y + dir.y * closestDist,
          z: oldPos.z + dir.z * closestDist,
        };
        rocket.alive = false;

        // --- Splash damage ---
        const hits: Array<{ playerId: string; damage: number; killed: boolean }> = [];

        for (const target of players.values()) {
          if (!target.alive) continue;
          // No friendly fire
          if (target.team === rocket.ownerTeam) continue;

          // Distance from explosion to player center mass
          const playerCenter: Vec3 = {
            x: target.position.x,
            y: target.position.y + PLAYER_HEIGHT / 2,
            z: target.position.z,
          };

          const dx = rocket.position.x - playerCenter.x;
          const dy = rocket.position.y - playerCenter.y;
          const dz = rocket.position.z - playerCenter.z;
          const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

          if (dist > ROCKET_DAMAGE_RADIUS) continue;

          // Linear falloff
          const damage = Math.round(ROCKET_DAMAGE * (1 - dist / ROCKET_DAMAGE_RADIUS));
          if (damage <= 0) continue;

          target.recordDamageFrom(rocket.ownerId);
          const result = target.takeDamage(damage);

          hits.push({
            playerId: target.id,
            damage,
            killed: result === 'downed' || result === 'killed',
          });
        }

        explosions.push({
          position: { ...rocket.position },
          ownerId: rocket.ownerId,
          ownerTeam: rocket.ownerTeam,
          hits,
        });
      } else {
        // No collision — advance
        rocket.position = {
          x: oldPos.x + vx * dt,
          y: oldPos.y + vy * dt,
          z: oldPos.z + vz * dt,
        };
      }

      rocket.distanceTraveled += stepDist;

      // Despawn if exceeded max range
      if (rocket.distanceTraveled > ROCKET_MAX_RANGE) {
        rocket.alive = false;
      }
    }

    // Remove dead rockets
    this.rockets = this.rockets.filter((r) => r.alive);

    return explosions;
  }

  /** Get all alive rocket states for broadcasting to clients */
  getStates(): RocketState[] {
    return this.rockets.map((r) => ({
      id: r.id,
      ownerId: r.ownerId,
      ownerTeam: r.ownerTeam,
      position: { ...r.position },
      velocity: { ...r.velocity },
      motorTime: r.motorTime,
    }));
  }
}
