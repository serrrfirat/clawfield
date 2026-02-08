import type { Vec3, InputState, PlayerState } from '@clawfield/shared';
import {
  movePlayer,
  type VoxelGetter,
  Team,
  MAX_HEALTH,
  ClassId,
  CLASSES,
  WEAPONS,
  fireInterval,
  SPRINT_FIRE_DELAY,
  CROUCH_HEIGHT,
  PLAYER_HEIGHT,
  GRENADE_MAX_COUNT,
  type WeaponStats,
} from '@clawfield/shared';

/** Queued input from a client */
export interface QueuedInput {
  seq: number;
  input: InputState;
  dt: number;
}

/**
 * Server-side player simulation.
 * Processes queued inputs each tick using shared physics.
 * Tracks health, team, class, weapon, ammo, and reload state.
 */
export class PlayerSim {
  readonly id: string;
  name: string;
  position: Vec3;
  velocity: Vec3 = { x: 0, y: 0, z: 0 };
  yaw = 0;
  pitch = 0;
  grounded = false;
  inWater = false;

  // --- Combat state ---
  health: number = MAX_HEALTH;
  alive: boolean = true;
  team: Team = Team.Alpha;
  classId: ClassId = ClassId.Assault;
  weapon: WeaponStats = WEAPONS[CLASSES[ClassId.Assault].defaultPrimary];
  ammo: number = WEAPONS[CLASSES[ClassId.Assault].defaultPrimary].magSize;
  reloading: boolean = false;
  reloadTimer: number = 0;
  lastFireTime: number = 0; // timestamp in ms
  deathTime: number = 0; // timestamp in ms when player died
  /** When true, player is on the deploy screen and won't auto-respawn */
  waitingToDeploy: boolean = false;

  /** Time remaining before firing is allowed after sprint (seconds) */
  sprintFireTimer: number = 0;
  /** Whether the player is currently crouching (for eye offset) */
  crouching: boolean = false;

  /** Grenades remaining */
  grenadeCount: number = 2;
  /** Last grenade throw timestamp (ms) */
  lastGrenadeTime: number = 0;

  /** Last gadget use timestamp (ms) */
  lastGadgetTime: number = 0;

  // --- KDA tracking ---
  kills = 0;
  deaths = 0;
  assists = 0;
  score = 0;

  /** Track recent damage sources for assist credit: Map<attackerId, lastDamageTime> */
  recentDamagers = new Map<string, number>();

  /** Record that a player damaged us (for assist tracking) */
  recordDamageFrom(attackerId: string): void {
    this.recentDamagers.set(attackerId, Date.now());
  }

  private inputQueue: QueuedInput[] = [];
  lastAckedSeq = 0;

  /** The latest input snapshot for this tick (used by game loop for shoot checks) */
  latestInput: InputState | null = null;

  constructor(id: string, name: string, spawnPos: Vec3) {
    this.id = id;
    this.name = name;
    this.position = { ...spawnPos };
  }

  /** Queue an input from the client */
  queueInput(seq: number, input: InputState, dt: number): void {
    this.inputQueue.push({ seq, input, dt });
    // Prevent queue from growing unbounded
    if (this.inputQueue.length > 60) {
      this.inputQueue.shift();
    }
  }

  /** Process all queued inputs for this tick */
  tick(getVoxel: VoxelGetter): void {
    this.latestInput = null;

    // Update reload timer regardless of alive status
    // (so reload finishes even between ticks)
    if (this.inputQueue.length > 0) {
      let totalDt = 0;
      for (const qi of this.inputQueue) {
        totalDt += qi.dt;
      }
      this.updateReload(totalDt);
    }

    // Dead players don't move
    if (!this.alive) {
      // Still consume the queue so ack seq advances
      for (const qi of this.inputQueue) {
        this.lastAckedSeq = qi.seq;
      }
      this.inputQueue = [];
      return;
    }

    for (const qi of this.inputQueue) {
      const result = movePlayer(
        this.position,
        this.velocity,
        qi.input,
        qi.dt,
        getVoxel
      );
      this.position = result.position;
      this.velocity = result.velocity;
      this.grounded = result.grounded;
      this.inWater = result.inWater;
      this.yaw = qi.input.yaw;
      this.pitch = qi.input.pitch;
      this.lastAckedSeq = qi.seq;
      this.latestInput = qi.input;

      // Track sprint fire delay: sprinting resets the timer, otherwise count down
      const isSprinting = qi.input.sprint && (qi.input.forward || qi.input.back || qi.input.left || qi.input.right);
      if (isSprinting) {
        this.sprintFireTimer = SPRINT_FIRE_DELAY;
      } else if (this.sprintFireTimer > 0) {
        this.sprintFireTimer -= qi.dt;
      }

      // Track crouch state for eye offset calculation
      this.crouching = qi.input.crouch && !qi.input.sprint;

      // Start reload if client pressed reload
      if (qi.input.reload && !this.reloading && this.ammo < this.weapon.magSize) {
        this.startReload();
      }
    }
    this.inputQueue = [];
  }

