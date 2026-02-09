/**
 * Procedural camera shake system.
 *
 * Supports multiple concurrent shake sources (fire, hit, explosion)
 * that layer additively. Each shake decays over its duration with
 * configurable intensity, frequency, and per-axis weights.
 *
 * BattleBit-style: rapid high-frequency micro-shake on fire,
 * heavy low-frequency punch on hit, slow roll on explosions.
 */

/** A single active shake instance */
interface ShakeInstance {
  /** Elapsed time */
  time: number;
  /** Total duration in seconds */
  duration: number;
  /** Intensity (radians of max displacement) */
  intensity: number;
  /** Oscillation frequency (Hz) */
  frequency: number;
  /** Per-axis weight: [pitch, yaw, roll] */
  axes: [number, number, number];
  /** Decay curve exponent (higher = faster falloff) */
  decay: number;
  /** Random phase offsets for each axis */
  phaseOffsets: [number, number, number];
}

/** Preset shake configurations */
export interface ShakePreset {
  duration: number;
  intensity: number;
  frequency: number;
  axes: [number, number, number];
  decay: number;
}

/** Fire shake: fast, small, mostly pitch */
export const SHAKE_FIRE: ShakePreset = {
  duration: 0.08,
  intensity: 0.003,
  frequency: 40,
  axes: [1.0, 0.3, 0.15],
  decay: 3,
};

/** Heavy fire shake (shotgun, sniper) */
export const SHAKE_FIRE_HEAVY: ShakePreset = {
  duration: 0.15,
  intensity: 0.008,
  frequency: 25,
  axes: [1.0, 0.4, 0.25],
  decay: 2.5,
};

/** Hit taken: sharp punch, mostly pitch down */
export const SHAKE_HIT: ShakePreset = {
  duration: 0.12,
  intensity: 0.006,
  frequency: 30,
  axes: [1.0, 0.5, 0.2],
  decay: 4,
};

/** Hit confirm: subtle feedback shake */
export const SHAKE_HIT_CONFIRM: ShakePreset = {
  duration: 0.06,
  intensity: 0.002,
  frequency: 45,
  axes: [0.5, 0.5, 0.0],
  decay: 5,
};

/** Explosion: slow heavy roll */
export const SHAKE_EXPLOSION: ShakePreset = {
  duration: 0.5,
  intensity: 0.02,
  frequency: 12,
  axes: [0.8, 0.6, 1.0],
  decay: 2,
};

/** Suppression: subtle sustained shake */
export const SHAKE_SUPPRESSION: ShakePreset = {
  duration: 0.2,
  intensity: 0.0015,
  frequency: 35,
  axes: [0.6, 0.6, 0.3],
  decay: 2,
};

export class CameraShake {
  private shakes: ShakeInstance[] = [];

  /** Current frame's shake offsets (pitch, yaw, roll) in radians */
  pitchOffset = 0;
  yawOffset = 0;
  rollOffset = 0;

  /** Add a new shake from a preset, optionally scaled */
  add(preset: ShakePreset, scale = 1.0): void {
    this.shakes.push({
      time: 0,
      duration: preset.duration,
      intensity: preset.intensity * scale,
      frequency: preset.frequency,
      axes: [...preset.axes],
      decay: preset.decay,
      phaseOffsets: [
        Math.random() * Math.PI * 2,
        Math.random() * Math.PI * 2,
        Math.random() * Math.PI * 2,
      ],
    });
  }

  /** Update all shakes and compute combined offsets */
  update(dt: number): void {
    this.pitchOffset = 0;
    this.yawOffset = 0;
    this.rollOffset = 0;

    for (let i = this.shakes.length - 1; i >= 0; i--) {
      const s = this.shakes[i];
      s.time += dt;

      if (s.time >= s.duration) {
        this.shakes.splice(i, 1);
        continue;
      }

      // Normalized progress 0..1
      const t = s.time / s.duration;
      // Decay envelope: starts at 1, decays toward 0
      const envelope = Math.pow(1 - t, s.decay);
      const amp = s.intensity * envelope;

      const phase = s.time * s.frequency * Math.PI * 2;

      // Use different sine frequencies per axis for organic feel
      this.pitchOffset += Math.sin(phase + s.phaseOffsets[0]) * amp * s.axes[0];
      this.yawOffset += Math.sin(phase * 1.1 + s.phaseOffsets[1]) * amp * s.axes[1];
      this.rollOffset += Math.sin(phase * 0.9 + s.phaseOffsets[2]) * amp * s.axes[2];
    }
  }

  /** Whether any shakes are active */
  get active(): boolean {
    return this.shakes.length > 0;
  }

  /** Clear all active shakes */
  clear(): void {
    this.shakes.length = 0;
    this.pitchOffset = 0;
    this.yawOffset = 0;
    this.rollOffset = 0;
  }
}
