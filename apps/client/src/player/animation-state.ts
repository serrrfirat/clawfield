import { WALK_SPEED, MOVE_SPEED, SPRINT_SPEED, CROUCH_SPEED } from '@clawfield/shared'
import type { InputState, PlayerState } from '@clawfield/shared'

/** Animation clip names matching the baked GLB */
export enum AnimState {
  Idle = 'rifle_idle',
  Walk = 'walk_forward',
  WalkLeft = 'walk_left',
  WalkRight = 'walk_right',
  WalkForwardLeft = 'walk_forward_left',
  Run = 'run_forward',
  Sprint = 'sprint_forward',
  CrouchIdle = 'crouch_idle',
  CrouchWalk = 'crouch_walk',
  Shoot = 'fire_rifle',
  CrouchShoot = 'crouch_fire',
  Reload = 'reload',
  Jump = 'jump',
  JumpBackward = 'jump_backward',
  DeathFront = 'death_front',
  DeathBack = 'death_back',
  Dying = 'dying',
}

/** Crossfade durations in seconds per animation transition */
export const CROSSFADE_DURATIONS: Partial<Record<AnimState, number>> = {
  [AnimState.Shoot]: 0.05,
  [AnimState.CrouchShoot]: 0.05,
  [AnimState.DeathFront]: 0.1,
  [AnimState.DeathBack]: 0.1,
  [AnimState.Dying]: 0.1,
  [AnimState.Reload]: 0.1,
  [AnimState.Jump]: 0.1,
  [AnimState.JumpBackward]: 0.1,
}

/** Default crossfade for locomotion transitions */
export const DEFAULT_CROSSFADE = 0.15

/**
 * Derive animation state for the LOCAL player from input + store state.
 */
export function deriveAnimState(
  input: InputState,
  alive: boolean,
  downed: boolean,
  reloading: boolean,
  shooting: boolean,
  velocityMagnitude: number,
): AnimState {
  if (!alive) return AnimState.DeathFront
  if (downed) return AnimState.Dying

  if (reloading) return AnimState.Reload
  if (shooting && input.crouch) return AnimState.CrouchShoot
  if (shooting) return AnimState.Shoot

  // Jump (not grounded)
  if (input.jump) {
    return input.back ? AnimState.JumpBackward : AnimState.Jump
  }

  const moving = velocityMagnitude > 0.5

  if (input.crouch && moving) return AnimState.CrouchWalk
  if (input.crouch && !moving) return AnimState.CrouchIdle
  if (input.sprint && moving && velocityMagnitude > MOVE_SPEED) return AnimState.Sprint

  if (moving) {
    // Pick directional animation based on input keys
    const lft = input.left && !input.right
    const rgt = input.right && !input.left

    if (lft) return AnimState.WalkLeft
    if (rgt) return AnimState.WalkRight

    // Forward/backward: run if double-tapped (speed > walk threshold), otherwise walk
    if (velocityMagnitude > (WALK_SPEED + MOVE_SPEED) / 2) return AnimState.Run
    return AnimState.Walk
  }

  return AnimState.Idle
}

/**
 * Derive animation state for a REMOTE player from PlayerState + computed velocity.
 * @param moveAngle - angle of movement in world space (atan2(dx, dz)), or null if not moving
 */
export function deriveRemoteAnimState(
  state: PlayerState,
  velocityMagnitude: number,
  moveAngle?: number,
): AnimState {
  if (!state.alive) return AnimState.DeathFront
  if (state.downed) return AnimState.Dying

  if (state.reloading) return AnimState.Reload
  if (state.shooting) return AnimState.Shoot

  const moving = velocityMagnitude > 0.5

  if (moving && velocityMagnitude > SPRINT_SPEED * 0.9) return AnimState.Sprint
  if (moving && velocityMagnitude > (WALK_SPEED + MOVE_SPEED) / 2) return AnimState.Run

  if (moving) {
    // Compute movement direction relative to facing yaw
    if (moveAngle !== undefined) {
      let rel = moveAngle - state.yaw
      // Normalize to [-PI, PI]
      while (rel > Math.PI) rel -= 2 * Math.PI
      while (rel < -Math.PI) rel += 2 * Math.PI

      // Left strafe: ~-90° (roughly -45° to -135°)
      if (rel < -Math.PI * 0.25 && rel > -Math.PI * 0.75) return AnimState.WalkLeft
      // Right strafe: ~+90° (roughly +45° to +135°)
      if (rel > Math.PI * 0.25 && rel < Math.PI * 0.75) return AnimState.WalkRight
    }
    return AnimState.Walk
  }

  return AnimState.Idle
}
