import type { Vec3, InputState, PlayerState, DebrisState } from '@clawfield/shared';
import {
  movePlayer,
  clampPitch,
  MAT_STONE,
  MAT_WALL,
  MAT_ROOF,
  MAT_ROAD,
  MAT_CONCRETE,
  MAT_CONCRETE_DARK,
  MAT_WOOD,
  MAT_WOOD_DARK,
  MAT_METAL,
  isWater,
  PLAYER_WIDTH,
  PLAYER_HEIGHT,
  CROUCH_HEIGHT,
  type VoxelGetter,
} from '@clawfield/shared';
import { InputCapture } from './input';
import { CameraController } from './camera-controller';
import { WeaponController } from './weapon-controller';
import { soundManager, SoundId } from '../audio/sound-manager';
import type * as THREE from 'three';

/** Stored input for client-side prediction reconciliation */
interface PendingInput {
  seq: number;
  input: InputState;
  dt: number;
}

/**
 * Local player: handles input, client-side prediction,
 * server reconciliation, and weapon management.
 */
export class LocalPlayer {
  readonly input: InputCapture;
  readonly weaponCtrl: WeaponController;
  private cameraCtrl: CameraController;
  private getVoxel: VoxelGetter;
  private getDebrisStates?: () => DebrisState[];

  position: Vec3 = { x: 64, y: 2, z: 64 };
  velocity: Vec3 = { x: 0, y: 0, z: 0 };
  grounded = false;
  climbing = false;
  alive = true;

  /** Time since sprint was released; prevents firing until delay elapses */
  private sprintFireTimer = 0;
  /** Whether player was sprinting last frame */
  private wasSprinting = false;

  /** Footstep sound timer — counts down between footstep sounds */
  private footstepTimer = 0;
  /** Whether player was on ground last frame (for jump/land detection) */
  private wasGrounded = false;

  private inputSeq = 0;
  private pendingInputs: PendingInput[] = [];

  constructor(
    scene: THREE.Scene,
    camera: THREE.PerspectiveCamera,
    getVoxel: VoxelGetter,
    getDebrisStates: (() => DebrisState[]) | undefined,
    classId: string = 'assault',
    weaponId: string = ''
  ) {
    this.input = new InputCapture();
    this.cameraCtrl = new CameraController(camera);
    this.weaponCtrl = new WeaponController(scene, camera, classId, weaponId);
    this.getVoxel = getVoxel;
    this.getDebrisStates = getDebrisStates;

    // Wire up camera shake between weapon controller and camera
    this.weaponCtrl.setCameraShake(this.cameraCtrl.shake);
  }

