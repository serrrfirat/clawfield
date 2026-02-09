import type { Vec3 } from '@clawfield/shared';
import {
  GadgetId,
  ClassId,
  CLASSES,
  GADGET_MEDKIT_RADIUS,
  GADGET_MEDKIT_HEAL_RATE,
  GADGET_MEDKIT_DURATION,
  GADGET_AMMO_RADIUS,
  GADGET_AMMO_INTERVAL,
  GADGET_AMMO_DURATION,
  GADGET_SPOT_DURATION,
  GADGET_SPOT_CONE,
  GADGET_COVER_WIDTH,
  GADGET_COVER_HEIGHT,
  GADGET_COVER_DURATION,
  GADGET_COVER_DISTANCE,
  GADGET_COVER_MATERIAL,
  GADGET_BANDAGE_HEAL,
  GADGET_CLAYMORE_RADIUS,
  GADGET_CLAYMORE_DAMAGE,
  GADGET_CLAYMORE_DURATION,
  MAX_HEALTH,
  aimDirection,
  PLAYER_HEIGHT,
  setVoxel,
  getVoxel,
} from '@clawfield/shared';
import type { GadgetState } from '@clawfield/shared';
import { PlayerSim } from './player-sim.js';

interface ActiveGadget {
  id: number;
  type: GadgetId;
  ownerId: string;
  ownerTeam: number;
  position: Vec3;
  lifetime: number;
  // Medkit specific
  totalHealed?: number;
  // Ammo box specific
  ammoTimer?: number;
  // Deploy cover specific — track placed voxel positions for removal
  coverVoxels?: { x: number; y: number; z: number }[];
  // Claymore specific — aim yaw for directional check
  aimYaw?: number;
}

/** Voxel change for network sync */
export interface VoxelChange {
  x: number;
  y: number;
  z: number;
  material: number;
}

interface SpottedEnemy {
  position: Vec3;
  timeRemaining: number;
}

/**
 * Server-side gadget manager.
 *
 * Handles spawning and ticking class gadgets:
 * - Medkit: area heal for friendly players over time
 * - AmmoBox: periodically restores ammo for nearby friendlies
 * - SpottingScope: instant cone-based enemy detection
 * - DeployCover: places a temporary voxel wall in front of the player
 *
 * Grenade gadgets (Assault class) are handled by the existing GrenadeManager.
 */
export class GadgetManager {
  private gadgets = new Map<number, ActiveGadget>();
  private nextId = 1;
  private spottedEnemies: SpottedEnemy[] = [];
  /** Reference to server chunk map for deploy cover voxel placement */
  private chunks: Map<string, Uint8Array> | null = null;
  /** Pending voxel changes to broadcast to clients */
  private pendingVoxelChanges: VoxelChange[] = [];

  /** Set the chunk map reference (called once from game loop) */
  setChunks(chunks: Map<string, Uint8Array>): void {
    this.chunks = chunks;
  }

  /** Drain pending voxel changes (called by game loop for broadcasting) */
  drainVoxelChanges(): VoxelChange[] {
    if (this.pendingVoxelChanges.length === 0) return [];
    const changes = this.pendingVoxelChanges;
    this.pendingVoxelChanges = [];
    return changes;
  }

  /** Returns gadget states for network sync */
  getStates(): GadgetState[] {
    return Array.from(this.gadgets.values()).map(g => ({
      id: g.id,
      type: g.type,
      ownerId: g.ownerId,
      ownerTeam: g.ownerTeam,
      position: { ...g.position },
      lifetime: g.lifetime,
    }));
  }

  /** Get currently spotted enemy positions */
  getSpottedPositions(): Vec3[] {
    return this.spottedEnemies.map(s => ({ ...s.position }));
  }

  /** Spawn a gadget based on player class and selected gadget index */
  spawn(player: PlayerSim, gadgetIndex: number = 0): void {
    const classDef = CLASSES[player.classId as ClassId];
    if (!classDef) return;

    const gadgetId = classDef.gadgets[gadgetIndex] ?? classDef.gadgets[0];

    // Skip grenade gadgets — already handled by grenade system
    if (gadgetId === GadgetId.FragGrenade || gadgetId === GadgetId.SmokeGrenade) return;

    // Determine gadget behavior
    switch (gadgetId) {
      case GadgetId.Medkit:
      case GadgetId.AmmoBox: {
        // Place at player's feet
        const gadget: ActiveGadget = {
          id: this.nextId++,
          type: gadgetId,
          ownerId: player.id,
          ownerTeam: player.team,
          position: { x: player.position.x, y: player.position.y, z: player.position.z },
          lifetime: gadgetId === GadgetId.Medkit ? GADGET_MEDKIT_DURATION : GADGET_AMMO_DURATION,
          totalHealed: gadgetId === GadgetId.Medkit ? 0 : undefined,
          ammoTimer: gadgetId === GadgetId.AmmoBox ? 0 : undefined,
        };
        this.gadgets.set(gadget.id, gadget);
        break;
      }

      case GadgetId.Bandage: {
        // Instant self-heal, no persistent object
        player.health = Math.min(MAX_HEALTH, player.health + GADGET_BANDAGE_HEAL);
        break;
      }

      case GadgetId.SpottingScope: {
        // Instant effect: raycast in aim direction and mark enemies
        this.spotEnemies(player);
        break;
      }

      case GadgetId.Claymore: {
        // Place proximity mine at player's feet
        const gadget: ActiveGadget = {
          id: this.nextId++,
          type: GadgetId.Claymore,
          ownerId: player.id,
          ownerTeam: player.team,
          position: { x: player.position.x, y: player.position.y, z: player.position.z },
          lifetime: GADGET_CLAYMORE_DURATION,
          aimYaw: player.yaw,
        };
        this.gadgets.set(gadget.id, gadget);
        break;
      }

      case GadgetId.RepairTool: {
        // Deploy Cover: place a voxel wall in front of the player
        this.deployCover(player);
        break;
      }

      default:
        break;
    }
  }