  /**
   * Apply damage to this player.
   * Returns true if the damage killed the player.
   */
  takeDamage(amount: number): boolean {
    if (!this.alive) return false;
    this.health = Math.max(0, this.health - amount);
    if (this.health <= 0) {
      this.alive = false;
      this.deathTime = Date.now();
      return true;
    }
    return false;
  }

  /**
   * Attempt to fire the weapon.
   * Checks fire rate cooldown, ammo, and sprint state.
   * Returns true if the shot is allowed.
   */
  tryFire(now: number): boolean {
    if (!this.alive) return false;
    if (this.reloading) return false;
    if (this.ammo <= 0) return false;

    // Sprint prevents firing (with delay after releasing sprint)
    if (this.sprintFireTimer > 0) return false;

    const interval = fireInterval(this.weapon) * 1000; // convert to ms
    if (now - this.lastFireTime < interval) return false;

    this.ammo--;
    this.lastFireTime = now;

    // Auto-reload when magazine is empty
    if (this.ammo <= 0) {
      this.startReload();
    }

    return true;
  }

  /** Begin reloading */
  startReload(): void {
    if (this.reloading) return;
    if (this.ammo >= this.weapon.magSize) return;
    this.reloading = true;
    this.reloadTimer = this.weapon.reloadTime;
  }

  /** Update reload progress. dt in seconds. */
  updateReload(dt: number): void {
    if (!this.reloading) return;
    this.reloadTimer -= dt;
    if (this.reloadTimer <= 0) {
      this.reloading = false;
      this.reloadTimer = 0;
      this.ammo = this.weapon.magSize;
    }
  }

  /** Respawn the player at the given position */
  respawn(pos: Vec3): void {
    this.position = { ...pos };
    this.velocity = { x: 0, y: 0, z: 0 };
    this.health = MAX_HEALTH;
    this.alive = true;
    this.ammo = this.weapon.magSize;
    this.reloading = false;
    this.reloadTimer = 0;
    this.lastFireTime = 0;
    this.sprintFireTimer = 0;
    this.crouching = false;
    this.grenadeCount = 2;
    this.lastGrenadeTime = 0;
    this.lastGadgetTime = 0;
    this.recentDamagers.clear();
  }

  /** Change class and update weapon accordingly */
  selectClass(classId: ClassId, weaponId?: string): void {
    const classDef = CLASSES[classId];
    if (!classDef) return;
    this.classId = classId;
    // Use requested weapon if it belongs to this class, otherwise default
    if (weaponId && (weaponId === classDef.defaultPrimary || weaponId === classDef.altPrimary)) {
      this.weapon = WEAPONS[weaponId as import('@clawfield/shared').WeaponId];
    } else {
      this.weapon = WEAPONS[classDef.defaultPrimary];
    }
    this.ammo = this.weapon.magSize;
    this.reloading = false;
    this.reloadTimer = 0;
  }

  /** Get current state snapshot */
  getState(): PlayerState {
    return {
      id: this.id,
      name: this.name,
      position: { ...this.position },
      yaw: this.yaw,
      pitch: this.pitch,
      grounded: this.grounded,
      inWater: this.inWater,
      health: this.health,
      alive: this.alive,
      team: this.team,
      classId: this.classId,
      ammo: this.ammo,
      maxAmmo: this.weapon.magSize,
      reloading: this.reloading,
    };
  }
}
