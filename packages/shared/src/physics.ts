import {
  GRAVITY,
  JUMP_VELOCITY,
  WALK_SPEED,
  MOVE_SPEED,
  SPRINT_SPEED,
  CROUCH_SPEED,
  PLAYER_WIDTH,
  PLAYER_HEIGHT,
  CROUCH_HEIGHT,
  MAX_PITCH,
  isWater,
  WATER_MOVE_SPEED,
  WATER_SWIM_UP_SPEED,
  WATER_SINK_SPEED,
  WATER_GRAVITY,
  WATER_DRAG,
  CLIMB_SPEED,
  STEP_HEIGHT,
} from './constants.js';
import type { AABB, InputState, Vec3 } from './types.js';
import type { HeightGetter } from './terrain-noise.js';

/** Get voxel at integer world coordinates — injected to avoid chunk-map dependency */
export type VoxelGetter = (wx: number, wy: number, wz: number) => number;

/** Result of a physics step */
export interface MoveResult {
  position: Vec3;
  velocity: Vec3;
  grounded: boolean;
  inWater: boolean;
  climbing: boolean;
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

/** Check if an AABB overlaps any solid (non-water) voxel */
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
        const v = getVoxel(x, y, z);
        if (v !== 0 && !isWater(v)) {
          return true;
        }
      }
    }
  }
  return false;
}

