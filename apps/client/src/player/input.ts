import type { InputState } from '@clawfield/shared';

/**
 * Captures keyboard and mouse input.
 * Manages pointer lock for first-person controls.
 */
export class InputCapture {
  private keys = new Set<string>();
  private mouseDeltaX = 0;
  private mouseDeltaY = 0;
  private _locked = false;

  /** Mouse button state (left button = shoot) */
  private mouseDown = false;

  /** Right mouse button state (scope/ADS) */
  private rightMouseDown = false;

  /** Reload pressed this frame (single-press, not held) */
  private reloadPressed = false;

  /** Crouch toggle state (KeyC toggles on/off) */
  private crouchToggle = false;
  /** Prevents double-toggle from key repeat */
  private crouchTogglePending = false;

  /** Grenade throw pressed this frame (single-press via KeyG) */
  private grenadePressed = false;

  /** Gadget use pressed this frame (single-press via KeyF) */
  private gadgetPressed = false;

  /** Whether the scoreboard is visible (Tab held) */
  scoreboardVisible = false;

  /** Whether input is disabled (e.g. player is dead) */
  disabled = false;

  /** Current accumulated yaw from mouse movement (radians) */
  yaw = 0;
  /** Current accumulated pitch from mouse movement (radians) */
  pitch = 0;

  constructor() {
    document.addEventListener('keydown', (e) => {
      this.keys.add(e.code);
      if (e.code === 'KeyR') {
        this.reloadPressed = true;
      }
      if (e.code === 'KeyG') {
        this.grenadePressed = true;
      }
      if (e.code === 'KeyF') {
        this.gadgetPressed = true;
      }
      if (e.code === 'Tab') {
        e.preventDefault();
        this.scoreboardVisible = true;
      }
      // Crouch is a toggle on KeyC (only on first press, not repeat)
      if (e.code === 'KeyC' && !this.crouchTogglePending) {
        this.crouchToggle = !this.crouchToggle;
        this.crouchTogglePending = true;
      }
    });

    document.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
      if (e.code === 'KeyC') {
        this.crouchTogglePending = false;
      }
      if (e.code === 'Tab') {
        this.scoreboardVisible = false;
      }
    });

    document.addEventListener('mousedown', (e) => {
      if (e.button === 0 && this._locked) {
        this.mouseDown = true;
      }
      if (e.button === 2 && this._locked) {
        this.rightMouseDown = true;
      }
    });

    document.addEventListener('mouseup', (e) => {
      if (e.button === 0) {
        this.mouseDown = false;
      }
      if (e.button === 2) {
        this.rightMouseDown = false;
      }
    });

    // Prevent context menu on right click
    document.addEventListener('contextmenu', (e) => {
      e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
      if (!this._locked) return;
      this.mouseDeltaX += e.movementX;
      this.mouseDeltaY += e.movementY;
    });

    document.addEventListener('pointerlockchange', () => {
      this._locked = document.pointerLockElement !== null;
      const overlay = document.getElementById('overlay');
      if (overlay) {
        overlay.style.display = this._locked ? 'none' : 'block';
      }
      // Reset mouse state when pointer lock changes
      if (!this._locked) {
        this.mouseDown = false;
        this.rightMouseDown = false;
      }
    });

    document.addEventListener('click', () => {
      if (!this._locked) {
        document.body.requestPointerLock();
      }
    });
  }

  get locked(): boolean {
    return this._locked;
  }

  /** Get current input state and consume mouse deltas */
  consume(sensitivity: number = 0.002): InputState {
    const dx = this.mouseDeltaX * sensitivity;
    const dy = this.mouseDeltaY * sensitivity;
    this.mouseDeltaX = 0;
    this.mouseDeltaY = 0;

    this.yaw += dx;
    this.pitch -= dy;
    this.pitch = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, this.pitch));

    // Capture reload (single press) and then reset the flag
    const reload = this.reloadPressed;
    this.reloadPressed = false;

    const throwGrenade = this.grenadePressed;
    this.grenadePressed = false;

    const sprint = this.keys.has('ShiftLeft');
    const crouch = this.crouchToggle;

    // Sprinting auto-cancels crouch
    if (sprint) {
      this.crouchToggle = false;
    }

    // If disabled (dead), zero out all action inputs
    if (this.disabled) {
      return {
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
        scope: false,
        yaw: this.yaw,
        pitch: this.pitch,
      };
    }

    const useGadget = this.gadgetPressed;
    this.gadgetPressed = false;

    return {
      forward: this.keys.has('KeyW'),
      back: this.keys.has('KeyS'),
      left: this.keys.has('KeyA'),
      right: this.keys.has('KeyD'),
      jump: this.keys.has('Space'),
      shoot: this.mouseDown,
      reload,
      sprint,
      crouch: sprint ? false : crouch, // mutually exclusive
      throwGrenade,
      useGadget,
      scope: this.rightMouseDown,
      yaw: this.yaw,
      pitch: this.pitch,
    };
  }
}
