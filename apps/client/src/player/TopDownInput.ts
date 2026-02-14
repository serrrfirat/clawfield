import type { InputState } from '@clawfield/shared';

/**
 * Top-down input system.
 * No pointer lock — cursor is free for aiming.
 * WASD moves relative to camera orientation.
 * Mouse position → ground raycast → aimYaw toward cursor.
 */
export class TopDownInputCapture {
  private static GRENADE_HOLD_TOGGLE_MS = 350;
  private keys = new Set<string>();

  /** Left mouse button = shoot */
  private mouseDown = false;
  /** Right mouse button = iron sights (ADS) */
  private rightMouseDown = false;

  /** Reload pressed this frame */
  private reloadPressed = false;
  /** Crouch toggle */
  private crouchToggle = false;
  private crouchTogglePending = false;
  /** Grenade throw pressed this frame */
  private grenadePressed = false;
  /** Gadget use pressed this frame */
  private gadgetPressed = false;

  /** Double-tap detection for running */
  private lastTapKey = '';
  private lastTapTime = 0;
  private _running = false;
  private static DOUBLE_TAP_MS = 300;
  private static RUN_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD']);

  /** F key hold time for radial menu */
  private fKeyDownTime = 0;
  private _radialMenuOpen = false;
  selectedGadgetIndex = 0;

  /** G key hold time for grenade radial */
  private gKeyDownTime = 0;
  private _grenadeRadialMenuOpen = false;
  selectedGrenadeIndex = 0;

  /** Scoreboard visibility */
  scoreboardVisible = false;

  /** Selected weapon slot */
  weaponSlot = 0;

  /** Whether input is disabled (dead) */
  disabled = false;

  /** Movement yaw (camera-relative WASD direction) — computed externally */
  yaw = 0;
  /** Pitch: always 0 for top-down (flat aiming) */
  pitch = 0;
  /** Aim yaw: direction player faces/shoots (toward cursor) — set externally */
  aimYaw = 0;

  /** Whether the player is locked in (always true for top-down, no pointer lock needed) */
  private _active = true;

  constructor() {
    document.addEventListener('keydown', (e) => {
      this.keys.add(e.code);

      // Double-tap detection for running
      if (!e.repeat && TopDownInputCapture.RUN_KEYS.has(e.code)) {
        const now = performance.now();
        if (e.code === this.lastTapKey && now - this.lastTapTime < TopDownInputCapture.DOUBLE_TAP_MS) {
          this._running = true;
        }
        this.lastTapKey = e.code;
        this.lastTapTime = now;
      }

      if (e.code === 'KeyR') this.reloadPressed = true;
      if (e.code === 'KeyG' && !e.repeat) this.gKeyDownTime = performance.now();
      if (e.code === 'KeyF' && !e.repeat) this.fKeyDownTime = performance.now();
      if (e.code === 'Digit1' && !e.repeat) {
        if (this._grenadeRadialMenuOpen) {
          this.selectedGrenadeIndex = 0;
          this._grenadeRadialMenuOpen = false;
        } else {
          this.weaponSlot = 0;
        }
      }
      if (e.code === 'Digit2' && !e.repeat) {
        if (this._grenadeRadialMenuOpen) {
          this.selectedGrenadeIndex = 1;
          this._grenadeRadialMenuOpen = false;
        } else {
          this.weaponSlot = 1;
        }
      }
      if (e.code === 'Digit3' && !e.repeat) {
        if (this._grenadeRadialMenuOpen) {
          this.selectedGrenadeIndex = 2;
          this._grenadeRadialMenuOpen = false;
        } else {
          this.weaponSlot = 2;
        }
      }
      if (e.code === 'Tab') {
        e.preventDefault();
        this.scoreboardVisible = true;
      }
      if (e.code === 'KeyC' && !this.crouchTogglePending) {
        this.crouchToggle = !this.crouchToggle;
        this.crouchTogglePending = true;
      }
    });

    document.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);

      // Stop running when all movement keys are released
      if (TopDownInputCapture.RUN_KEYS.has(e.code)) {
        const anyMovement = this.keys.has('KeyW') || this.keys.has('KeyA') ||
          this.keys.has('KeyS') || this.keys.has('KeyD');
        if (!anyMovement) this._running = false;
      }

