import type { Vec3, SmokeGrenadeState, CollisionDisc } from '@clawfield/shared';
import {
  GRAVITY,
  SMOKE_GRENADE_THROW_SPEED,
  SMOKE_GRENADE_FUSE_TIME,
  SMOKE_GRENADE_BOUNCINESS,
  SMOKE_GRENADE_BOUNCE_DRAG,
  SMOKE_GRENADE_RADIUS,
  SMOKE_GRENADE_DURATION,
  isWater,
  type VoxelGetter,
} from '@clawfield/shared';

/** Internal smoke grenade representation */
class SmokeGrenade {
  id: number;
  ownerId: string;
  position: Vec3;
  velocity: Vec3;
  fuseRemaining: number;
  alive: boolean;

  constructor(id: number, ownerId: string, position: Vec3, velocity: Vec3) {
    this.id = id;
    this.ownerId = ownerId;
    this.position = { ...position };
    this.velocity = { ...velocity };
    this.fuseRemaining = SMOKE_GRENADE_FUSE_TIME;
    this.alive = true;
  }
}

const SMOKE_GRENADE_COLLIDER_RADIUS = 0.28;

/** Result of a smoke grenade detonation — deploys a smoke cloud */
export interface SmokeDeployResult {
  position: Vec3;
  radius: number;
  duration: number;
}

/**
 * Manages smoke grenades in the game world.
 *
 * Smoke grenades follow the same ballistic arc and bounce physics as frag
 * grenades but deploy a smoke cloud instead of dealing damage.
 */
export class SmokeGrenadeManager {
  private grenades: SmokeGrenade[] = [];
  private nextId = 1;

  /** Spawn a smoke grenade thrown by a player */
  spawn(ownerId: string, eyePos: Vec3, direction: Vec3): void {
    const velocity: Vec3 = {
      x: direction.x * SMOKE_GRENADE_THROW_SPEED,
      y: direction.y * SMOKE_GRENADE_THROW_SPEED,
      z: direction.z * SMOKE_GRENADE_THROW_SPEED,
    };

    const grenade = new SmokeGrenade(this.nextId++, ownerId, eyePos, velocity);
    this.grenades.push(grenade);
  }

  /**
   * Advance all smoke grenades by dt seconds.
   * Returns an array of deploy results for grenades whose fuse expired.
   */
  update(dt: number, getVoxel: VoxelGetter, obstacles: CollisionDisc[] = []): SmokeDeployResult[] {
    const deploys: SmokeDeployResult[] = [];

    for (const grenade of this.grenades) {
      if (!grenade.alive) continue;

      // Apply gravity
      grenade.velocity.y += GRAVITY * dt;

      // Compute candidate position per axis and bounce
      const candidateX = grenade.position.x + grenade.velocity.x * dt;
      const candidateY = grenade.position.y + grenade.velocity.y * dt;
      const candidateZ = grenade.position.z + grenade.velocity.z * dt;

      // Check X axis
      const vxCheck = getVoxel(
        Math.floor(candidateX),
        Math.floor(grenade.position.y),
        Math.floor(grenade.position.z),
      );
      if (vxCheck !== 0 && !isWater(vxCheck)) {
        grenade.velocity.x = -grenade.velocity.x * SMOKE_GRENADE_BOUNCINESS;
        grenade.velocity.y *= 1 - SMOKE_GRENADE_BOUNCE_DRAG;
        grenade.velocity.z *= 1 - SMOKE_GRENADE_BOUNCE_DRAG;
      } else {
        grenade.position.x = candidateX;
      }

      // Check Y axis
      const vyCheck = getVoxel(
        Math.floor(grenade.position.x),
        Math.floor(candidateY),
        Math.floor(grenade.position.z),
      );
      if (vyCheck !== 0 && !isWater(vyCheck)) {
        grenade.velocity.y = -grenade.velocity.y * SMOKE_GRENADE_BOUNCINESS;
        grenade.velocity.x *= 1 - SMOKE_GRENADE_BOUNCE_DRAG;
        grenade.velocity.z *= 1 - SMOKE_GRENADE_BOUNCE_DRAG;
      } else {
        grenade.position.y = candidateY;
      }

      // Check Z axis
      const vzCheck = getVoxel(
        Math.floor(grenade.position.x),
        Math.floor(grenade.position.y),
        Math.floor(candidateZ),
      );
      if (vzCheck !== 0 && !isWater(vzCheck)) {
        grenade.velocity.z = -grenade.velocity.z * SMOKE_GRENADE_BOUNCINESS;
        grenade.velocity.x *= 1 - SMOKE_GRENADE_BOUNCE_DRAG;
        grenade.velocity.y *= 1 - SMOKE_GRENADE_BOUNCE_DRAG;
      } else {
        grenade.position.z = candidateZ;
      }

      // Optional obstacle-disc collision (server-authoritative map/placement blockers)
      if (obstacles.length > 0) {
        for (const o of obstacles) {
          const dx = grenade.position.x - o.x;
          const dz = grenade.position.z - o.z;
          const minDist = o.r + SMOKE_GRENADE_COLLIDER_RADIUS;
          const distSq = dx * dx + dz * dz;
          if (distSq >= minDist * minDist) continue;

          const dist = Math.sqrt(Math.max(distSq, 1e-8));
          const nx = dx / dist;
          const nz = dz / dist;

          // Push grenade out of obstacle to avoid tunneling/sticking.
          grenade.position.x = o.x + nx * minDist;
          grenade.position.z = o.z + nz * minDist;

          // Reflect horizontal velocity only when moving into the obstacle.
          const into = grenade.velocity.x * nx + grenade.velocity.z * nz;
          if (into < 0) {
            grenade.velocity.x -= (1 + SMOKE_GRENADE_BOUNCINESS) * into * nx;
            grenade.velocity.z -= (1 + SMOKE_GRENADE_BOUNCINESS) * into * nz;
            grenade.velocity.x *= 1 - SMOKE_GRENADE_BOUNCE_DRAG;
            grenade.velocity.z *= 1 - SMOKE_GRENADE_BOUNCE_DRAG;
            grenade.velocity.y *= 1 - SMOKE_GRENADE_BOUNCE_DRAG * 0.35;
          }
        }
      }

      // Fuse countdown
      grenade.fuseRemaining -= dt;

      if (grenade.fuseRemaining <= 0) {
        grenade.alive = false;
        deploys.push({
          position: { ...grenade.position },
          radius: SMOKE_GRENADE_RADIUS,
          duration: SMOKE_GRENADE_DURATION,
        });
      }
    }

    // Remove dead grenades
    this.grenades = this.grenades.filter((g) => g.alive);

    return deploys;
  }

  /** Get all alive smoke grenade states for broadcasting */
  getStates(): SmokeGrenadeState[] {
    return this.grenades.map((g) => ({
      id: g.id,
      ownerId: g.ownerId,
      position: { ...g.position },
      velocity: { ...g.velocity },
      fuseRemaining: g.fuseRemaining,
    }));
  }
}