  /** Spot enemies in the player's aim cone */
  private spotEnemies(player: PlayerSim): void {
    // Store the spotting request; actual enemy detection happens in update()
    this._pendingSpot = {
      playerId: player.id,
      team: player.team,
      position: { ...player.position },
      yaw: player.yaw,
      pitch: player.pitch,
    };
  }

  /** Deploy a temporary voxel wall in front of the player */
  private deployCover(player: PlayerSim): void {
    if (!this.chunks) return;

    // Calculate position in front of the player
    const dir = aimDirection(player.yaw, 0); // ignore pitch — wall is always vertical
    const centerX = Math.floor(player.position.x + dir.x * GADGET_COVER_DISTANCE);
    const baseY = Math.floor(player.position.y);
    const centerZ = Math.floor(player.position.z + dir.z * GADGET_COVER_DISTANCE);

    // Determine wall orientation: perpendicular to aim direction
    // If aiming mostly along X, wall extends along Z (and vice versa)
    const isXAligned = Math.abs(dir.x) > Math.abs(dir.z);

    const placedVoxels: { x: number; y: number; z: number }[] = [];
    const halfW = Math.floor(GADGET_COVER_WIDTH / 2);

    for (let h = 0; h < GADGET_COVER_HEIGHT; h++) {
      for (let w = -halfW; w <= halfW; w++) {
        const wx = isXAligned ? centerX : centerX + w;
        const wy = baseY + h;
        const wz = isXAligned ? centerZ + w : centerZ;

        // Only place if the voxel is air (don't overwrite existing geometry)
        if (getVoxel(this.chunks, wx, wy, wz) === 0) {
          setVoxel(this.chunks, wx, wy, wz, GADGET_COVER_MATERIAL);
          placedVoxels.push({ x: wx, y: wy, z: wz });
          this.pendingVoxelChanges.push({ x: wx, y: wy, z: wz, material: GADGET_COVER_MATERIAL });
        }
      }
    }

    if (placedVoxels.length > 0) {
      const gadget: ActiveGadget = {
        id: this.nextId++,
        type: GadgetId.RepairTool, // Using RepairTool as the Engineer's deploy cover gadget
        ownerId: player.id,
        ownerTeam: player.team,
        position: { x: centerX, y: baseY, z: centerZ },
        lifetime: GADGET_COVER_DURATION,
        coverVoxels: placedVoxels,
      };
      this.gadgets.set(gadget.id, gadget);
    }
  }

  private _pendingSpot: {
    playerId: string;
    team: number;
    position: Vec3;
    yaw: number;
    pitch: number;
  } | null = null;

