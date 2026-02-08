import type { InputState, Vec3 } from '@clawfield/shared';
import { Team, ClassId, PLAYER_HEIGHT } from '@clawfield/shared';
import { PlayerSim } from './player-sim.js';

/** All class IDs for random selection */
const ALL_CLASSES = Object.values(ClassId);

// ---------------------------------------------------------------------------
// Ravenfield-inspired AI parameters (Normal difficulty)
// ---------------------------------------------------------------------------

/** Base aim sway (radians) — always present even on a stationary target */
const AIM_BASE_SWAY = 0.002;

/** Maximum extra sway added when the bot is fatigued / at range */
const AIM_MAX_SWAY = 0.05;

/**
 * How close (in world-space metres projected on the perpendicular plane)
 * the aim must be to the target before the bot pulls the trigger.
 */
const AI_FIRE_RECTANGLE_BOUND = 1.0;

/** Sway magnitude — multiplied by a time-varying sine wave */
const SWAY_MAGNITUDE = 0.5;

/** How quickly the bot rotates toward its target (slerp speed, rad/s) */
const AIM_SLERP_SPEED = 6.0;

/** Eye offset from player feet — must match game-loop.ts EYE_OFFSET */
const EYE_OFFSET = PLAYER_HEIGHT - 0.1; // 1.7

// -- Movement speeds (fraction of engine MOVE_SPEED applied via input) --
// Bots move by setting forward/back/left/right booleans just like a human.
// We control *effective* speed by mixing forward with strafe or by toggling
// sprint. The values below are for state-machine decisions, not direct vel.

/** Range within which the bot will engage (and stop sprinting) */
const ENGAGE_RANGE = 60;

/** Range within which the bot will actively pursue a target */
const PURSUIT_RANGE = 80;

/** How often (seconds) the bot re-evaluates its target */
const TARGET_SCAN_INTERVAL = 0.2;

/** Sprint duration bounds (seconds) */
const SPRINT_DURATION_MIN = 3;
const SPRINT_DURATION_MAX = 6;

/** Sprint cooldown bounds (seconds) */
const SPRINT_COOLDOWN_MIN = 5;
const SPRINT_COOLDOWN_MAX = 11;

/** Time between picking new patrol waypoints (seconds) */
const PATROL_INTERVAL_MIN = 3;
const PATROL_INTERVAL_MAX = 6;

/** Patrol waypoint distance from current position */
const PATROL_RADIUS = 30;

/**
 * Map boundary for random patrol points.
 * Oasis map spans world X: -1008 to 496, Z: -560 to 784.
 * Use a reasonable patrol area around the center (~60% of map width/depth).
 */
