import * as THREE from 'three';
import { getFpsAnimationClips } from './fps-arms-loader';

export type AnimSetId = 'pistol' | 'rifle';

/**
 * Drives arm skeleton animations (Idle/Shoot/Reload) via THREE.AnimationMixer.
 * Sits alongside the existing additive viewmodel transforms (recoil, sway, bob).
 */
export class FpsAnimationController {
  private mixer: THREE.AnimationMixer;
  private idleAction: THREE.AnimationAction | null = null;
  private shootAction: THREE.AnimationAction | null = null;
  private reloadAction: THREE.AnimationAction | null = null;
  private currentSetId: AnimSetId | null = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private onFinished: ((e: any) => void) | null = null;

  constructor(armsRoot: THREE.Object3D) {
    this.mixer = new THREE.AnimationMixer(armsRoot);
  }

  /**
   * Load an animation set for the current weapon category.
   * Clips are looked up by name suffix: Idle, Shoot, Reload.
   */
  loadAnimSet(setId: AnimSetId): void {
    if (setId === this.currentSetId) return;
    this.currentSetId = setId;

    // Remove previous finished listener to avoid duplicates
    if (this.onFinished) {
      this.mixer.removeEventListener('finished', this.onFinished);
    }

    // Stop all current actions
    this.mixer.stopAllAction();
    this.idleAction = null;
    this.shootAction = null;
    this.reloadAction = null;

    const clips = getFpsAnimationClips(setId);
    if (clips.length === 0) return;

    for (const clip of clips) {
      const name = clip.name.toLowerCase();
      if (name.includes('idle')) {
        this.idleAction = this.mixer.clipAction(clip);
        this.idleAction.setLoop(THREE.LoopRepeat, Infinity);
      } else if (name.includes('shoot')) {
        this.shootAction = this.mixer.clipAction(clip);
        this.shootAction.setLoop(THREE.LoopOnce, 1);
        this.shootAction.clampWhenFinished = true;
      } else if (name.includes('reload')) {
        this.reloadAction = this.mixer.clipAction(clip);
        this.reloadAction.setLoop(THREE.LoopOnce, 1);
        this.reloadAction.clampWhenFinished = true;
      }
    }

    // Start idle
    if (this.idleAction) {
      this.idleAction.play();
    }

    // When shoot/reload finishes, crossfade back to idle
    this.onFinished = (e: { action: THREE.AnimationAction }) => {
      if (e.action === this.shootAction) {
        this.returnToIdle(0.15, e.action);
      } else if (e.action === this.reloadAction) {
        this.returnToIdle(0.2, e.action);
      }
    };
    this.mixer.addEventListener('finished', this.onFinished);
  }

  /**
   * Play the shoot animation. Rapid fire: reset + play each time.
   * Quick crossfade from idle (0.05s), auto-returns on finish (0.15s).
   */
  triggerShoot(): void {
    if (!this.shootAction) return;

    // Interrupt reload if in progress
    if (this.reloadAction?.isRunning()) {
      this.reloadAction.fadeOut(0.05);
    }

    this.shootAction.reset();
    this.shootAction.setEffectiveWeight(1);
    this.shootAction.setEffectiveTimeScale(1);

    if (this.idleAction) {
      this.idleAction.crossFadeTo(this.shootAction, 0.05, false);
    }
    this.shootAction.play();
  }

  /**
   * Play the reload animation, scaled to match the weapon's actual reload time.
   */
  triggerReload(reloadDuration: number): void {
    if (!this.reloadAction) return;

    this.reloadAction.reset();
    this.reloadAction.setEffectiveWeight(1);

    // Scale animation speed so it fits the weapon's reload time
    const clipDuration = this.reloadAction.getClip().duration;
    this.reloadAction.setEffectiveTimeScale(clipDuration / reloadDuration);

    if (this.idleAction) {
      this.idleAction.crossFadeTo(this.reloadAction, 0.15, false);
    }
    this.reloadAction.play();
  }

  /** Advance the mixer each frame */
  update(dt: number): void {
    this.mixer.update(dt);
  }

  /** Crossfade back to idle from the finished action */
  private returnToIdle(fadeDuration: number, fromAction?: THREE.AnimationAction): void {
    if (!this.idleAction) return;
    this.idleAction.reset();
    this.idleAction.setEffectiveWeight(1);
    this.idleAction.play();
    if (fromAction) {
      this.idleAction.crossFadeFrom(fromAction, fadeDuration, false);
    }
  }

  /** Clean up mixer */
  dispose(): void {
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.mixer.getRoot());
  }
}