  /** Main update tick — processes gadget effects */
  update(dt: number, players: Map<string, PlayerSim>): { spottedPositions: Vec3[] | null; spotterTeam: number } {
    let newSpottedPositions: Vec3[] | null = null;
    let spotterTeam = -1;

    // Process pending spot request
    if (this._pendingSpot) {
      const spot = this._pendingSpot;
      this._pendingSpot = null;

      const dir = aimDirection(spot.yaw, spot.pitch);
      const eyeY = spot.position.y + PLAYER_HEIGHT - 0.1;
      const eyePos: Vec3 = { x: spot.position.x, y: eyeY, z: spot.position.z };

      const spotted: Vec3[] = [];
      for (const player of players.values()) {
        if (player.team === spot.team) continue;
        if (!player.alive) continue;
        if (player.id === spot.playerId) continue;

        // Check if enemy is within the cone
        const dx = player.position.x - eyePos.x;
        const dy = (player.position.y + PLAYER_HEIGHT * 0.5) - eyePos.y;
        const dz = player.position.z - eyePos.z;
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (dist < 0.1 || dist > 100) continue;

        // Angle between aim direction and direction to enemy
        const dot = (dx * dir.x + dy * dir.y + dz * dir.z) / dist;
        const angle = Math.acos(Math.max(-1, Math.min(1, dot)));

        if (angle < GADGET_SPOT_CONE) {
          spotted.push({ ...player.position });
          this.spottedEnemies.push({
            position: { ...player.position },
            timeRemaining: GADGET_SPOT_DURATION,
          });
        }
      }

      if (spotted.length > 0) {
        newSpottedPositions = spotted;
        spotterTeam = spot.team;
      }
    }

    // Update spotted enemy timers
    for (let i = this.spottedEnemies.length - 1; i >= 0; i--) {
      this.spottedEnemies[i]!.timeRemaining -= dt;
      if (this.spottedEnemies[i]!.timeRemaining <= 0) {
        this.spottedEnemies.splice(i, 1);
      }
    }

    // Process active gadgets
    for (const [id, gadget] of this.gadgets) {
      gadget.lifetime -= dt;

      if (gadget.lifetime <= 0) {
        // Remove deploy cover voxels when lifetime expires
        if (gadget.coverVoxels && this.chunks) {
          for (const v of gadget.coverVoxels) {
            // Only remove if the voxel is still our cover material
            if (getVoxel(this.chunks, v.x, v.y, v.z) === GADGET_COVER_MATERIAL) {
              setVoxel(this.chunks, v.x, v.y, v.z, 0);
              this.pendingVoxelChanges.push({ x: v.x, y: v.y, z: v.z, material: 0 });
            }
          }
        }
        this.gadgets.delete(id);
        continue;
      }

      switch (gadget.type) {
        case GadgetId.Medkit:
          this.tickMedkit(gadget, dt, players);
          break;
        case GadgetId.AmmoBox:
          this.tickAmmoBox(gadget, dt, players);
          break;
        case GadgetId.Claymore: {
          const exploded = this.tickClaymore(gadget, players);
          if (exploded) {
            this.gadgets.delete(id);
            continue;
          }
          break;
        }
      }

      // Remove medkit if it's healed enough
      if (gadget.type === GadgetId.Medkit && gadget.totalHealed !== undefined && gadget.totalHealed >= 200) {
        this.gadgets.delete(id);
      }
    }

    return { spottedPositions: newSpottedPositions, spotterTeam };
  }

  /** Tick claymore — check for nearby enemies and explode */
  private tickClaymore(gadget: ActiveGadget, players: Map<string, PlayerSim>): boolean {
    for (const player of players.values()) {
      if (!player.alive) continue;
      if (player.team === gadget.ownerTeam) continue;

      const dx = player.position.x - gadget.position.x;
      const dy = player.position.y - gadget.position.y;
      const dz = player.position.z - gadget.position.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

      if (dist <= GADGET_CLAYMORE_RADIUS) {
        // Explode! Damage all enemies in radius
        for (const target of players.values()) {
          if (!target.alive) continue;
          if (target.team === gadget.ownerTeam) continue;

          const tdx = target.position.x - gadget.position.x;
          const tdy = target.position.y - gadget.position.y;
          const tdz = target.position.z - gadget.position.z;
          const tdist = Math.sqrt(tdx * tdx + tdy * tdy + tdz * tdz);

          if (tdist <= GADGET_CLAYMORE_RADIUS) {
            const falloff = 1 - tdist / GADGET_CLAYMORE_RADIUS;
            const damage = Math.floor(GADGET_CLAYMORE_DAMAGE * falloff);
            if (damage > 0) {
              target.recordDamageFrom(gadget.ownerId);
              // takeDamage returns the result but claymore kills are handled in game-loop
              target.takeDamage(damage);
            }
          }
        }
        return true; // exploded
      }
    }
    return false;
  }

  private tickMedkit(gadget: ActiveGadget, dt: number, players: Map<string, PlayerSim>): void {
    const healAmount = GADGET_MEDKIT_HEAL_RATE * dt;

    for (const player of players.values()) {
      if (!player.alive) continue;
      if (player.team !== gadget.ownerTeam) continue;
      if (player.health >= MAX_HEALTH) continue;

      const dx = player.position.x - gadget.position.x;
      const dy = player.position.y - gadget.position.y;
      const dz = player.position.z - gadget.position.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

      if (dist <= GADGET_MEDKIT_RADIUS) {
        const oldHealth = player.health;
        player.health = Math.min(MAX_HEALTH, player.health + healAmount);
        const actualHealed = player.health - oldHealth;
        if (gadget.totalHealed !== undefined) {
          gadget.totalHealed += actualHealed;
        }
      }
    }
  }

  private tickAmmoBox(gadget: ActiveGadget, dt: number, players: Map<string, PlayerSim>): void {
    if (gadget.ammoTimer === undefined) return;
    gadget.ammoTimer += dt;

    if (gadget.ammoTimer >= GADGET_AMMO_INTERVAL) {
      gadget.ammoTimer -= GADGET_AMMO_INTERVAL;

      for (const player of players.values()) {
        if (!player.alive) continue;
        if (player.team !== gadget.ownerTeam) continue;
        if (player.ammo >= player.weapon.magSize) continue;

        const dx = player.position.x - gadget.position.x;
        const dy = player.position.y - gadget.position.y;
        const dz = player.position.z - gadget.position.z;
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

        if (dist <= GADGET_AMMO_RADIUS) {
          // Restore one magazine worth
          player.ammo = player.weapon.magSize;
        }
      }
    }
  }
}
