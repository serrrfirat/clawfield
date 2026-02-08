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
  MAX_HEALTH,
  aimDirection,
  PLAYER_HEIGHT,
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
 *
 * Grenade gadgets (Assault class) are handled by the existing GrenadeManager.
 */
export class GadgetManager {
  private gadgets = new Map<number, ActiveGadget>();
  private nextId = 1;
  private spottedEnemies: SpottedEnemy[] = [];

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

  /** Spawn a gadget based on player class */
  spawn(player: PlayerSim): void {
    const classDef = CLASSES[player.classId as ClassId];
    if (!classDef) return;

    // Use the first gadget for the class (simplified — no gadget selection UI yet)
    const gadgetId = classDef.gadgets[0];

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

      case GadgetId.SpottingScope: {
        // Instant effect: raycast in aim direction and mark enemies
        this.spotEnemies(player);
        break;
      }

      default:
        // Other gadgets not yet implemented
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

  private _pendingSpot: {
    playerId: string;
    team: number;
    position: Vec3;
    yaw: number;
    pitch: number;
  } | null = null;

  /** Main update tick — processes gadget effects */
  update(dt: number, players: Map<string, PlayerSim>): { spottedPositions: Vec3[] | null } {
    let newSpottedPositions: Vec3[] | null = null;

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
      }

      // Remove medkit if it's healed enough
      if (gadget.type === GadgetId.Medkit && gadget.totalHealed !== undefined && gadget.totalHealed >= 200) {
        this.gadgets.delete(id);
      }
    }

    return { spottedPositions: newSpottedPositions };
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
