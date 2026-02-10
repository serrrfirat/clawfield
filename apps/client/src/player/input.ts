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

  /** Timestamp when F key was pressed (for long-press detection) */
  private fKeyDownTime = 0;

  /** Whether the radial menu is currently open */
  private _radialMenuOpen = false;

  /** Currently selected gadget index (0 or 1) */
  selectedGadgetIndex = 0;

  /** Accumulated mouse delta X while radial menu is open */
  private radialDeltaX = 0;

  /** Timestamp when G key was pressed (for long-press detection) */
  private gKeyDownTime = 0;

  /** Whether the grenade radial menu is currently open */
  private _grenadeRadialMenuOpen = false;

  /** Currently selected grenade index (0 = frag, 1 = smoke) */
  selectedGrenadeIndex = 0;

  /** Accumulated mouse delta X while grenade radial menu is open */
  private grenadeRadialDeltaX = 0;

  /** Whether the scoreboard is visible (Tab held) */
  scoreboardVisible = false;

  /** Currently selected weapon slot (0 = primary, 1 = secondary, 2 = special) */
  weaponSlot = 0;

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
      if (e.code === 'KeyG' && !e.repeat) {
        this.gKeyDownTime = performance.now();
      }
      if (e.code === 'KeyF' && !e.repeat) {
        this.fKeyDownTime = performance.now();
      }
      if (e.code === 'Digit1' && !e.repeat) {
        this.weaponSlot = 0;
      }
      if (e.code === 'Digit2' && !e.repeat) {
        this.weaponSlot = 1;
      }
      if (e.code === 'Digit3' && !e.repeat) {
        this.weaponSlot = 2;
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
      if (e.code === 'KeyF') {
        const held = performance.now() - this.fKeyDownTime;
        if (this._radialMenuOpen) {
          // Closing radial menu — confirm selection
          this._radialMenuOpen = false;
          this.radialDeltaX = 0;
        } else if (held < 200) {
          // Quick tap — use gadget
          this.gadgetPressed = true;
        }
        // If held >= 200ms but radial not open, do nothing (menu was just opened in consume)
      }
      if (e.code === 'KeyG') {
        const held = performance.now() - this.gKeyDownTime;
        if (this._grenadeRadialMenuOpen) {
          // Closing grenade radial — confirm selection
          this._grenadeRadialMenuOpen = false;
          this.grenadeRadialDeltaX = 0;
        } else if (held < 200) {
          // Quick tap — throw grenade
          this.grenadePressed = true;
        }
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
      if (this._radialMenuOpen) {
        this.radialDeltaX += e.movementX;
      } else if (this._grenadeRadialMenuOpen) {
        this.grenadeRadialDeltaX += e.movementX;
      } else {
        this.mouseDeltaX += e.movementX;
        this.mouseDeltaY += e.movementY;
      }
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

    // Check if F key is being held long enough for radial menu
    if (this.keys.has('KeyF') && this.fKeyDownTime > 0) {
      const held = performance.now() - this.fKeyDownTime;
      if (held >= 200 && !this._radialMenuOpen) {
        this._radialMenuOpen = true;
        this.radialDeltaX = 0;
      }
    }

    // Update gadget selection from accumulated mouse delta when radial menu is open
    if (this._radialMenuOpen) {
      if (this.radialDeltaX > 30) {
        this.selectedGadgetIndex = 1;
      } else if (this.radialDeltaX < -30) {
        this.selectedGadgetIndex = 0;
      }
    }

    // Check if G key is being held long enough for grenade radial menu
    if (this.keys.has('KeyG') && this.gKeyDownTime > 0) {
      const held = performance.now() - this.gKeyDownTime;
      if (held >= 200 && !this._grenadeRadialMenuOpen) {
        this._grenadeRadialMenuOpen = true;
        this.grenadeRadialDeltaX = 0;
      }
    }

    // Update grenade selection from accumulated mouse delta when grenade radial is open
    if (this._grenadeRadialMenuOpen) {
      if (this.grenadeRadialDeltaX > 30) {
        this.selectedGrenadeIndex = 1;
      } else if (this.grenadeRadialDeltaX < -30) {
        this.selectedGrenadeIndex = 0;
      }
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
        gadgetIndex: this.selectedGadgetIndex,
        grenadeIndex: this.selectedGrenadeIndex,
        scope: false,
        interact: false,
        weaponSlot: this.weaponSlot,
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
      shoot: (this._radialMenuOpen || this._grenadeRadialMenuOpen) ? false : (this.mouseDown ||
        (this.rightMouseDown && (this.keys.has('AltLeft') || this.keys.has('AltRight')))),
      reload,
      sprint,
      crouch: sprint ? false : crouch, // mutually exclusive
      throwGrenade,
      useGadget,
      gadgetIndex: this.selectedGadgetIndex,
      grenadeIndex: this.selectedGrenadeIndex,
      scope: this.rightMouseDown,
      interact: this.keys.has('KeyE'),
      weaponSlot: this.weaponSlot,
      yaw: this.yaw,
      pitch: this.pitch,
    };
  }

  /** Whether the radial gadget menu is currently open */
  get radialMenuOpen(): boolean {
    return this._radialMenuOpen;
  }

  /** Whether the grenade radial menu is currently open */
  get grenadeRadialMenuOpen(): boolean {
    return this._grenadeRadialMenuOpen;
  }
}