      if (e.code === 'KeyC') this.crouchTogglePending = false;
      if (e.code === 'Tab') this.scoreboardVisible = false;
      if (e.code === 'KeyF') {
        const held = performance.now() - this.fKeyDownTime;
        if (this._radialMenuOpen) {
          this._radialMenuOpen = false;
        } else if (held < 200) {
          this.gadgetPressed = true;
        }
      }
      if (e.code === 'KeyG') {
        const held = performance.now() - this.gKeyDownTime;
        if (this._grenadeRadialMenuOpen) {
          this._grenadeRadialMenuOpen = false;
          if (held >= TopDownInputCapture.GRENADE_HOLD_TOGGLE_MS) {
            this.selectedGrenadeIndex = (this.selectedGrenadeIndex + 1) % 3;
          } else {
            this.grenadePressed = true;
          }
        } else if (held < 200) {
          this.grenadePressed = true;
        } else if (held >= TopDownInputCapture.GRENADE_HOLD_TOGGLE_MS) {
          this.selectedGrenadeIndex = (this.selectedGrenadeIndex + 1) % 3;
        }
        this.gKeyDownTime = 0;
      }
    });

    document.addEventListener('mousedown', (e) => {
      if (e.button === 0) this.mouseDown = true;
      if (e.button === 2) this.rightMouseDown = true;
    });

    document.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouseDown = false;
      if (e.button === 2) this.rightMouseDown = false;
    });

    document.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  get locked(): boolean {
    return this._active;
  }

  get radialMenuOpen(): boolean {
    return this._radialMenuOpen;
  }

  get grenadeRadialMenuOpen(): boolean {
    return this._grenadeRadialMenuOpen;
  }

  /**
   * Compute movement yaw from WASD keys relative to aim direction.
   * W = toward cursor, S = away, A/D = strafe perpendicular to aim.
   */
  computeMovementYaw(_cameraAzimuth: number): { yaw: number; hasInput: boolean } {
    const w = this.keys.has('KeyW');
    const s = this.keys.has('KeyS');
    const a = this.keys.has('KeyA');
    const d = this.keys.has('KeyD');

    if (!w && !s && !a && !d) return { yaw: this.yaw, hasInput: false };

    // WASD relative to aim direction: W = forward toward cursor
    let dx = 0;
    let dz = 0;
    if (w) dz -= 1; // forward
    if (s) dz += 1; // backward
    if (a) dx -= 1; // strafe left
    if (d) dx += 1; // strafe right

    // Rotate by aimYaw (the direction the player is aiming)
    const cos = Math.cos(this.aimYaw);
    const sin = Math.sin(this.aimYaw);
    const worldDx = dx * cos - dz * sin;
    const worldDz = dx * sin + dz * cos;

    const moveYaw = Math.atan2(worldDx, -worldDz);
    this.yaw = moveYaw;
    return { yaw: moveYaw, hasInput: true };
  }

  /** Get current input state and consume single-press flags */
  consume(): InputState {
    const reload = this.reloadPressed;
    this.reloadPressed = false;

    const throwGrenade = this.grenadePressed;
    this.grenadePressed = false;

    const sprint = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
    const walk = this.keys.has('AltLeft') || this.keys.has('AltRight');
    const crouch = this.crouchToggle;

    if (sprint) this.crouchToggle = false;

    // Radial menu logic (same as FPS)
    if (this.keys.has('KeyF') && this.fKeyDownTime > 0) {
      const held = performance.now() - this.fKeyDownTime;
      if (held >= 200 && !this._radialMenuOpen) {
        this._radialMenuOpen = true;
      }
    }

    if (this.keys.has('KeyG') && this.gKeyDownTime > 0) {
      const held = performance.now() - this.gKeyDownTime;
      if (held >= 200 && !this._grenadeRadialMenuOpen) {
        this._grenadeRadialMenuOpen = true;
      }
    }

    if (this.disabled) {
      return {
        forward: false, back: false, left: false, right: false,
        jump: false, shoot: false, reload: false, sprint: false,
        crouch: false, throwGrenade: false, useGadget: false,
        gadgetIndex: this.selectedGadgetIndex,
        grenadeIndex: this.selectedGrenadeIndex,
        scope: false, interact: false,
        weaponSlot: this.weaponSlot,
        yaw: this.yaw, pitch: 0, aimYaw: this.aimYaw,
      };
    }

    const useGadget = this.gadgetPressed;
    this.gadgetPressed = false;

    const shoot = (this._radialMenuOpen || this._grenadeRadialMenuOpen)
      ? false
      : this.mouseDown;

    return {
      forward: this.keys.has('KeyW'),
      back: this.keys.has('KeyS'),
      left: this.keys.has('KeyA'),
      right: this.keys.has('KeyD'),
      jump: this.keys.has('Space'),
      shoot,
      reload,
      run: this._running,
      walk,
      sprint: sprint ? true : false,
      crouch: sprint ? false : crouch,
      throwGrenade,
      useGadget,
      gadgetIndex: this.selectedGadgetIndex,
      grenadeIndex: this.selectedGrenadeIndex,
      scope: this.rightMouseDown,
      interact: this.keys.has('KeyE'),
      weaponSlot: this.weaponSlot,
      yaw: this.yaw,
      pitch: 0, // flat aiming in top-down
      aimYaw: this.aimYaw,
    };
  }
}