const MAP_MIN_X = -600;
const MAP_MAX_X = 300;
const MAP_MIN_Z = -500;
const MAP_MAX_Z = 300;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function dist3D(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/** Normalise an angle to [-PI, PI] */
function wrapAngle(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

/** Lerp toward a target angle at a given speed, respecting dt */
function lerpAngle(current: number, target: number, speed: number, dt: number): number {
  let diff = wrapAngle(target - current);
  const maxStep = speed * dt;
  if (Math.abs(diff) < maxStep) return target;
  diff = Math.max(-maxStep, Math.min(maxStep, diff));
  return current + diff;
}

/** Random float in [min, max) */
function randRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

// ---------------------------------------------------------------------------
// Bot implementation
// ---------------------------------------------------------------------------

/**
 * Server-side AI bot that simulates a fighting player.
 *
 * Ported from Ravenfield's AiActorController.cs (Normal difficulty).
 * Finds nearest enemy, aims with sway/inaccuracy, fires when on target,
 * patrols when idle, and manages sprint/reload.
 */
export class DummyBot {
  readonly sim: PlayerSim;

  // -- Timers --
  private seq = 0;
  private targetScanTimer = 0;
  private patrolTimer = 0;
  private sprintTimer = 0;
  private sprintCooldown = 0;
  private isSprinting = false;
  private smoothNoise = Math.random() * Math.PI * 2; // phase offset for sway

  // -- Target tracking --
  private targetId: string | null = null;
  private patrolPoint: Vec3 | null = null;

  // -- Current input being built each tick --
  private currentInput: InputState;

  constructor(id: string, name: string, team: Team, spawnPos: Vec3) {
    this.sim = new PlayerSim(id, name, spawnPos);
    this.sim.team = team;
    this.sim.selectClass(ALL_CLASSES[Math.floor(Math.random() * ALL_CLASSES.length)]);

    this.currentInput = {
      forward: false,
      back: false,
      left: false,
      right: false,
      jump: false,
      shoot: false,
      reload: false,
      sprint: false,
      crouch: false,
      throwGrenade: false,
      useGadget: false,
      yaw: Math.random() * Math.PI * 2,
      pitch: 0,
    };

    // Stagger timers so bots don't all tick in unison
    this.targetScanTimer = Math.random() * TARGET_SCAN_INTERVAL;
    this.patrolTimer = Math.random() * PATROL_INTERVAL_MIN;
    this.sprintCooldown = randRange(SPRINT_COOLDOWN_MIN, SPRINT_COOLDOWN_MAX);
  }

  // -----------------------------------------------------------------------
  // Main update — called every server tick
  // -----------------------------------------------------------------------

  /**
   * @param dt   Seconds since last tick
   * @param allPlayers  Every player (including bots) currently in the match
   */
  update(dt: number, allPlayers: Map<string, PlayerSim>): void {
    // Advance sway phase
    this.smoothNoise += dt;

    // Dead bots do nothing (respawn is handled by the game loop)
    if (!this.sim.alive) {
      this.currentInput.shoot = false;
      this.currentInput.reload = false;
      this.seq++;
      this.sim.queueInput(this.seq, { ...this.currentInput }, dt);
      return;
    }

    // --- Periodically scan for a target ---
    this.targetScanTimer -= dt;
    if (this.targetScanTimer <= 0) {
      this.targetScanTimer = TARGET_SCAN_INTERVAL;
      this.findTarget(allPlayers);
    }

    // Resolve current target reference
    const target = this.targetId ? allPlayers.get(this.targetId) ?? null : null;
    const hasTarget = target !== null && target.alive;

    // Drop dead/missing targets
    if (!hasTarget) {
      this.targetId = null;
    }

    // --- Reload when empty ---
    if (this.sim.ammo <= 0 && !this.sim.reloading) {
      this.currentInput.reload = true;
    } else {
      this.currentInput.reload = false;
    }

    // === COMBAT vs PATROL ===
    if (hasTarget && target) {
      this.doCombat(target, dt);
    } else {
      this.doPatrol(dt);
    }

    // Queue input
    this.seq++;
    this.sim.queueInput(this.seq, { ...this.currentInput }, dt);
  }

  // -----------------------------------------------------------------------
  // Target acquisition
  // -----------------------------------------------------------------------

  private findTarget(allPlayers: Map<string, PlayerSim>): void {
    let bestDist = Infinity;
    let bestId: string | null = null;

    for (const [id, player] of allPlayers) {
      // Skip self, dead players, and same-team players
      if (id === this.sim.id) continue;
      if (!player.alive) continue;
      if (player.team === this.sim.team) continue;

      const d = dist3D(this.sim.position, player.position);
      if (d < bestDist && d < PURSUIT_RANGE) {
        bestDist = d;
        bestId = id;
      }
    }

    this.targetId = bestId;
  }

  // -----------------------------------------------------------------------
  // Combat behaviour
  // -----------------------------------------------------------------------

  private doCombat(target: PlayerSim, dt: number): void {
    // Stop sprinting when engaging
    this.isSprinting = false;
    this.sprintTimer = 0;

    // --- Calculate aim direction toward target ---
    const myEye: Vec3 = {
      x: this.sim.position.x,
      y: this.sim.position.y + EYE_OFFSET,
      z: this.sim.position.z,
    };
    // Aim at target's center mass (roughly chest height)
    const targetPoint: Vec3 = {
      x: target.position.x,
      y: target.position.y + EYE_OFFSET * 0.7, // chest height
      z: target.position.z,
    };

    const dx = targetPoint.x - myEye.x;
    const dy = targetPoint.y - myEye.y;
    const dz = targetPoint.z - myEye.z;
    const horizDist = Math.sqrt(dx * dx + dz * dz);
    const totalDist = Math.sqrt(dx * dx + dy * dy + dz * dz);

    // Desired yaw/pitch to face target
    const desiredYaw = Math.atan2(dx, -dz);
    const desiredPitch = Math.atan2(dy, horizDist);

    // --- Apply Ravenfield-style sway ---
    // Sway increases with distance (simulates harder long-range aiming)
    const distanceFactor = Math.min(totalDist / ENGAGE_RANGE, 1.0);
    const swayAmount = AIM_BASE_SWAY + AIM_MAX_SWAY * distanceFactor;

    const t = this.smoothNoise;
    const swayYaw = Math.sin(t * 3.1) * swayAmount * SWAY_MAGNITUDE;
    const swayPitch = Math.cos(t * 5.3) * swayAmount * SWAY_MAGNITUDE;

    const targetYaw = desiredYaw + swayYaw;
    const targetPitch = desiredPitch + swayPitch;

    // Smoothly interpolate aim toward target (slerp-like)
    this.currentInput.yaw = lerpAngle(this.currentInput.yaw, targetYaw, AIM_SLERP_SPEED, dt);
    this.currentInput.pitch = lerpAngle(this.currentInput.pitch, targetPitch, AIM_SLERP_SPEED, dt);

    // Clamp pitch
    this.currentInput.pitch = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, this.currentInput.pitch));

    // --- Determine if aim is close enough to fire ---
    // Project the aim error onto a perpendicular plane at the target distance
    // (matching Ravenfield's "fire rectangle" check)
    const aimYawError = Math.abs(wrapAngle(this.currentInput.yaw - desiredYaw));
    const aimPitchError = Math.abs(this.currentInput.pitch - desiredPitch);
    const aimErrorWorld = Math.max(aimYawError, aimPitchError) * totalDist;

    const canFire =
      aimErrorWorld < AI_FIRE_RECTANGLE_BOUND &&
      !this.sim.reloading &&
      this.sim.ammo > 0;

    this.currentInput.shoot = canFire;

    // --- Movement while engaging ---
    // Move toward target if far, strafe if close
    this.currentInput.forward = false;
    this.currentInput.back = false;
    this.currentInput.left = false;
    this.currentInput.right = false;
    this.currentInput.jump = false;
    this.currentInput.sprint = false; // never sprint while fighting
    this.currentInput.crouch = false;

    if (horizDist > ENGAGE_RANGE * 0.6) {
      // Close distance
      this.currentInput.forward = true;
    } else if (horizDist < 5) {
      // Too close — back off slightly
      this.currentInput.back = true;
    } else {
      // Comfortable range — strafe for evasion
      // Use the noise phase to alternate strafe direction
      if (Math.sin(this.smoothNoise * 1.7) > 0) {
        this.currentInput.left = true;
      } else {
        this.currentInput.right = true;
      }
    }
  }

  // -----------------------------------------------------------------------
  // Patrol behaviour (no target)
  // -----------------------------------------------------------------------

  private doPatrol(dt: number): void {
    this.currentInput.shoot = false;

    // --- Sprint logic ---
    if (this.isSprinting) {
      this.sprintTimer -= dt;
      if (this.sprintTimer <= 0) {
        this.isSprinting = false;
        this.sprintCooldown = randRange(SPRINT_COOLDOWN_MIN, SPRINT_COOLDOWN_MAX);
      }
    } else {
      this.sprintCooldown -= dt;
      if (this.sprintCooldown <= 0) {
        this.isSprinting = true;
        this.sprintTimer = randRange(SPRINT_DURATION_MIN, SPRINT_DURATION_MAX);
      }
    }

    // --- Pick a patrol waypoint ---
    this.patrolTimer -= dt;
    if (this.patrolTimer <= 0 || this.patrolPoint === null) {
      this.patrolTimer = randRange(PATROL_INTERVAL_MIN, PATROL_INTERVAL_MAX);
      this.patrolPoint = this.pickPatrolPoint();
    }

    // --- Navigate toward patrol point ---
    const wp = this.patrolPoint;
    const dx = wp.x - this.sim.position.x;
    const dz = wp.z - this.sim.position.z;
    const distToWP = Math.sqrt(dx * dx + dz * dz);

    if (distToWP < 3) {
      // Arrived — pick a new point next tick
      this.patrolTimer = 0;
    }

    // Face toward waypoint
    const desiredYaw = Math.atan2(dx, -dz);
    this.currentInput.yaw = lerpAngle(this.currentInput.yaw, desiredYaw, AIM_SLERP_SPEED * 0.5, dt);
    this.currentInput.pitch = lerpAngle(this.currentInput.pitch, 0, AIM_SLERP_SPEED * 0.3, dt);

    // Walk forward toward waypoint
    this.currentInput.forward = distToWP > 2;
    this.currentInput.back = false;
    this.currentInput.left = false;
    this.currentInput.right = false;
    this.currentInput.jump = false;
    this.currentInput.sprint = this.isSprinting && this.currentInput.forward;
    this.currentInput.crouch = false;

    // Occasionally jump over obstacles
    if (Math.random() < 0.005) {
      this.currentInput.jump = true;
    }
  }

  private pickPatrolPoint(): Vec3 {
    const angle = Math.random() * Math.PI * 2;
    const dist = PATROL_RADIUS * (0.3 + Math.random() * 0.7);
    let x = this.sim.position.x + Math.cos(angle) * dist;
    let z = this.sim.position.z + Math.sin(angle) * dist;

    // Clamp to map bounds
    x = Math.max(MAP_MIN_X, Math.min(MAP_MAX_X, x));
    z = Math.max(MAP_MIN_Z, Math.min(MAP_MAX_Z, z));

    return { x, y: this.sim.position.y, z };
  }
}
