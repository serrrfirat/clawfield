import type { Vec3, InputState, PlayerState, HeightGetter } from '@clawfield/shared';
import {
  movePlayer,
  movePlayerHeightmap,
  type VoxelGetter,
  Team,
  MAX_HEALTH,
  ClassId,
  CLASSES,
  WEAPONS,
  WeaponId,
  fireInterval,
  CROUCH_HEIGHT,
  PLAYER_HEIGHT,
  GRENADE_MAX_COUNT,
  BLEEDOUT_TIME,
  DOWNED_SPEED_MULT,
  type WeaponStats,
  PLAYER_WIDTH,
} from '@clawfield/shared';
import type { DebrisPhysicsManager } from './debris-physics-manager.js';

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
  /** Aim direction for top-down mode (separate from movement yaw) */
  aimYaw: number | undefined = undefined;
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
  /** Set to true by tryFire(), reset each tick — used for remote gunshot sounds */
  firedThisTick: boolean = false;
  deathTime: number = 0; // timestamp in ms when player died
  /** When true, player is on the deploy screen and won't auto-respawn */
  waitingToDeploy: boolean = false;

  /** Session token for reconnection */
  sessionToken: string = '';
  /** Whether this player is currently disconnected */
  disconnected: boolean = false;
  /** Timestamp when the player disconnected (ms) */
  disconnectTime: number = 0;

  // --- Revive system ---
  /** Player is downed but can be revived */
  downed: boolean = false;
  /** Time remaining before the downed player bleeds out and fully dies (seconds) */
  bleedoutTimer: number = 0;
  /** Current revive progress (0 to 1). Revive completes at 1. */
  reviveProgress: number = 0;
  /** ID of the player currently reviving us, or null */
  reviverId: string | null = null;
  /** ID of the player who downed us (for kill credit on bleedout) */
  downedBy: string | null = null;

  /** Time remaining before firing is allowed after sprint (seconds) */
  sprintFireTimer: number = 0;
  /** Current spread bloom accumulation (radians above base spread) */
  currentBloom: number = 0;
  /** Rising-edge trigger pulls captured from queued inputs */
  private pendingShotIntents: number = 0;
  /** Previous frame's trigger state for rising-edge detection */
  private prevShootHeld: boolean = false;
  /** Whether the player is currently crouching (for eye offset) */
  crouching: boolean = false;

  /** Grenades remaining */
  grenadeCount: number = GRENADE_MAX_COUNT;
  /** Last grenade throw timestamp (ms) */
  lastGrenadeTime: number = 0;

  /** Last gadget use timestamp (ms) */
  lastGadgetTime: number = 0;

  // --- Secondary weapon slot (pistol) ---
  secondaryWeapon: WeaponStats = WEAPONS[WeaponId.Pistol];
  secondaryAmmo: number = WEAPONS[WeaponId.Pistol].magSize;
  secondaryReloading: boolean = false;
  secondaryReloadTimer: number = 0;
  lastSecondaryFireTime: number = 0;

  // --- Special weapon slot (e.g. Rocket Launcher for Engineer) ---
  specialWeapon: WeaponStats | null = null;
  specialAmmo: number = 0;
  specialReloading: boolean = false;
  specialReloadTimer: number = 0;
  lastSpecialFireTime: number = 0;
  /** Active weapon slot: 0 = primary, 1 = secondary (pistol), 2 = special */
  currentWeaponSlot: number = 0;
  /** Swap animation timer (can't fire during swap) */
  swapTimer: number = 0;

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

  /** Returns the active weapon (primary, secondary, or special based on current slot) */
  get activeWeapon(): WeaponStats {
    if (this.currentWeaponSlot === 1) {
      return this.secondaryWeapon;
    }
    if (this.currentWeaponSlot === 2 && this.specialWeapon) {
      return this.specialWeapon;
    }
    return this.weapon;
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
  tick(getVoxel: VoxelGetter, debrisPhysics?: DebrisPhysicsManager): void {
    this.latestInput = null;

    if (this.inputQueue.length === 0) {
      this.prevShootHeld = false;
    }

    // Update reload timer regardless of alive status
    // (so reload finishes even between ticks)
    if (this.inputQueue.length > 0) {
      let totalDt = 0;
      for (const qi of this.inputQueue) {
        totalDt += qi.dt;
      }
      this.updateReload(totalDt);
      this.updateSecondaryReload(totalDt);
      this.updateSpecialReload(totalDt);
      if (this.currentBloom > 0) {
        this.currentBloom = Math.max(0, this.currentBloom - this.activeWeapon.spreadRecovery * totalDt);
      }
      // Count down swap timer
      if (this.swapTimer > 0) {
        this.swapTimer = Math.max(0, this.swapTimer - totalDt);
      }
    }

    // Dead players don't move
    if (!this.alive && !this.downed) {
      // Still consume the queue so ack seq advances
      for (const qi of this.inputQueue) {
        this.lastAckedSeq = qi.seq;
      }
      this.inputQueue = [];
      return;
    }

    for (const qi of this.inputQueue) {
      // Downed players can crawl slowly — restrict input to movement only
      const effectiveInput: InputState = this.downed
        ? {
            ...qi.input,
            shoot: false,
            reload: false,
            sprint: false,
            throwGrenade: false,
            useGadget: false,
            scope: false,
            // Slow crawl speed by using crouch
            crouch: true,
          }
        : qi.input;

      const result = movePlayer(
        this.position,
        this.velocity,
        effectiveInput,
        this.downed ? qi.dt * DOWNED_SPEED_MULT : qi.dt,
        getVoxel
      );
      
      // Check for debris collision if debris physics is enabled
      if (debrisPhysics) {
        const height = effectiveInput.crouch ? CROUCH_HEIGHT : PLAYER_HEIGHT;
        const collision = debrisPhysics.checkPlayerCollision(
          result.position,
          PLAYER_WIDTH / 2,
          height
        );
        
        if (collision.collision && collision.normal) {
          // Push player back along collision normal
          const pushDistance = collision.penetration || 0.1;
          result.position.x += collision.normal.x * pushDistance;
          result.position.y += collision.normal.y * pushDistance;
          result.position.z += collision.normal.z * pushDistance;
          
          // Zero out velocity in the collision direction
          const dot = result.velocity.x * collision.normal.x +
                      result.velocity.y * collision.normal.y +
                      result.velocity.z * collision.normal.z;
          if (dot < 0) {
            result.velocity.x -= dot * collision.normal.x;
            result.velocity.y -= dot * collision.normal.y;
            result.velocity.z -= dot * collision.normal.z;
          }

          // Standing on top of debris counts as grounded
          if (collision.normal.y > 0.5) {
            result.grounded = true;
          }
        }
      }
      
      this.position = result.position;
      this.velocity = result.velocity;
      this.grounded = result.grounded;
      this.inWater = result.inWater;
      this.yaw = qi.input.yaw;
      this.pitch = qi.input.pitch;
      this.aimYaw = qi.input.aimYaw;
      this.lastAckedSeq = qi.seq;
      this.latestInput = this.downed ? null : qi.input;

      if (!this.downed) {
        // Track sprint fire delay: sprinting resets the timer, otherwise count down
        const isSprinting = qi.input.sprint && (qi.input.forward || qi.input.back || qi.input.left || qi.input.right);
        if (isSprinting) {
          this.sprintFireTimer = this.activeWeapon.sprintToFireTime;
        } else if (this.sprintFireTimer > 0) {
          this.sprintFireTimer -= qi.dt;
        }

        const wantsShoot = qi.input.shoot;
        if (wantsShoot && !this.prevShootHeld) {
          this.pendingShotIntents++;
        }
        this.prevShootHeld = wantsShoot;

        // Track crouch state for eye offset calculation
        this.crouching = qi.input.crouch && !qi.input.sprint;

        // Weapon slot switching (0=primary, 1=secondary, 2=special)
        const desiredSlot = qi.input.weaponSlot ?? 0;
        if (desiredSlot !== this.currentWeaponSlot && this.swapTimer <= 0) {
          // Block switching to special slot if class has no special weapon
          if (desiredSlot === 2 && !this.specialWeapon) {
            // no-op
          } else {
            this.swapTimer = this.activeWeapon.swapTime;
            this.currentWeaponSlot = desiredSlot;
          }
        }

        // Start reload if client pressed reload (for the active weapon)
        if (qi.input.reload) {
          if (this.currentWeaponSlot === 0 && !this.reloading && this.ammo < this.weapon.magSize) {
            this.startReload();
          } else if (this.currentWeaponSlot === 1 && !this.secondaryReloading && this.secondaryAmmo < this.secondaryWeapon.magSize) {
            this.startSecondaryReload();
          } else if (this.currentWeaponSlot === 2 && this.specialWeapon && !this.specialReloading && this.specialAmmo < this.specialWeapon.magSize) {
            this.startSpecialReload();
          }
        }
      }
    }
    this.inputQueue = [];
  }

  /** Process all queued inputs using heightmap physics (no voxel collision) */
  tickHeightmap(getHeight: HeightGetter): void {
    this.latestInput = null;

    if (this.inputQueue.length === 0) {
      this.prevShootHeld = false;
    }

    // Update reload timer regardless of alive status
    if (this.inputQueue.length > 0) {
      let totalDt = 0;
      for (const qi of this.inputQueue) {
        totalDt += qi.dt;
      }
      this.updateReload(totalDt);
      this.updateSecondaryReload(totalDt);
      this.updateSpecialReload(totalDt);
      if (this.currentBloom > 0) {
        this.currentBloom = Math.max(0, this.currentBloom - this.activeWeapon.spreadRecovery * totalDt);
      }
      if (this.swapTimer > 0) {
        this.swapTimer = Math.max(0, this.swapTimer - totalDt);
      }
    }

    // Dead players don't move
    if (!this.alive && !this.downed) {
      for (const qi of this.inputQueue) {
        this.lastAckedSeq = qi.seq;
      }
      this.inputQueue = [];
      return;
    }

    for (const qi of this.inputQueue) {
      const effectiveInput: InputState = this.downed
        ? {
            ...qi.input,
            shoot: false,
            reload: false,
            sprint: false,
            throwGrenade: false,
            useGadget: false,
            scope: false,
            crouch: true,
          }
        : qi.input;

      const result = movePlayerHeightmap(
        this.position,
        this.velocity,
        effectiveInput,
        this.downed ? qi.dt * DOWNED_SPEED_MULT : qi.dt,
        getHeight,
      );

      this.position = result.position;
      this.velocity = result.velocity;
      this.grounded = result.grounded;
      this.inWater = result.inWater;
      this.yaw = qi.input.yaw;
      this.pitch = qi.input.pitch;
      this.aimYaw = qi.input.aimYaw;
      this.lastAckedSeq = qi.seq;
      this.latestInput = this.downed ? null : qi.input;

      if (!this.downed) {
        const isSprinting = qi.input.sprint && (qi.input.forward || qi.input.back || qi.input.left || qi.input.right);
        if (isSprinting) {
          this.sprintFireTimer = this.activeWeapon.sprintToFireTime;
        } else if (this.sprintFireTimer > 0) {
          this.sprintFireTimer -= qi.dt;
        }

        const wantsShoot = qi.input.shoot;
        if (wantsShoot && !this.prevShootHeld) {
          this.pendingShotIntents++;
        }
        this.prevShootHeld = wantsShoot;

        this.crouching = qi.input.crouch && !qi.input.sprint;

        const desiredSlot = qi.input.weaponSlot ?? 0;
        if (desiredSlot !== this.currentWeaponSlot && this.swapTimer <= 0) {
          if (desiredSlot === 2 && !this.specialWeapon) {
            // no-op
          } else {
            this.swapTimer = this.activeWeapon.swapTime;
            this.currentWeaponSlot = desiredSlot;
          }
        }

        if (qi.input.reload) {
          if (this.currentWeaponSlot === 0 && !this.reloading && this.ammo < this.weapon.magSize) {
            this.startReload();
          } else if (this.currentWeaponSlot === 1 && !this.secondaryReloading && this.secondaryAmmo < this.secondaryWeapon.magSize) {
            this.startSecondaryReload();
          } else if (this.currentWeaponSlot === 2 && this.specialWeapon && !this.specialReloading && this.specialAmmo < this.specialWeapon.magSize) {
            this.startSpecialReload();
          }
        }
      }
    }
    this.inputQueue = [];
  }

  /** Consume queued trigger pulls captured since the previous server tick. */
  consumeShotIntents(): number {
    const count = this.pendingShotIntents;
    this.pendingShotIntents = 0;
    return count;
  }

  /** Effective spread for active weapon including bloom and ADS multiplier. */
  getEffectiveSpread(): number {
    const w = this.activeWeapon;
    const hipSpread = w.spread + this.currentBloom;
    const adsMultiplier = this.latestInput?.scope && !this.isCurrentWeaponReloading() ? w.adsSpreadMultiplier : 1;
    return hipSpread * adsMultiplier;
  }

  private isCurrentWeaponReloading(): boolean {
    if (this.currentWeaponSlot === 1) return this.secondaryReloading;
    if (this.currentWeaponSlot === 2 && this.specialWeapon) return this.specialReloading;
    return this.reloading;
  }

  /**
   * Apply damage to this player.
   * Returns 'downed' if the player was just downed, 'killed' if a downed
   * player was finished off, or null if still alive.
   */
  takeDamage(amount: number): 'downed' | 'killed' | null {
    if (!this.alive) return null;
    // Downed players hit again are executed (finished off)
    if (this.downed) {
      this.alive = false;
      this.downed = false;
      this.deathTime = Date.now();
      return 'killed';
    }
    this.health = Math.max(0, this.health - amount);
    if (this.health <= 0) {
      this.downed = true;
      this.bleedoutTimer = BLEEDOUT_TIME;
      this.reviveProgress = 0;
      this.reviverId = null;
      return 'downed';
    }
    return null;
  }

  /**
   * Tick the bleedout timer for downed players.
   * Returns true if the player bled out and fully died.
   */
  tickBleedout(dt: number): boolean {
    if (!this.downed) return false;
    this.bleedoutTimer -= dt;
    if (this.bleedoutTimer <= 0) {
      this.alive = false;
      this.downed = false;
      this.deathTime = Date.now();
      return true;
    }
    return false;
  }

  /**
   * Progress a revive on this downed player.
   * Returns true if the revive is now complete.
   */
  progressRevive(reviverId: string, dt: number, reviveTime: number): boolean {
    if (!this.downed) return false;
    this.reviverId = reviverId;
    this.reviveProgress += dt / reviveTime;
    if (this.reviveProgress >= 1) {
      return true;
    }
    return false;
  }

  /** Complete a revive: restore the player to alive with given health */
  completeRevive(health: number): void {
    this.downed = false;
    this.alive = true;
    this.health = Math.min(MAX_HEALTH, health);
    this.bleedoutTimer = 0;
    this.reviveProgress = 0;
    this.reviverId = null;
    this.downedBy = null;
  }

  /**
   * Attempt to fire the weapon.
   * Checks fire rate cooldown, ammo, swap timer, and sprint state.
   * Returns true if the shot is allowed.
   */
  tryFire(now: number): boolean {
    if (!this.alive || this.downed) return false;
    if (this.swapTimer > 0) return false;

    // Sprint prevents firing (with delay after releasing sprint)
    if (this.sprintFireTimer > 0) return false;

    // Secondary weapon slot (pistol)
    if (this.currentWeaponSlot === 1) {
      if (this.secondaryReloading) return false;
      if (this.secondaryAmmo <= 0) return false;
      const interval = fireInterval(this.secondaryWeapon) * 1000;
      if (now - this.lastSecondaryFireTime < interval) return false;
      this.secondaryAmmo--;
      this.lastSecondaryFireTime = now;
      if (this.secondaryAmmo <= 0) {
        this.startSecondaryReload();
      }
      this.currentBloom += this.secondaryWeapon.spreadBloom;
      this.firedThisTick = true;
      return true;
    }

    // Special weapon slot
    if (this.currentWeaponSlot === 2 && this.specialWeapon) {
      if (this.specialReloading) return false;
      if (this.specialAmmo <= 0) return false;
      const interval = fireInterval(this.specialWeapon) * 1000;
      if (now - this.lastSpecialFireTime < interval) return false;
      this.specialAmmo--;
      this.lastSpecialFireTime = now;
      if (this.specialAmmo <= 0) {
        this.startSpecialReload();
      }
      this.currentBloom += this.specialWeapon.spreadBloom;
      this.firedThisTick = true;
      return true;
    }

    // Primary weapon
    if (this.reloading) return false;
    if (this.ammo <= 0) return false;

    const interval = fireInterval(this.weapon) * 1000; // convert to ms
    if (now - this.lastFireTime < interval) return false;

    this.ammo--;
    this.lastFireTime = now;

    // Auto-reload when magazine is empty
    if (this.ammo <= 0) {
      this.startReload();
    }
    this.currentBloom += this.weapon.spreadBloom;
    this.firedThisTick = true;

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

  /** Begin secondary weapon reload */
  startSecondaryReload(): void {
    if (this.secondaryReloading) return;
    if (this.secondaryAmmo >= this.secondaryWeapon.magSize) return;
    this.secondaryReloading = true;
    this.secondaryReloadTimer = this.secondaryWeapon.reloadTime;
  }

  /** Update secondary weapon reload progress. dt in seconds. */
  updateSecondaryReload(dt: number): void {
    if (!this.secondaryReloading) return;
    this.secondaryReloadTimer -= dt;
    if (this.secondaryReloadTimer <= 0) {
      this.secondaryReloading = false;
      this.secondaryReloadTimer = 0;
      this.secondaryAmmo = this.secondaryWeapon.magSize;
    }
  }

  /** Begin special weapon reload */
  startSpecialReload(): void {
    if (!this.specialWeapon) return;
    if (this.specialReloading) return;
    if (this.specialAmmo >= this.specialWeapon.magSize) return;
    this.specialReloading = true;
    this.specialReloadTimer = this.specialWeapon.reloadTime;
  }

  /** Update special weapon reload progress. dt in seconds. */
  updateSpecialReload(dt: number): void {
    if (!this.specialReloading || !this.specialWeapon) return;
    this.specialReloadTimer -= dt;
    if (this.specialReloadTimer <= 0) {
      this.specialReloading = false;
      this.specialReloadTimer = 0;
      this.specialAmmo = this.specialWeapon.magSize;
    }
  }

  /** Respawn the player at the given position */
  respawn(pos: Vec3): void {
    this.position = { ...pos };
    this.velocity = { x: 0, y: 0, z: 0 };
    this.health = MAX_HEALTH;
    this.alive = true;
    this.downed = false;
    this.bleedoutTimer = 0;
    this.reviveProgress = 0;
    this.reviverId = null;
    this.downedBy = null;
    this.ammo = this.weapon.magSize;
    this.reloading = false;
    this.reloadTimer = 0;
    this.lastFireTime = 0;
    this.sprintFireTimer = 0;
    this.crouching = false;
    this.currentBloom = 0;
    this.pendingShotIntents = 0;
    this.prevShootHeld = false;
    this.grenadeCount = GRENADE_MAX_COUNT;
    this.lastGrenadeTime = 0;
    this.lastGadgetTime = 0;
    this.recentDamagers.clear();
    // Reset secondary weapon state
    this.secondaryAmmo = this.secondaryWeapon.magSize;
    this.secondaryReloading = false;
    this.secondaryReloadTimer = 0;
    this.lastSecondaryFireTime = 0;
    // Reset special weapon state
    this.currentWeaponSlot = 0;
    this.swapTimer = 0;
    if (this.specialWeapon) {
      this.specialAmmo = this.specialWeapon.magSize;
      this.specialReloading = false;
      this.specialReloadTimer = 0;
      this.lastSpecialFireTime = 0;
    }
  }

  /** Change class and update weapon accordingly */
  selectClass(classId: ClassId, weaponId?: string): void {
    const classDef = CLASSES[classId];
    if (!classDef) return;
    this.classId = classId;
    // Use requested weapon if it belongs to this class, otherwise default
    if (weaponId && (weaponId === classDef.defaultPrimary || weaponId === classDef.altPrimary)) {
      this.weapon = WEAPONS[weaponId as WeaponId];
    } else {
      this.weapon = WEAPONS[classDef.defaultPrimary];
    }
    this.ammo = this.weapon.magSize;
    this.reloading = false;
    this.reloadTimer = 0;
    // Set up secondary weapon (pistol)
    this.secondaryWeapon = WEAPONS[classDef.secondary];
    this.secondaryAmmo = this.secondaryWeapon.magSize;
    this.secondaryReloading = false;
    this.secondaryReloadTimer = 0;
    // Set up special weapon if class has one
    if (classDef.specialWeapon) {
      this.specialWeapon = WEAPONS[classDef.specialWeapon];
      this.specialAmmo = this.specialWeapon.magSize;
      this.specialReloading = false;
      this.specialReloadTimer = 0;
    } else {
      this.specialWeapon = null;
      this.specialAmmo = 0;
    }
    this.currentWeaponSlot = 0;
    this.swapTimer = 0;
  }

  /** Get current state snapshot */
  getState(): PlayerState {
    // Report ammo for the active weapon slot
    let ammo: number;
    let maxAmmo: number;
    let reloading: boolean;
    if (this.currentWeaponSlot === 1) {
      ammo = this.secondaryAmmo;
      maxAmmo = this.secondaryWeapon.magSize;
      reloading = this.secondaryReloading;
    } else if (this.currentWeaponSlot === 2 && this.specialWeapon) {
      ammo = this.specialAmmo;
      maxAmmo = this.specialWeapon.magSize;
      reloading = this.specialReloading;
    } else {
      ammo = this.ammo;
      maxAmmo = this.weapon.magSize;
      reloading = this.reloading;
    }
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
      downed: this.downed,
      team: this.team,
      classId: this.classId,
      ammo,
      maxAmmo,
      reloading,
      weaponSlot: this.currentWeaponSlot,
      shooting: this.firedThisTick,
      weaponName: this.activeWeapon.name,
    };
  }
}