/** Check if the player's body overlaps any water voxel */
function isInWater(position: Vec3, height: number, getVoxel: VoxelGetter): boolean {
  const hw = PLAYER_WIDTH / 2;
  // Check at waist level (middle of the body)
  const checkY = position.y + height * 0.5;

  const points = [
    { x: position.x, z: position.z },
    { x: position.x - hw + 0.01, z: position.z - hw + 0.01 },
    { x: position.x + hw - 0.01, z: position.z + hw - 0.01 },
  ];

  for (const pt of points) {
    const v = getVoxel(Math.floor(pt.x), Math.floor(checkY), Math.floor(pt.z));
    if (isWater(v)) {
      return true;
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

  // Determine speed: sprint > default (move) > walk (alt) > crouch
  let speed = MOVE_SPEED;
  if (input.sprint && hasMovement) {
    speed = SPRINT_SPEED;
  } else if (input.walk && hasMovement) {
    speed = WALK_SPEED;
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
 * Supports water: buoyancy, drag, and swimming when submerged.
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

  // Detect if the player is in water at the start of this step
  const submerged = isInWater(position, height, getVoxel);

  const yaw = input.yaw;
  const moveVel = inputToVelocity(input, yaw);

  // In water, horizontal speed is capped to WATER_MOVE_SPEED
  let vx: number;
  let vz: number;
  if (submerged) {
    const hLen = Math.sqrt(moveVel.x * moveVel.x + moveVel.z * moveVel.z);
    if (hLen > 0) {
      const scale = Math.min(hLen, WATER_MOVE_SPEED) / hLen;
      vx = moveVel.x * scale;
      vz = moveVel.z * scale;
    } else {
      vx = 0;
      vz = 0;
    }
  } else {
    vx = moveVel.x;
    vz = moveVel.z;
  }

  let vy = velocity.y;

  if (submerged) {
    // Water physics: reduced gravity (buoyancy) + drag
    vy += WATER_GRAVITY * clampedDt;
    // Apply drag to vertical velocity
    const dragFactor = Math.max(0, 1 - WATER_DRAG * clampedDt);
    vy *= dragFactor;

    // Swimming controls: jump = swim up, crouch = swim down
    if (input.jump) {
      vy = WATER_SWIM_UP_SPEED;
    } else if (input.crouch) {
      vy = -WATER_SINK_SPEED;
    }
  } else {
    // Normal gravity
    vy += GRAVITY * clampedDt;

    // Jump if grounded (cannot jump while crouching)
    if (input.jump && !isCrouching && isGrounded(position, getVoxel)) {
      vy = JUMP_VELOCITY;
    }
  }

  // New candidate position
  let px = position.x;
  let py = position.y;
  let pz = position.z;

  // Sweep X axis
  let xBlocked = false;
  const newPx = px + vx * clampedDt;
  const testAABBx = playerAABB({ x: newPx, y: py, z: pz }, height);
  if (!aabbOverlapsSolid(testAABBx, getVoxel)) {
    px = newPx;
  } else {
    xBlocked = moveVel.x !== 0;
    vx = 0;
  }

  // Auto step-up on X axis: if blocked while grounded, try stepping up.
  // Only one step-up per frame to prevent diagonal double-steps climbing 2-voxel walls.
  let didStepUp = false;
  if (xBlocked && !submerged && isGrounded({ x: px, y: py, z: pz }, getVoxel)) {
    const stepY = py + STEP_HEIGHT;
    const stepAABB = playerAABB({ x: newPx, y: stepY, z: pz }, height);
    if (!aabbOverlapsSolid(stepAABB, getVoxel)) {
      px = newPx;
      py = stepY;
      xBlocked = false;
      didStepUp = true;
    }
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
  let zBlocked = false;
  const newPz = pz + vz * clampedDt;
  const testAABBz = playerAABB({ x: px, y: py, z: newPz }, height);
  if (!aabbOverlapsSolid(testAABBz, getVoxel)) {
    pz = newPz;
  } else {
    zBlocked = moveVel.z !== 0;
    vz = 0;
  }

  // Auto step-up on Z axis: if blocked while grounded, skip if already stepped up on X
  if (zBlocked && !didStepUp && !submerged && isGrounded({ x: px, y: py, z: pz }, getVoxel)) {
    const stepY = py + STEP_HEIGHT;
    const stepAABB = playerAABB({ x: px, y: stepY, z: newPz }, height);
    if (!aabbOverlapsSolid(stepAABB, getVoxel)) {
      pz = newPz;
      py = stepY;
      zBlocked = false;
    }
  }

  // Wall climb: if pressing jump into a wall while falling/stationary, scramble up
  let climbing = false;
  if (input.jump && !isCrouching && !submerged && (xBlocked || zBlocked) && vy <= 0) {
    const climbY = py + CLIMB_SPEED * clampedDt;
    const testClimb = playerAABB({ x: px, y: climbY, z: pz }, height);
    if (!aabbOverlapsSolid(testClimb, getVoxel)) {
      py = climbY;
      vy = CLIMB_SPEED;
      climbing = true;
    }
  }

  const grounded = isGrounded({ x: px, y: py, z: pz }, getVoxel);
  const inWater = isInWater({ x: px, y: py, z: pz }, height, getVoxel);

  return {
    position: { x: px, y: py, z: pz },
    velocity: { x: vx, y: vy, z: vz },
    grounded,
    inWater,
    climbing,
  };
}

/** Check if player is standing on solid ground (water is not solid ground) */
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
    const v = getVoxel(Math.floor(pt.x), Math.floor(checkY), Math.floor(pt.z));
    if (v !== 0 && !isWater(v)) {
      return true;
    }
  }
  return false;
}

/** Clamp pitch value */
export function clampPitch(pitch: number): number {
  return Math.max(-MAX_PITCH, Math.min(MAX_PITCH, pitch));
}

/**
 * Move a player on heightmap terrain (no voxel collision).
 * Ground is determined by a height function rather than AABB sweep.
 */
export function movePlayerHeightmap(
  position: Vec3,
  velocity: Vec3,
  input: InputState,
  dt: number,
  getHeight: HeightGetter,
): MoveResult {
  const clampedDt = Math.min(dt, 0.1);
  const isCrouching = input.crouch && !input.sprint;

  const yaw = input.yaw;
  const moveVel = inputToVelocity(input, yaw);

  let vx = moveVel.x;
  let vz = moveVel.z;
  let vy = velocity.y;

  // Apply gravity
  vy += GRAVITY * clampedDt;

  // Move horizontally
  let px = position.x + vx * clampedDt;
  let pz = position.z + vz * clampedDt;
  let py = position.y + vy * clampedDt;

  // Get terrain height at new position
  const terrainY = getHeight(px, pz);

  // Ground collision: snap to terrain if below
  let grounded = false;
  if (py <= terrainY) {
    py = terrainY;
    vy = 0;
    grounded = true;
  }

  // Jump if grounded
  if (input.jump && grounded && !isCrouching) {
    vy = JUMP_VELOCITY;
    grounded = false;
  }

  return {
    position: { x: px, y: py, z: pz },
    velocity: { x: vx, y: vy, z: vz },
    grounded,
    inWater: false,
    climbing: false,
  };
}
