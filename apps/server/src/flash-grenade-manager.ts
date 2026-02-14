import type { Vec3, FlashGrenadeState, CollisionDisc } from '@clawfield/shared';
import {
  GRAVITY,
  FLASH_GRENADE_THROW_SPEED,
  FLASH_GRENADE_FUSE_TIME,
  FLASH_GRENADE_RADIUS,
  FLASH_GRENADE_BOUNCINESS,
  FLASH_GRENADE_BOUNCE_DRAG,
  isWater,
  type VoxelGetter,
} from '@clawfield/shared';

class FlashGrenade {
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
    this.fuseRemaining = FLASH_GRENADE_FUSE_TIME;
    this.alive = true;
  }
}

const FLASH_GRENADE_COLLIDER_RADIUS = 0.28;

export interface FlashDetonationResult {
  ownerId: string;
  position: Vec3;
  radius: number;
}

export class FlashGrenadeManager {
  private grenades: FlashGrenade[] = [];
  private nextId = 1;

  spawn(ownerId: string, eyePos: Vec3, direction: Vec3): void {
    const velocity: Vec3 = {
      x: direction.x * FLASH_GRENADE_THROW_SPEED,
      y: direction.y * FLASH_GRENADE_THROW_SPEED,
      z: direction.z * FLASH_GRENADE_THROW_SPEED,
    };

    this.grenades.push(new FlashGrenade(this.nextId++, ownerId, eyePos, velocity));
  }

  update(dt: number, getVoxel: VoxelGetter, obstacles: CollisionDisc[] = []): FlashDetonationResult[] {
    const detonations: FlashDetonationResult[] = [];

    for (const grenade of this.grenades) {
      if (!grenade.alive) continue;

      grenade.velocity.y += GRAVITY * dt;

      const candidateX = grenade.position.x + grenade.velocity.x * dt;
      const candidateY = grenade.position.y + grenade.velocity.y * dt;
      const candidateZ = grenade.position.z + grenade.velocity.z * dt;

      const vxCheck = getVoxel(Math.floor(candidateX), Math.floor(grenade.position.y), Math.floor(grenade.position.z));
      if (vxCheck !== 0 && !isWater(vxCheck)) {
        grenade.velocity.x = -grenade.velocity.x * FLASH_GRENADE_BOUNCINESS;
        grenade.velocity.y *= 1 - FLASH_GRENADE_BOUNCE_DRAG;
        grenade.velocity.z *= 1 - FLASH_GRENADE_BOUNCE_DRAG;
      } else {
        grenade.position.x = candidateX;
      }

      const vyCheck = getVoxel(Math.floor(grenade.position.x), Math.floor(candidateY), Math.floor(grenade.position.z));
      if (vyCheck !== 0 && !isWater(vyCheck)) {
        grenade.velocity.y = -grenade.velocity.y * FLASH_GRENADE_BOUNCINESS;
        grenade.velocity.x *= 1 - FLASH_GRENADE_BOUNCE_DRAG;
        grenade.velocity.z *= 1 - FLASH_GRENADE_BOUNCE_DRAG;
      } else {
        grenade.position.y = candidateY;
      }

      const vzCheck = getVoxel(Math.floor(grenade.position.x), Math.floor(grenade.position.y), Math.floor(candidateZ));
      if (vzCheck !== 0 && !isWater(vzCheck)) {
        grenade.velocity.z = -grenade.velocity.z * FLASH_GRENADE_BOUNCINESS;
        grenade.velocity.x *= 1 - FLASH_GRENADE_BOUNCE_DRAG;
        grenade.velocity.y *= 1 - FLASH_GRENADE_BOUNCE_DRAG;
      } else {
        grenade.position.z = candidateZ;
      }

      if (obstacles.length > 0) {
        for (const o of obstacles) {
          const dx = grenade.position.x - o.x;
          const dz = grenade.position.z - o.z;
          const minDist = o.r + FLASH_GRENADE_COLLIDER_RADIUS;
          const distSq = dx * dx + dz * dz;
          if (distSq >= minDist * minDist) continue;

          const dist = Math.sqrt(Math.max(distSq, 1e-8));
          const nx = dx / dist;
          const nz = dz / dist;
          grenade.position.x = o.x + nx * minDist;
          grenade.position.z = o.z + nz * minDist;

          const into = grenade.velocity.x * nx + grenade.velocity.z * nz;
          if (into < 0) {
            grenade.velocity.x -= (1 + FLASH_GRENADE_BOUNCINESS) * into * nx;
            grenade.velocity.z -= (1 + FLASH_GRENADE_BOUNCINESS) * into * nz;
            grenade.velocity.x *= 1 - FLASH_GRENADE_BOUNCE_DRAG;
            grenade.velocity.z *= 1 - FLASH_GRENADE_BOUNCE_DRAG;
            grenade.velocity.y *= 1 - FLASH_GRENADE_BOUNCE_DRAG * 0.35;
          }
        }
      }

      grenade.fuseRemaining -= dt;
      if (grenade.fuseRemaining <= 0) {
        grenade.alive = false;
        detonations.push({
          ownerId: grenade.ownerId,
          position: { ...grenade.position },
          radius: FLASH_GRENADE_RADIUS,
        });
      }
    }

    this.grenades = this.grenades.filter((g) => g.alive);
    return detonations;
  }

  getStates(): FlashGrenadeState[] {
    return this.grenades.map((g) => ({
      id: g.id,
      ownerId: g.ownerId,
      position: { ...g.position },
      velocity: { ...g.velocity },
      fuseRemaining: g.fuseRemaining,
    }));
  }
}