  /** Run a local physics tick and return the input to send to server */
  update(dt: number): { seq: number; input: InputState; dt: number } | null {
    // Determine movement state for weapon feel (sway/bob)
    const moveSpeed = Math.sqrt(
      this.velocity.x * this.velocity.x + this.velocity.z * this.velocity.z,
    );
    const isMoving = this.grounded && moveSpeed > 1;
    const isCurrentlySprinting = isMoving && this.wasSprinting;

    // Update weapon cooldowns, bloom, sway, bob, and recoil recovery
    this.weaponCtrl.update(dt, isMoving, isCurrentlySprinting, this.input);

    if (!this.input.locked) {
      this.cameraCtrl.update(this.position, this.input.yaw, this.input.pitch, false, dt);
      return null;
    }

    // Reduce mouse sensitivity when scoped for precision aiming
    const sensitivity = this.weaponCtrl.scoped ? 0.0008 : 0.002;
    const inputState = this.input.consume(sensitivity);

    // Update scope (right mouse button for Recon sniper/DMR)
    this.weaponCtrl.updateScope(inputState.scope, dt);

    // Scoping cancels sprint
    if (this.weaponCtrl.scoped) {
      inputState.sprint = false;
    }

    // Track sprint-to-fire delay: when sprint is released, start a cooldown
    const isSprinting = inputState.sprint && (inputState.forward || inputState.back || inputState.left || inputState.right);
    if (isSprinting) {
      this.sprintFireTimer = this.weaponCtrl.activeWeapon.sprintToFireTime;
    } else if (this.sprintFireTimer > 0) {
      this.sprintFireTimer -= dt;
    }

    // Sprint prevents firing (with 0.2s delay after releasing sprint)
    // Climbing also prevents firing (hands are occupied)
    const canFireFromSprint = !isSprinting && this.sprintFireTimer <= 0;
    const canFire = canFireFromSprint && !this.climbing;

    // Gate shoot input through weapon controller (fire rate, ammo)
    // Track firing state for recoil recovery system
    this.weaponCtrl.setFiring(inputState.shoot && canFire);
    if (inputState.shoot && canFire && this.weaponCtrl.canFire()) {
      this.weaponCtrl.onFire(this.input);
      // Recoil mutates InputCapture yaw/pitch; keep packet + camera in sync this frame.
      inputState.yaw = this.input.yaw;
      inputState.pitch = this.input.pitch;
    } else {
      if (inputState.shoot && canFire) {
        this.weaponCtrl.playDryFireIfEmpty();
      }
      inputState.shoot = false;
    }

    // Handle reload
    if (inputState.reload) {
      this.weaponCtrl.onReload();
    }

    this.inputSeq++;

    // Client-side prediction: apply physics locally
    const result = movePlayer(this.position, this.velocity, inputState, dt, this.getVoxel);
    this.resolveDebrisCollision(result.position, result.velocity, result, inputState.crouch && !inputState.sprint);
    this.position = result.position;
    this.velocity = result.velocity;
    this.grounded = result.grounded;
    this.climbing = result.climbing;

    // --- Footstep sounds based on movement speed ---
    if (this.grounded) {
      const speed = Math.sqrt(
        this.velocity.x * this.velocity.x + this.velocity.z * this.velocity.z,
      );
      if (speed > 1) {
        this.footstepTimer -= dt;
        if (this.footstepTimer <= 0) {
          const interval = isSprinting ? 0.24 : 0.4;
          this.footstepTimer = interval;
          // Check material under feet for sound type
          const matBelow = this.getVoxel(
            Math.floor(this.position.x),
            Math.floor(this.position.y - 0.1),
            Math.floor(this.position.z),
          );
          let footstepSound: SoundId;
          if (isWater(matBelow)) {
            footstepSound = SoundId.FootstepWater;
          } else if (matBelow === MAT_METAL) {
            footstepSound = SoundId.FootstepMetal;
          } else if (matBelow === MAT_WOOD || matBelow === MAT_WOOD_DARK) {
            footstepSound = SoundId.FootstepWood;
          } else if (matBelow === MAT_ROAD || matBelow === MAT_CONCRETE || matBelow === MAT_CONCRETE_DARK) {
            footstepSound = SoundId.FootstepConcrete;
          } else if (matBelow === MAT_STONE || matBelow === MAT_WALL || matBelow === MAT_ROOF) {
            footstepSound = SoundId.FootstepStone;
          } else {
            footstepSound = SoundId.FootstepGrass;
          }

          if (isSprinting) {
            soundManager.play3D(SoundId.FootstepSprint, this.position, {
              volume: 0.16,
              pitch: 0.95 + Math.random() * 0.12,
              refDistance: 4,
            });
          }
          soundManager.play3D(footstepSound, this.position, {
            volume: isSprinting ? 0.28 : 0.22,
            pitch: 0.94 + Math.random() * 0.14,
            refDistance: 4,
          });
        }
      } else {
        this.footstepTimer = 0;
      }
    }

    // --- Jump / land sounds ---
    if (!this.wasGrounded && this.grounded) {
      soundManager.play3D(SoundId.Land, this.position, { volume: 0.3, pitch: 0.95 + Math.random() * 0.1 });
    }
    if (this.wasGrounded && !this.grounded && inputState.jump) {
      soundManager.play3D(SoundId.Jump, this.position, { volume: 0.24, pitch: 0.95 + Math.random() * 0.1 });
    }
    this.wasGrounded = this.grounded;

    // Store for reconciliation
    const pending: PendingInput = {
      seq: this.inputSeq,
      input: inputState,
      dt,
    };
    this.pendingInputs.push(pending);

    // Cap pending buffer
    if (this.pendingInputs.length > 120) {
      this.pendingInputs.shift();
    }

    // Determine effective crouch for camera
    const isCrouching = inputState.crouch && !inputState.sprint;

    // Update camera
    this.cameraCtrl.update(this.position, inputState.yaw, inputState.pitch, isCrouching, dt);

    return { seq: this.inputSeq, input: inputState, dt };
  }

