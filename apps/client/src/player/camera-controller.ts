import * as THREE from 'three';
import { PLAYER_HEIGHT, CROUCH_HEIGHT } from '@clawfield/shared';
import type { Vec3 } from '@clawfield/shared';

/** Eye offset from top of hitbox */
const EYE_INSET = 0.1;

/** Speed of camera height lerp when transitioning crouch (units/s) */
const CROUCH_LERP_SPEED = 10;

/**
 * First-person camera controller.
 * Updates camera position and rotation based on player state.
 * Smoothly transitions eye height when crouching/standing.
 * Supports a death cam mode that lerps to look at the killer.
 */
export class CameraController {
  private camera: THREE.PerspectiveCamera;
  private currentEyeOffset = PLAYER_HEIGHT - EYE_INSET;

  // --- Death cam state ---
  private deathCamActive = false;
  private deathCamKillerPos: Vec3 | null = null;
  private deathCamLerpProgress = 0;
  private deathCamStartYaw = 0;
  private deathCamStartPitch = 0;

  constructor(camera: THREE.PerspectiveCamera) {
    this.camera = camera;
  }

  /** Activate death cam — lerp to look at killer */
  enterDeathCam(killerPos: Vec3): void {
    this.deathCamActive = true;
    this.deathCamKillerPos = { ...killerPos };
    this.deathCamLerpProgress = 0;
    this.deathCamStartYaw = this.camera.rotation.y;
    this.deathCamStartPitch = this.camera.rotation.x;
  }

  /** Exit death cam on respawn */
  exitDeathCam(): void {
    this.deathCamActive = false;
    this.deathCamKillerPos = null;
  }

  /** Update camera from player position, look angles, and crouch state */
  update(position: Vec3, yaw: number, pitch: number, crouching: boolean = false, dt: number = 0): void {
    // Death cam: lerp to look at killer position over 0.5 seconds
    if (this.deathCamActive && this.deathCamKillerPos) {
      this.deathCamLerpProgress = Math.min(1, this.deathCamLerpProgress + dt * 2);
      const t = this.deathCamLerpProgress;

      // Calculate target angles to look at killer
      const dx = this.deathCamKillerPos.x - position.x;
      const dy = this.deathCamKillerPos.y - position.y;
      const dz = this.deathCamKillerPos.z - position.z;
      const targetYaw = -Math.atan2(dx, -dz);
      const horizDist = Math.sqrt(dx * dx + dz * dz);
      const targetPitch = Math.atan2(dy, horizDist);

      // Lerp rotation
      const lerpedYaw = this.deathCamStartYaw + (targetYaw - this.deathCamStartYaw) * t;
      const lerpedPitch = this.deathCamStartPitch + (targetPitch - this.deathCamStartPitch) * t;

      // Pull camera back for a third-person-ish death view
      const pullback = 2 * t;
      this.camera.position.set(
        position.x - Math.sin(-lerpedYaw) * pullback,
        position.y + this.currentEyeOffset + pullback * 0.5,
        position.z + Math.cos(-lerpedYaw) * pullback
      );

      this.camera.rotation.order = 'YXZ';
      this.camera.rotation.y = lerpedYaw;
      this.camera.rotation.x = lerpedPitch;
      return;
    }

    // Normal camera update
    const targetEyeOffset = crouching
      ? CROUCH_HEIGHT - EYE_INSET
      : PLAYER_HEIGHT - EYE_INSET;

    // Smoothly lerp eye height for a polished crouch transition
    if (dt > 0) {
      const diff = targetEyeOffset - this.currentEyeOffset;
      const step = CROUCH_LERP_SPEED * dt;
      if (Math.abs(diff) < step) {
        this.currentEyeOffset = targetEyeOffset;
      } else {
        this.currentEyeOffset += Math.sign(diff) * step;
      }
    } else {
      this.currentEyeOffset = targetEyeOffset;
    }

    this.camera.position.set(
      position.x,
      position.y + this.currentEyeOffset,
      position.z
    );

    // Euler order YXZ: yaw around Y, then pitch around X
    this.camera.rotation.order = 'YXZ';
    this.camera.rotation.y = -yaw;
    this.camera.rotation.x = pitch;
  }
}
