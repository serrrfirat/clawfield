import {
  GRAVITY,
  JUMP_VELOCITY,
  MOVE_SPEED,
  SPRINT_SPEED,
  CROUCH_SPEED,
  PLAYER_WIDTH,
  PLAYER_HEIGHT,
  CROUCH_HEIGHT,
  MAX_PITCH,
} from './constants.js';
import type { AABB, InputState, Vec3 } from './types.js';

/** Get voxel at integer world coordinates — injected to avoid chunk-map dependency */
export type VoxelGetter = (wx: number, wy: number, wz: number) => number;

/** Result of a physics step */
export interface MoveResult {
  position: Vec3;
  velocity: Vec3;
  grounded: boolean;
}

/** Build an AABB from a player position (position is at feet center) */
export function playerAABB(pos: Vec3, height: number = PLAYER_HEIGHT): AABB {
  const hw = PLAYER_WIDTH / 2;
  return {
    minX: pos.x - hw,
    minY: pos.y,
    minZ: pos.z - hw,
    maxX: pos.x + hw,
    maxY: pos.y + height,
    maxZ: pos.z + hw,
  };
}

/** Check if an AABB overlaps any solid voxel */
function aabbOverlapsSolid(aabb: AABB, getVoxel: VoxelGetter): boolean {
  const startX = Math.floor(aabb.minX);
  const endX = Math.floor(aabb.maxX);
  const startY = Math.floor(aabb.minY);
  const endY = Math.floor(aabb.maxY);
  const startZ = Math.floor(aabb.minZ);
  const endZ = Math.floor(aabb.maxZ);

  for (let x = startX; x <= endX; x++) {
    for (let y = startY; y <= endY; y++) {
      for (let z = startZ; z <= endZ; z++) {
        if (getVoxel(x, y, z) !== 0) {
          return true;
        }
      }
    }
  }
  return false;
}

/** Compute desired velocity from input (sprint/crouch affect speed) */
export function inputToVelocity(input: InputState, yaw: number): Vec3 {
  let dx = 0;
  let dz = 0;

  const hasMovement = input.forward || input.back || input.left || input.right;

  // Three.js camera looks down -Z by default. With rotation.y = -yaw,
  // forward = (sin(yaw), 0, -cos(yaw)), right = (cos(yaw), 0, sin(yaw))
  if (input.forward) { dx += Math.sin(yaw); dz -= Math.cos(yaw); }
  if (input.back) { dx -= Math.sin(yaw); dz += Math.cos(yaw); }
  if (input.left) { dx -= Math.cos(yaw); dz -= Math.sin(yaw); }
  if (input.right) { dx += Math.cos(yaw); dz += Math.sin(yaw); }

  // Determine speed: sprint takes priority over crouch, both are mutually exclusive
  let speed = MOVE_SPEED;
  if (input.sprint && hasMovement) {
    speed = SPRINT_SPEED;
  } else if (input.crouch) {
    speed = CROUCH_SPEED;
  }

  // Normalize horizontal movement
  const len = Math.sqrt(dx * dx + dz * dz);
  if (len > 0) {
    dx = (dx / len) * speed;
    dz = (dz / len) * speed;
  }

  return { x: dx, y: 0, z: dz };
}

/**
 * Move a player applying physics against the voxel world.
 * Uses per-axis sweep collision resolution.
 */
export function movePlayer(
  position: Vec3,
  velocity: Vec3,
  input: InputState,
  dt: number,
  getVoxel: VoxelGetter
): MoveResult {
  // Clamp dt to prevent physics explosions on lag spikes
  const clampedDt = Math.min(dt, 0.1);

  // Determine effective hitbox height: crouch (only if not sprinting)
  const isCrouching = input.crouch && !input.sprint;
  const height = isCrouching ? CROUCH_HEIGHT : PLAYER_HEIGHT;

  const yaw = input.yaw;
  const moveVel = inputToVelocity(input, yaw);

  let vx = moveVel.x;
  let vy = velocity.y;
  let vz = moveVel.z;

  // Apply gravity
  vy += GRAVITY * clampedDt;

  // Jump if grounded (cannot jump while crouching)
  if (input.jump && !isCrouching && isGrounded(position, getVoxel)) {
    vy = JUMP_VELOCITY;
  }

  // New candidate position
  let px = position.x;
  let py = position.y;
  let pz = position.z;

  // Sweep X axis
  const newPx = px + vx * clampedDt;
  const testAABBx = playerAABB({ x: newPx, y: py, z: pz }, height);
  if (!aabbOverlapsSolid(testAABBx, getVoxel)) {
    px = newPx;
  } else {
    vx = 0;
  }

  // Sweep Y axis
  const newPy = py + vy * clampedDt;
  const testAABBy = playerAABB({ x: px, y: newPy, z: pz }, height);
  if (!aabbOverlapsSolid(testAABBy, getVoxel)) {
    py = newPy;
  } else {
    // If moving down and blocked, we're grounded
    if (vy < 0) {
      // Snap to the top of the blocking voxel
      py = Math.floor(py) + (py === Math.floor(py) ? 0 : 0);
    }
    vy = 0;
  }

  // Sweep Z axis
  const newPz = pz + vz * clampedDt;
  const testAABBz = playerAABB({ x: px, y: py, z: newPz }, height);
  if (!aabbOverlapsSolid(testAABBz, getVoxel)) {
    pz = newPz;
  } else {
    vz = 0;
  }

  const grounded = isGrounded({ x: px, y: py, z: pz }, getVoxel);

  return {
    position: { x: px, y: py, z: pz },
    velocity: { x: vx, y: vy, z: vz },
    grounded,
  };
}

/** Check if player is standing on solid ground */
function isGrounded(position: Vec3, getVoxel: VoxelGetter): boolean {
  const hw = PLAYER_WIDTH / 2;
  const checkY = position.y - 0.05;

  // Check corners and center at foot level
  const points = [
    { x: position.x, z: position.z },
    { x: position.x - hw + 0.01, z: position.z - hw + 0.01 },
    { x: position.x + hw - 0.01, z: position.z - hw + 0.01 },
    { x: position.x - hw + 0.01, z: position.z + hw - 0.01 },
    { x: position.x + hw - 0.01, z: position.z + hw - 0.01 },
  ];

  for (const pt of points) {
    if (getVoxel(Math.floor(pt.x), Math.floor(checkY), Math.floor(pt.z)) !== 0) {
      return true;
    }
  }
  return false;
}

/** Clamp pitch value */
export function clampPitch(pitch: number): number {
  return Math.max(-MAX_PITCH, Math.min(MAX_PITCH, pitch));
}