  /** Reconcile with authoritative server state */
  reconcile(serverState: PlayerState, lastAckedSeq: number): void {
    // Sync weapon state from server
    this.weaponCtrl.syncFromServer(
      serverState.ammo,
      serverState.maxAmmo,
      serverState.reloading
    );

    // Discard inputs the server has already processed
    this.pendingInputs = this.pendingInputs.filter((p) => p.seq > lastAckedSeq);

    // Start from server position
    let pos = { ...serverState.position };
    let vel = { ...this.velocity };

    // Re-apply unacknowledged inputs
    for (const pending of this.pendingInputs) {
      const result = movePlayer(pos, vel, pending.input, pending.dt, this.getVoxel);
      this.resolveDebrisCollision(pos, vel, result, pending.input.crouch && !pending.input.sprint);
      pos = result.position;
      vel = result.velocity;
    }

    // Check if prediction was close enough
    const dx = pos.x - this.position.x;
    const dy = pos.y - this.position.y;
    const dz = pos.z - this.position.z;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

    if (dist > 0.1) {
      // Significant mismatch — snap to reconciled position
      this.position = pos;
      this.velocity = vel;
    }
  }

  /** Handle hit confirmation from server */
  onHitConfirm(): void {
    this.weaponCtrl.onHitConfirm();
  }

  /** Handle death: disable input and optionally start death cam */
  onDeath(killerPos?: Vec3): void {
    this.alive = false;
    this.input.disabled = true;
    // Exit scope on death
    this.weaponCtrl.updateScope(false, 0);
    if (killerPos) {
      this.cameraCtrl.enterDeathCam(killerPos);
    }
  }

  /** Handle respawn: re-enable input, set position, exit death cam */
  onRespawn(position: Vec3): void {
    this.alive = true;
    this.input.disabled = false;
    this.position = { ...position };
    this.velocity = { x: 0, y: 0, z: 0 };
    this.pendingInputs = [];
    this.cameraCtrl.exitDeathCam();

    // Reset weapon state on respawn
    this.weaponCtrl.ammo = this.weaponCtrl.maxAmmo;
    this.weaponCtrl.reloading = false;
  }

  /** Apply client-side prediction collision against server-authoritative debris */
  private resolveDebrisCollision(
    position: Vec3,
    velocity: Vec3,
    result: { position: Vec3; velocity: Vec3; grounded: boolean },
    crouching: boolean
  ): void {
    const debrisStates = this.getDebrisStates?.();
    if (!debrisStates || debrisStates.length === 0) return;

    const playerRadius = PLAYER_WIDTH * 0.5;
    const playerHeight = crouching ? CROUCH_HEIGHT : PLAYER_HEIGHT;

    // Iterate a few times to resolve stacked overlaps
    for (let i = 0; i < 3; i++) {
      let hit = false;

      for (const debris of debrisStates) {
        const halfSize = debris.scale * 0.5;
        const playerCenterY = position.y + playerHeight * 0.5;
        const dx = position.x - debris.position.x;
        const dy = playerCenterY - debris.position.y;
        const dz = position.z - debris.position.z;

        const overlapX = playerRadius + halfSize - Math.abs(dx);
        const overlapY = playerHeight * 0.5 + halfSize - Math.abs(dy);
        const overlapZ = playerRadius + halfSize - Math.abs(dz);

        if (overlapX <= 0 || overlapY <= 0 || overlapZ <= 0) continue;

        hit = true;
        let nx = 0;
        let ny = 0;
        let nz = 0;
        let penetration = overlapY;

        if (overlapX <= overlapY && overlapX <= overlapZ) {
          nx = dx >= 0 ? 1 : -1;
          penetration = overlapX;
        } else if (overlapZ <= overlapX && overlapZ <= overlapY) {
          nz = dz >= 0 ? 1 : -1;
          penetration = overlapZ;
        } else {
          ny = dy >= 0 ? 1 : -1;
          penetration = overlapY;
        }

        const push = penetration + 0.001;
        position.x += nx * push;
        position.y += ny * push;
        position.z += nz * push;

        const dot = velocity.x * nx + velocity.y * ny + velocity.z * nz;
        if (dot < 0) {
          velocity.x -= dot * nx;
          velocity.y -= dot * ny;
          velocity.z -= dot * nz;
        }
        if (ny > 0.5) {
          result.grounded = true;
        }
      }

      if (!hit) break;
    }

    result.position = position;
    result.velocity = velocity;
  }
}
