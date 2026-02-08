import type { Vec3, GrenadeState } from '@clawfield/shared';
import {
  GRAVITY,
  GRENADE_THROW_SPEED,
  GRENADE_FUSE_TIME,
  GRENADE_BOUNCINESS,
  GRENADE_BOUNCE_DRAG,
  GRENADE_DAMAGE,
  GRENADE_DAMAGE_RADIUS,
  PLAYER_HEIGHT,
  MAT_WATER,
  type VoxelGetter,
} from '@clawfield/shared';
import type { PlayerSim } from './player-sim.js';

/** Internal grenade representation */
class Grenade {
  id: number;
  ownerId: string;
  ownerTeam: number;
  position: Vec3;
  velocity: Vec3;
  fuseRemaining: number;
  alive: boolean;

  constructor(
    id: number,
    ownerId: string,
    ownerTeam: number,
    position: Vec3,
    velocity: Vec3
  ) {
    this.id = id;
    this.ownerId = ownerId;
    this.ownerTeam = ownerTeam;
    this.position = { ...position };
    this.velocity = { ...velocity };
    this.fuseRemaining = GRENADE_FUSE_TIME;
    this.alive = true;
  }
}

/** Result of a grenade explosion with damage details */
export interface GrenadeExplosionResult {
  position: Vec3;
  ownerId: string;
  ownerTeam: number;
  hits: Array<{ playerId: string; damage: number; killed: boolean }>;
}

/**
 * Manages all active grenades in the game world.
 *
 * Ported from Ravenfield's GrenadeProjectile.cs and ExplodingProjectile.cs.
 *
 * Grenades follow ballistic arcs with gravity, bounce off solid voxels
 * (with energy loss), and explode after a fuse timer expires. The explosion
 * deals linear-falloff damage to all enemy players within the blast radius.
 * Friendly fire is disabled.
 */
export class GrenadeManager {
  private grenades: Grenade[] = [];
  private nextId = 1;

  /** Spawn a grenade thrown by a player */
  spawn(
    ownerId: string,
    ownerTeam: number,
    eyePos: Vec3,
    direction: Vec3
  ): void {
    const velocity: Vec3 = {
      x: direction.x * GRENADE_THROW_SPEED,
      y: direction.y * GRENADE_THROW_SPEED,
      z: direction.z * GRENADE_THROW_SPEED,
    };

    const grenade = new Grenade(
      this.nextId++,
      ownerId,
      ownerTeam,
      eyePos,
      velocity
    );

    this.grenades.push(grenade);
  }

  /**
   * Advance all grenades by dt seconds.
   *
   * Physics each tick:
   * 1. Apply gravity to velocity
   * 2. Compute candidate position
   * 3. Per-axis bounce detection against voxels
   * 4. Decrement fuse timer; explode if expired
   *
   * Returns an array of explosion results for grenades that detonated this tick.
   */
  update(
    dt: number,
    getVoxel: VoxelGetter,
    players: Map<string, PlayerSim>
  ): GrenadeExplosionResult[] {
    const explosions: GrenadeExplosionResult[] = [];

    for (const grenade of this.grenades) {
      if (!grenade.alive) continue;

      // --- Apply gravity ---
      grenade.velocity.y += GRAVITY * dt;

      // --- Compute candidate position per axis and bounce ---
      const candidateX = grenade.position.x + grenade.velocity.x * dt;
      const candidateY = grenade.position.y + grenade.velocity.y * dt;
      const candidateZ = grenade.position.z + grenade.velocity.z * dt;

      // Check X axis (water is passable, not solid)
      const vxCheck = getVoxel(Math.floor(candidateX), Math.floor(grenade.position.y), Math.floor(grenade.position.z));
      if (vxCheck !== 0 && vxCheck !== MAT_WATER) {
        grenade.velocity.x = -grenade.velocity.x * GRENADE_BOUNCINESS;
        grenade.velocity.y *= (1 - GRENADE_BOUNCE_DRAG);
        grenade.velocity.z *= (1 - GRENADE_BOUNCE_DRAG);
      } else {
        grenade.position.x = candidateX;
      }

      // Check Y axis
      const vyCheck = getVoxel(Math.floor(grenade.position.x), Math.floor(candidateY), Math.floor(grenade.position.z));
      if (vyCheck !== 0 && vyCheck !== MAT_WATER) {
        grenade.velocity.y = -grenade.velocity.y * GRENADE_BOUNCINESS;
        grenade.velocity.x *= (1 - GRENADE_BOUNCE_DRAG);
        grenade.velocity.z *= (1 - GRENADE_BOUNCE_DRAG);
      } else {
        grenade.position.y = candidateY;
      }

      // Check Z axis
      const vzCheck = getVoxel(Math.floor(grenade.position.x), Math.floor(grenade.position.y), Math.floor(candidateZ));
      if (vzCheck !== 0 && vzCheck !== MAT_WATER) {
        grenade.velocity.z = -grenade.velocity.z * GRENADE_BOUNCINESS;
        grenade.velocity.x *= (1 - GRENADE_BOUNCE_DRAG);
        grenade.velocity.y *= (1 - GRENADE_BOUNCE_DRAG);
      } else {
        grenade.position.z = candidateZ;
      }

      // --- Fuse countdown ---
      grenade.fuseRemaining -= dt;

      if (grenade.fuseRemaining <= 0) {
        grenade.alive = false;

        // --- Explosion: deal damage to nearby enemy players ---
        const hits: Array<{ playerId: string; damage: number; killed: boolean }> = [];

        for (const player of players.values()) {
          // Skip dead players
          if (!player.alive) continue;

          // No friendly fire
          if (player.team === grenade.ownerTeam) continue;

          // Distance from explosion center to player center mass
          // Player position is at feet; use center of body for distance check
          const playerCenter: Vec3 = {
            x: player.position.x,
            y: player.position.y + PLAYER_HEIGHT / 2,
            z: player.position.z,
          };

          const dx = grenade.position.x - playerCenter.x;
          const dy = grenade.position.y - playerCenter.y;
          const dz = grenade.position.z - playerCenter.z;
          const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);

          if (distance > GRENADE_DAMAGE_RADIUS) continue;

          // Linear falloff: full damage at center, zero at edge
          const damage = GRENADE_DAMAGE * (1 - distance / GRENADE_DAMAGE_RADIUS);
          const killed = player.takeDamage(Math.round(damage));

          hits.push({
            playerId: player.id,
            damage: Math.round(damage),
            killed,
          });
        }

        explosions.push({
          position: { ...grenade.position },
          ownerId: grenade.ownerId,
          ownerTeam: grenade.ownerTeam,
          hits,
        });
      }
    }

    // Remove dead grenades (exploded)
    this.grenades = this.grenades.filter((g) => g.alive);

    return explosions;
  }

  /** Get all alive grenade states for broadcasting to clients */
  getStates(): GrenadeState[] {
    return this.grenades.map((g) => ({
      id: g.id,
      ownerId: g.ownerId,
      ownerTeam: g.ownerTeam,
      position: { ...g.position },
      velocity: { ...g.velocity },
      fuseRemaining: g.fuseRemaining,
    }));
  }
}
