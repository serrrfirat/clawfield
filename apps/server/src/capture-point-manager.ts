import type { Vec3, CapturePointState } from '@clawfield/shared';
import {
  Team,
  CAPTURE_RADIUS,
  CAPTURE_RATE_PER_PLAYER,
  CAPTURE_UPDATE_RATE,
  CONQUEST_VICTORY_POINTS,
  CONQUEST_SCORE_PER_TICK,
} from '@clawfield/shared';
import type { PlayerSim } from './player-sim.js';

/** Config for a capture point at map init time */
export interface CapturePointConfig {
  id: string;
  position: Vec3;
  /** -1 = neutral, 0 = Alpha, 1 = Bravo */
  initialOwner: number;
}

/** Internal capture point representation */
class CapturePoint {
  readonly id: string;
  readonly position: Vec3;

  /** 0.0 = fully Alpha, 1.0 = fully Bravo, 0.5 = neutral start */
  control: number;
  /** Current owner: -1 = neutral, 0 = Alpha, 1 = Bravo */
  owner: number;
  /** Whether both teams have players in the radius */
  contested: boolean = false;

  constructor(config: CapturePointConfig) {
    this.id = config.id;
    this.position = { ...config.position };
    this.owner = config.initialOwner;

    // Set initial control value based on owner
    if (config.initialOwner === Team.Alpha) {
      this.control = 0.0;
    } else if (config.initialOwner === Team.Bravo) {
      this.control = 1.0;
    } else {
      this.control = 0.5;
    }
  }

  /** Snapshot for network broadcast */
  getState(): CapturePointState {
    return {
      id: this.id,
      position: { ...this.position },
      control: this.control,
      owner: this.owner,
      contested: this.contested,
    };
  }
}

/** Squared distance between two Vec3 (avoids sqrt for radius check) */
function distSq(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return dx * dx + dy * dy + dz * dz;
}

/** Default capture points for the test map "Shoreline" */
export const DEFAULT_CAPTURE_POINTS: CapturePointConfig[] = [
  { id: 'A', position: { x: 30, y: 2, z: 30 }, initialOwner: Team.Alpha },
  { id: 'B', position: { x: 64, y: 2, z: 64 }, initialOwner: -1 },
  { id: 'C', position: { x: 96, y: 2, z: 96 }, initialOwner: Team.Bravo },
];

/**
 * Manages conquest capture points on the server.
 *
 * Ported from Ravenfield's CapturePoint.cs:
 * - Players within CAPTURE_RADIUS shift the control value
 * - Dominant team (more players) moves control toward their side
 * - Control 0 = Alpha owns, control 1 = Bravo owns
 * - Teams score points per second based on how many flags they own
 * - First team to reach CONQUEST_VICTORY_POINTS more than the other wins
 */
export class CapturePointManager {
  private points: CapturePoint[];
  private scoreAlpha = 0;
  private scoreBravo = 0;
  private captureTimer = 0;
  private scoreTimer = 0;

  private readonly captureRadiusSq: number;

  constructor(points: CapturePointConfig[]) {
    this.points = points.map((cfg) => new CapturePoint(cfg));
    this.captureRadiusSq = CAPTURE_RADIUS * CAPTURE_RADIUS;
  }

  /**
   * Called every server tick (20Hz). Accumulates dt and runs capture logic
   * at CAPTURE_UPDATE_RATE intervals (1 second).
   *
   * Returns true if any capture point state changed (so the caller can
   * decide whether to broadcast).
   */
  update(dt: number, players: Map<string, PlayerSim>): boolean {
    this.captureTimer += dt;
    this.scoreTimer += dt;

    let changed = false;

    // Run capture calculations every CAPTURE_UPDATE_RATE seconds
    if (this.captureTimer >= CAPTURE_UPDATE_RATE) {
      this.captureTimer -= CAPTURE_UPDATE_RATE;
      changed = this.updateCapture(players);
    }

    // Award score every CAPTURE_UPDATE_RATE seconds (same cadence)
    if (this.scoreTimer >= CAPTURE_UPDATE_RATE) {
      this.scoreTimer -= CAPTURE_UPDATE_RATE;
      this.updateScores();
    }

    return changed;
  }

  /** Get all capture point states for broadcasting to clients */
  getStates(): CapturePointState[] {
    return this.points.map((p) => p.getState());
  }

  /** Get current conquest scores */
  getScores(): { alpha: number; bravo: number } {
    return { alpha: this.scoreAlpha, bravo: this.scoreBravo };
  }

  /**
   * Check if a team has won by reaching CONQUEST_VICTORY_POINTS
   * more than the opposing team.
   * Returns the winning Team or null.
   */
  getWinner(): number | null {
    const diff = this.scoreAlpha - this.scoreBravo;
    if (diff >= CONQUEST_VICTORY_POINTS) return Team.Alpha;
    if (diff <= -CONQUEST_VICTORY_POINTS) return Team.Bravo;
    return null;
  }

  /** Add bonus score to a team (e.g. from dynamic objectives) */
  addBonus(team: number, amount: number): void {
    if (team === Team.Alpha) this.scoreAlpha += amount;
    else if (team === Team.Bravo) this.scoreBravo += amount;
  }

  /**
   * Get spawn points for a team: the positions of all capture points
   * that team currently owns. Used so players can spawn at captured flags.
   */
  getSpawnPoints(team: number): Vec3[] {
    return this.points
      .filter((p) => p.owner === team)
      .map((p) => ({ ...p.position }));
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  /**
   * Core capture logic, run once per CAPTURE_UPDATE_RATE.
   * For each point, count alive players within radius, determine
   * the dominant team, and shift the control value.
   */
  private updateCapture(players: Map<string, PlayerSim>): boolean {
    let anyChanged = false;

    for (const point of this.points) {
      let alphaCount = 0;
      let bravoCount = 0;

      // Count alive players in radius
      for (const player of players.values()) {
        if (!player.alive) continue;
        if (distSq(player.position, point.position) > this.captureRadiusSq) continue;

        if (player.team === Team.Alpha) {
          alphaCount++;
        } else {
          bravoCount++;
        }
      }

      // Contested: both teams have players in the zone
      const wasContested = point.contested;
      point.contested = alphaCount > 0 && bravoCount > 0;

      // No players in zone -- nothing to do (but contested flag may have changed)
      if (alphaCount === 0 && bravoCount === 0) {
        if (wasContested !== point.contested) anyChanged = true;
        continue;
      }

      // Contested zones don't shift -- the flag is frozen
      if (point.contested) {
        if (!wasContested) anyChanged = true;
        continue;
      }

      // Determine dominant team and advantage
      const advantage = Math.abs(alphaCount - bravoCount);
      if (advantage === 0) continue; // equal non-zero counts handled by contested

      const prevControl = point.control;
      const prevOwner = point.owner;

      if (alphaCount > bravoCount) {
        // Alpha is capturing (move control toward 0)
        point.control = Math.max(0, point.control - advantage * CAPTURE_RATE_PER_PLAYER);
      } else {
        // Bravo is capturing (move control toward 1)
        point.control = Math.min(1, point.control + advantage * CAPTURE_RATE_PER_PLAYER);
      }

      // Determine new owner based on control value
      if (point.control <= 0) {
        point.owner = Team.Alpha;
      } else if (point.control >= 1) {
        point.owner = Team.Bravo;
      } else {
        // If control has crossed the midpoint away from the current owner,
        // the point becomes neutral
        if (point.owner === Team.Alpha && point.control > 0) {
          point.owner = -1;
        } else if (point.owner === Team.Bravo && point.control < 1) {
          point.owner = -1;
        }
      }

      if (point.control !== prevControl || point.owner !== prevOwner) {
        anyChanged = true;
      }

      if (point.owner !== prevOwner) {
        const ownerName = point.owner === Team.Alpha ? 'Alpha'
          : point.owner === Team.Bravo ? 'Bravo'
          : 'Neutral';
        console.log(`CAPTURE: Point ${point.id} -> ${ownerName} (control: ${point.control.toFixed(2)})`);
      }
    }

    return anyChanged;
  }

  /** Award score to each team based on how many flags they own */
  private updateScores(): void {
    let alphaFlags = 0;
    let bravoFlags = 0;

    for (const point of this.points) {
      if (point.owner === Team.Alpha) alphaFlags++;
      else if (point.owner === Team.Bravo) bravoFlags++;
    }

    this.scoreAlpha += CONQUEST_SCORE_PER_TICK * alphaFlags;
    this.scoreBravo += CONQUEST_SCORE_PER_TICK * bravoFlags;
  }
}
