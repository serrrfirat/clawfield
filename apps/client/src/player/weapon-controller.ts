import * as THREE from 'three';
import type { WeaponStats, WeaponLoadout } from '@clawfield/shared';
import { WEAPONS, WeaponId, CLASSES, ClassId, fireInterval, applyAttachments } from '@clawfield/shared';
import { Viewmodel } from './viewmodel';
import type { InputCapture } from './input';
import { soundManager, SoundId } from '../audio/sound-manager';
import type { ParticleSystem } from '../combat/particle-system';
import type { CameraShake } from './camera-shake';
import { SHAKE_FIRE, SHAKE_FIRE_HEAVY, SHAKE_HIT_CONFIRM } from './camera-shake';

/** Default camera FOV */
const DEFAULT_FOV = 75;
/** Scoped-in FOV (zoomed) */
const SCOPED_FOV = 25;
/** Weapons that support scoping */
const SCOPE_WEAPONS = new Set<WeaponId>([WeaponId.SniperRifle, WeaponId.DMR]);

/** Tracer line that fades and is removed */
interface Tracer {
  line: THREE.Line;
  material: THREE.LineBasicMaterial;
  /** Remaining lifetime in seconds */
  life: number;
}

/**
 * Tracer fade duration in seconds.
 * Longer than before for more visible muzzle flash tracer.
 */
const TRACER_LIFETIME = 0.1;

/** Bright muzzle flash particle colors (hot white-yellow) */
const MUZZLE_FLASH_COLORS: [number, number, number][] = [
  [1.0, 1.0, 0.9],
  [1.0, 0.95, 0.5],
  [1.0, 0.85, 0.3],
  [1.0, 1.0, 0.7],
  [1.0, 0.7, 0.2],
];

/** Smoke particle colors for sustained fire */
const MUZZLE_SMOKE_COLORS: [number, number, number][] = [
  [0.7, 0.7, 0.65],
  [0.6, 0.6, 0.55],
  [0.5, 0.5, 0.48],
];

/**
 * Manages local weapon state and visual feedback.
 * Ammo/reload state is tracked locally for responsiveness
 * but corrected by authoritative server state.
 */
export class WeaponController {
  /** Current weapon stats (with attachments applied) */
  weapon: WeaponStats;
  /** Base weapon stats (without attachments) */
  private baseWeapon: WeaponStats;

  /** Local ammo tracking (display only) */
  ammo: number;
  maxAmmo: number;
  reloading = false;

  /** Minimum time between shots (seconds) */
  private fireCooldown = 0;

  /** Reference to the scene for muzzle flash */
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;

  /** Active muzzle flash light */
  private flashLight: THREE.PointLight | null = null;
  private flashTimeout: ReturnType<typeof setTimeout> | null = null;

  /** Hit marker DOM element */
  private hitMarkerEl: HTMLDivElement | null = null;
  private hitMarkerTimeout: ReturnType<typeof setTimeout> | null = null;

  /** Active bullet tracers */
  private tracers: Tracer[] = [];

  /** First-person weapon viewmodel */
  private viewmodel: Viewmodel;

  /** Whether the player is currently scoped in */
  scoped = false;

  /** Scope overlay DOM element */
  private scopeOverlay: HTMLDivElement | null = null;

  /** Particle system for muzzle flash effects */
  private particles: ParticleSystem | null = null;

  /** Camera shake system (set by local player) */
  private cameraShake: CameraShake | null = null;

  // ── Weapon feel state ──────────────────────────────────────────

  /** Current ADS interpolation (0 = hip, 1 = fully aimed) */
  private adsAmount = 0;

  /** Current spread bloom accumulation (radians above base spread) */
  private currentBloom = 0;

  /** Weapon sway phase (time accumulator for sine oscillation) */
  private swayPhase = 0;

  /** View bob phase (accumulates based on movement) */
  private bobPhase = 0;

  /** Current weapon loadout */
  private currentLoadout: WeaponLoadout = {};

  // ── Recoil pattern state ───────────────────────────────────────

  /** Consecutive shot counter for recoil pattern progression */
  private shotCounter = 0;

  /** Time since last shot (for resetting pattern) */
  private timeSinceLastShot = 0;

  /** Accumulated recoil that hasn't been recovered yet (pitch, yaw) */
  private recoilAccumPitch = 0;
  private recoilAccumYaw = 0;

  /** Whether the player is currently firing (mouse held) */
  private isFiring = false;

  // ── Suppression state ──────────────────────────────────────────

  /** Suppression overlay DOM element */
  private suppressionOverlay: HTMLDivElement | null = null;

  /** Current suppression amount (0-1, decays over time) */
  private suppressionAmount = 0;

  constructor(scene: THREE.Scene, camera: THREE.PerspectiveCamera, classId: string = 'assault', weaponId: string = '') {
    const classDef = CLASSES[classId as ClassId] ?? CLASSES[ClassId.Assault];
    // Use selected weapon if valid, otherwise fall back to class default
    const selectedWeaponId = weaponId && WEAPONS[weaponId as WeaponId] ? weaponId as WeaponId : classDef.defaultPrimary;
    this.baseWeapon = WEAPONS[selectedWeaponId];
    this.weapon = { ...this.baseWeapon };
    this.ammo = this.weapon.magSize;
    this.maxAmmo = this.weapon.magSize;
    this.scene = scene;
    this.camera = camera;

    this.viewmodel = new Viewmodel(camera);
    this.viewmodel.setWeaponType(this.weapon.id);

    this.createHitMarkerElement();
    this.createScopeOverlay();
    this.createSuppressionOverlay();
  }

  /** Set the particle system used for muzzle flash effects */
  setParticleSystem(ps: ParticleSystem): void {
    this.particles = ps;
  }

  /** Set the camera shake system */
  setCameraShake(shake: CameraShake): void {
    this.cameraShake = shake;
  }

  /** Apply a weapon loadout (attachments) */
  setLoadout(loadout: WeaponLoadout): void {
    this.currentLoadout = loadout;
    this.weapon = applyAttachments(this.baseWeapon, loadout);
    this.maxAmmo = this.weapon.magSize;
    this.viewmodel.setAttachments(loadout);
  }

  /** Create the hit marker "X" element in the DOM */
  private createHitMarkerElement(): void {
    this.hitMarkerEl = document.createElement('div');
    this.hitMarkerEl.id = 'hit-marker';
    this.hitMarkerEl.textContent = '\u2715'; // unicode X
    this.hitMarkerEl.style.cssText = `
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      color: white;
      font-size: 24px;
      font-weight: bold;
      pointer-events: none;
      z-index: 100;
      text-shadow: 0 0 4px rgba(0,0,0,0.8);
      display: none;
    `;
    document.body.appendChild(this.hitMarkerEl);
  }

  /** Check if this weapon supports scoping */
  get canScope(): boolean {
    return SCOPE_WEAPONS.has(this.weapon.id);
  }

  /** Get current effective spread (base + bloom, reduced when ADS) */
  getEffectiveSpread(): number {
    const hipSpread = this.weapon.spread + this.currentBloom;
    const adsMultiplier = 1 - this.adsAmount * (1 - this.weapon.adsSpreadMultiplier);
    return hipSpread * adsMultiplier;
  }

  /** Update scope state based on input */
  updateScope(wantsScope: boolean, dt: number): void {
    const shouldScope = wantsScope && this.canScope && !this.reloading;
    this.scoped = shouldScope;

    // Smoothly interpolate FOV using weapon-specific ADS speed
    const scopeLerpSpeed = 12 * this.weapon.adsSpeed;
    const targetFov = this.scoped ? SCOPED_FOV : DEFAULT_FOV;
    const currentFov = this.camera.fov;
    const newFov = currentFov + (targetFov - currentFov) * Math.min(1, scopeLerpSpeed * dt);
    if (Math.abs(newFov - currentFov) > 0.01) {
      this.camera.fov = newFov;
      this.camera.updateProjectionMatrix();
    }

    // Update ADS amount for non-scoped weapons (affects spread/sway)
    const adsTarget = wantsScope && !this.reloading ? 1 : 0;
    const adsLerpSpeed = 10 * this.weapon.adsSpeed;
    this.adsAmount += (adsTarget - this.adsAmount) * Math.min(1, adsLerpSpeed * dt);

    // Show/hide scope overlay
    if (this.scopeOverlay) {
      const midFov = (DEFAULT_FOV + SCOPED_FOV) / 2;
      this.scopeOverlay.style.display = this.camera.fov < midFov ? 'block' : 'none';
    }

    // Hide viewmodel when scoped
    this.viewmodel.setVisible(!this.scoped);
  }

  /** Update fire cooldown, tracers, bloom, sway, bob, recoil recovery, and viewmodel each frame */
  update(dt: number, isMoving: boolean, isSprinting: boolean, inputCapture?: InputCapture): void {
    if (this.fireCooldown > 0) {
      this.fireCooldown -= dt;
    }

    // Track time since last shot for recoil pattern reset
    this.timeSinceLastShot += dt;
    // Reset shot counter if not firing for a while (pattern resets)
    if (this.timeSinceLastShot > 0.3) {
      this.shotCounter = 0;
    }

    // Update tracers: fade and remove expired
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const tracer = this.tracers[i];
      tracer.life -= dt;
      if (tracer.life <= 0) {
        this.scene.remove(tracer.line);
        tracer.material.dispose();
        tracer.line.geometry.dispose();
        this.tracers.splice(i, 1);
      } else {
        tracer.material.opacity = tracer.life / TRACER_LIFETIME;
      }
    }

    // ── Spread bloom recovery ──────────────────────────────────
    if (this.currentBloom > 0) {
      this.currentBloom = Math.max(0, this.currentBloom - this.weapon.spreadRecovery * dt);
    }

    // ── Recoil recovery (BattleBit-style auto-center) ──────────
    // When not actively firing, gradually pull the camera back
    // toward the pre-recoil position at the weapon's recovery rate.
    if (!this.isFiring && inputCapture) {
      const recoveryRate = this.weapon.recoilRecovery * dt;

      if (Math.abs(this.recoilAccumPitch) > 0.0001) {
        const pitchRecover = Math.min(Math.abs(this.recoilAccumPitch), recoveryRate);
        // Recoil pushes pitch negative (up), so recovery adds pitch back (down)
        inputCapture.pitch += pitchRecover;
        this.recoilAccumPitch += pitchRecover;
        // Clamp to prevent over-recovery
        if (this.recoilAccumPitch > 0) this.recoilAccumPitch = 0;
      }
      if (Math.abs(this.recoilAccumYaw) > 0.0001) {
        const yawRecover = Math.min(Math.abs(this.recoilAccumYaw), recoveryRate * 0.5);
        inputCapture.yaw -= Math.sign(this.recoilAccumYaw) * yawRecover;
        this.recoilAccumYaw -= Math.sign(this.recoilAccumYaw) * yawRecover;
      }
    }

    // ── Suppression decay ──────────────────────────────────────
    if (this.suppressionAmount > 0) {
      this.suppressionAmount = Math.max(0, this.suppressionAmount - dt * 3);
      this.updateSuppressionOverlay();
    }

    // ── Weapon sway (idle drift when aiming) ───────────────────
    this.swayPhase += dt;

    // ── View bob (movement bounce) ─────────────────────────────
    if (isMoving && !isSprinting) {
      this.bobPhase += dt * 8; // walking bob speed
    } else if (isSprinting) {
      this.bobPhase += dt * 12; // sprint bob speed
    }
    // Bob decays to zero when stopped (phase freezes, no bob applied)

    // Apply sway + bob to viewmodel position
    this.applyWeaponMotion(dt, isMoving, isSprinting);

    // Update viewmodel recoil animation
    this.viewmodel.update(dt);
  }

  /** Mark whether the player is actively holding the fire button */
  setFiring(firing: boolean): void {
    this.isFiring = firing;
  }

  /** Apply weapon sway and view bob to the viewmodel */
  private applyWeaponMotion(_dt: number, isMoving: boolean, isSprinting: boolean): void {
    // Pass movement state to viewmodel for its own bob/sway calculation
    this.viewmodel.setMovementState(isMoving, isSprinting);

    // ADS sway (additional layer on top of viewmodel's idle sway)
    const sway = this.weapon.aimSway * this.adsAmount;
    const swayX = Math.sin(this.swayPhase * 1.1) * sway * 0.5;
    const swayY = Math.sin(this.swayPhase * 0.9) * sway * 0.3;

    if (!this.viewmodel.group.visible) return;
    // Layer ADS sway on top of what viewmodel.update() already applied
    this.viewmodel.group.rotation.x += swayY;
    this.viewmodel.group.rotation.y += swayX;
  }

  /**
   * Attempt to fire. Returns true if the weapon can fire this frame.
   * Used to gate the shoot input so we respect fire rate locally.
   */
  canFire(): boolean {
    if (this.reloading) return false;
    if (this.ammo <= 0) return false;
    if (this.fireCooldown > 0) return false;
    return true;
  }

  /** Map from weapon display name to weapon sound ID */
  private static readonly WEAPON_SOUND_MAP: Record<string, SoundId> = {
    'Assault Rifle': SoundId.ShootRifle,
    'SMG': SoundId.ShootSmg,
    'Medic SMG': SoundId.ShootSmg,
    'Shotgun': SoundId.ShootShotgun,
    'Carbine': SoundId.ShootRifle,
    'PDW': SoundId.ShootSmg,
    'Sniper Rifle': SoundId.ShootSniper,
    'DMR': SoundId.ShootSniper,
  };

  /** Called when a shot is actually sent to the server */
  onFire(inputCapture?: InputCapture): void {
    this.fireCooldown = fireInterval(this.weapon);
    this.ammo = Math.max(0, this.ammo - 1);
    this.showMuzzleFlash();
    this.fireTracer();
    this.viewmodel.onFire();

    // Advance shot counter for recoil pattern
    this.shotCounter++;
    this.timeSinceLastShot = 0;

    // Add spread bloom per shot
    this.currentBloom += this.weapon.spreadBloom;

    // Play layered weapon fire sounds (main shot + bass thump + reverb tail)
    const weaponSound = WeaponController.WEAPON_SOUND_MAP[this.weapon.name] ?? SoundId.ShootRifle;
    soundManager.play(weaponSound);
    soundManager.play(SoundId.ShootBass);
    // Play tail reverb less frequently to avoid sound overload
    if (this.shotCounter % 3 === 1) {
      soundManager.play(SoundId.ShootTail);
    }

    // Apply patterned recoil to the player's aim
    if (inputCapture) {
      this.applyRecoil(inputCapture);
    }

    // Camera shake on fire — heavier for shotgun/sniper
    if (this.cameraShake) {
      const isHeavy = this.weapon.id === WeaponId.Shotgun
        || this.weapon.id === WeaponId.SniperRifle;
      const preset = isHeavy ? SHAKE_FIRE_HEAVY : SHAKE_FIRE;
      // Scale shake based on weapon's recoil intensity
      const scale = this.weapon.recoilKick / 0.015; // normalized to AR baseline
      this.cameraShake.add(preset, Math.min(scale, 2.5));
    }
  }

  /**
   * BattleBit-style recoil pattern: predictable vertical climb with a
   * subtle horizontal S-pattern, plus random deviation on top.
   * Recoil accumulates for recovery tracking.
   */
  private applyRecoil(inputCapture: InputCapture): void {
    const kick = this.weapon.recoilKick;
    const random = this.weapon.recoilRandom;
    const shot = this.shotCounter;

    // ── Vertical recoil: consistent upward kick that increases slightly
    // for the first few shots (controllable pattern)
    const verticalRamp = Math.min(1.0 + shot * 0.04, 1.5);
    const verticalKick = kick * verticalRamp;

    // ── Horizontal recoil: S-curve pattern that alternates sides
    // BattleBit uses a predictable left-right-left pattern
    const patternPhase = Math.sin(shot * 0.8) * 0.6 + Math.sin(shot * 1.4) * 0.4;
    const horizontalKick = kick * 0.35 * patternPhase;

    // ── Random deviation: smaller than the pattern for controllability
    const randomPitch = (Math.random() * 2 - 1) * random * 0.6;
    const randomYaw = (Math.random() * 2 - 1) * random;

    // Apply to InputCapture
    const totalPitch = verticalKick + randomPitch;
    const totalYaw = horizontalKick + randomYaw;

    inputCapture.pitch -= totalPitch;
    inputCapture.yaw += totalYaw;

    // Track for recoil recovery
    this.recoilAccumPitch -= totalPitch;
    this.recoilAccumYaw += totalYaw;

    // Clamp pitch to prevent flipping
    inputCapture.pitch = Math.max(
      -Math.PI / 2 + 0.01,
      Math.min(Math.PI / 2 - 0.01, inputCapture.pitch)
    );
  }

  /** Called when reload starts locally */
  onReload(): void {
    if (this.reloading) return;
    if (this.ammo >= this.maxAmmo) return;
    this.reloading = true;
    soundManager.play(SoundId.Reload);
  }

  /** Sync local state with authoritative server state */
  syncFromServer(ammo: number, maxAmmo: number, reloading: boolean): void {
    this.ammo = ammo;
    this.maxAmmo = maxAmmo;
    this.reloading = reloading;
  }

  /** Create the scope overlay element (dark vignette with crosshair) */
  private createScopeOverlay(): void {
    this.scopeOverlay = document.createElement('div');
    this.scopeOverlay.id = 'scope-overlay';
    this.scopeOverlay.style.cssText = `
      position: fixed;
      top: 0; left: 0; right: 0; bottom: 0;
      pointer-events: none;
      z-index: 90;
      display: none;
    `;
    // Dark vignette around the edges using radial gradient
    this.scopeOverlay.style.background =
      'radial-gradient(circle at center, transparent 25%, rgba(0,0,0,0.85) 55%, rgba(0,0,0,0.98) 70%)';

    // Scope crosshair lines
    const crosshairH = document.createElement('div');
    crosshairH.style.cssText = `
      position: absolute;
      top: 50%; left: 25%; right: 25%;
      height: 1px;
      background: rgba(0,0,0,0.6);
    `;
    const crosshairV = document.createElement('div');
    crosshairV.style.cssText = `
      position: absolute;
      left: 50%; top: 25%; bottom: 25%;
      width: 1px;
      background: rgba(0,0,0,0.6);
    `;
    // Center dot
    const dot = document.createElement('div');
    dot.style.cssText = `
      position: absolute;
      top: 50%; left: 50%;
      width: 3px; height: 3px;
      background: red;
      border-radius: 50%;
      transform: translate(-50%, -50%);
    `;
    this.scopeOverlay.appendChild(crosshairH);
    this.scopeOverlay.appendChild(crosshairV);
    this.scopeOverlay.appendChild(dot);
    document.body.appendChild(this.scopeOverlay);
  }

  /** Change weapon class */
  setClass(classId: string, weaponId: string = ''): void {
    const classDef = CLASSES[classId as ClassId] ?? CLASSES[ClassId.Assault];
    const selectedWeaponId = weaponId && WEAPONS[weaponId as WeaponId] ? weaponId as WeaponId : classDef.defaultPrimary;
    this.baseWeapon = WEAPONS[selectedWeaponId];
    this.weapon = applyAttachments(this.baseWeapon, this.currentLoadout);
    this.ammo = this.weapon.magSize;
    this.maxAmmo = this.weapon.magSize;
    this.reloading = false;
    this.fireCooldown = 0;
    this.scoped = false;
    this.adsAmount = 0;
    this.currentBloom = 0;
    this.camera.fov = DEFAULT_FOV;
    this.camera.updateProjectionMatrix();
    if (this.scopeOverlay) this.scopeOverlay.style.display = 'none';
    this.viewmodel.setWeaponType(this.weapon.id);
    this.viewmodel.setAttachments(this.currentLoadout);
  }

  /** Show a bright muzzle flash with particles and light */
  private showMuzzleFlash(): void {
    // Clean up any existing flash
    if (this.flashLight) {
      this.scene.remove(this.flashLight);
      this.flashLight.dispose();
      this.flashLight = null;
    }
    if (this.flashTimeout !== null) {
      clearTimeout(this.flashTimeout);
    }

    // Brighter, larger point light for more visible flash
    this.flashLight = new THREE.PointLight(0xffee44, 4, 14);
    this.flashLight.position.copy(this.camera.position);
    this.scene.add(this.flashLight);

    // Flash duration scales with weapon heaviness
    const flashDuration = this.weapon.id === WeaponId.Shotgun ? 80 : 60;

    this.flashTimeout = setTimeout(() => {
      if (this.flashLight) {
        this.scene.remove(this.flashLight);
        this.flashLight.dispose();
        this.flashLight = null;
      }
      this.flashTimeout = null;
    }, flashDuration);

    // Emit muzzle flash particles — more particles, wider variety
    if (this.particles) {
      const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
      const muzzlePos = this.camera.position.clone().add(dir.clone().multiplyScalar(0.5));
      muzzlePos.y -= 0.15;

      // Main flash burst — bright, fast
      this.particles.emit({
        position: { x: muzzlePos.x, y: muzzlePos.y, z: muzzlePos.z },
        count: 10,
        direction: { x: dir.x, y: dir.y, z: dir.z },
        speedMin: 8,
        speedMax: 22,
        spread: 0.4,
        lifetimeMin: 0.03,
        lifetimeMax: 0.1,
        sizeMin: 0.06,
        sizeMax: 0.18,
        colors: MUZZLE_FLASH_COLORS,
        gravityScale: 0,
      });

      // Light smoke wisps — slower, longer-lived, drifts upward
      if (this.shotCounter > 3) {
        this.particles.emit({
          position: { x: muzzlePos.x, y: muzzlePos.y, z: muzzlePos.z },
          count: 3,
          direction: { x: dir.x, y: dir.y + 0.5, z: dir.z },
          speedMin: 1,
          speedMax: 3,
          spread: 0.6,
          lifetimeMin: 0.15,
          lifetimeMax: 0.35,
          sizeMin: 0.08,
          sizeMax: 0.2,
          colors: MUZZLE_SMOKE_COLORS,
          gravityScale: -0.3,
        });
      }
    }
  }

  /**
   * Create a visible muzzle flash tracer from the gun position.
   * Longer and brighter than before for better visual feedback.
   * Actual projectile travel is handled by ProjectileRenderer.
   */
  private fireTracer(): void {
    // Start point: camera position with a slight downward offset (gun position)
    const start = this.camera.position.clone();
    start.y -= 0.15;

    // Direction the camera is looking
    const dir = new THREE.Vector3(0, 0, -1);
    dir.applyQuaternion(this.camera.quaternion);

    // Longer tracer (4m) for more visible muzzle flash feedback
    const end = start.clone().add(dir.multiplyScalar(4));

    // Build line geometry — brighter, whiter color
    const geometry = new THREE.BufferGeometry().setFromPoints([start, end]);
    const material = new THREE.LineBasicMaterial({
      color: 0xffdd44,
      transparent: true,
      opacity: 1,
      linewidth: 2,
    });
    const line = new THREE.Line(geometry, material);
    this.scene.add(line);

    this.tracers.push({ line, material, life: TRACER_LIFETIME });
  }

  /** Show hit marker when server confirms a hit — BattleBit-style satisfying feedback */
  onHitConfirm(isKill = false): void {
    soundManager.play(SoundId.HitConfirmDing);

    // Camera shake for hit confirm feedback
    if (this.cameraShake) {
      SHAKE_HIT_CONFIRM.intensity = isKill ? 0.004 : 0.002;
      this.cameraShake.add(SHAKE_HIT_CONFIRM);
    }

    if (!this.hitMarkerEl) return;

    // Clear any existing timeout
    if (this.hitMarkerTimeout !== null) {
      clearTimeout(this.hitMarkerTimeout);
    }

    // Animate hitmarker: start large and bright, shrink to normal
    this.hitMarkerEl.style.display = 'block';
    this.hitMarkerEl.style.color = isKill ? '#ff4444' : '#ffffff';
    this.hitMarkerEl.style.fontSize = isKill ? '36px' : '28px';
    this.hitMarkerEl.style.transform = 'translate(-50%, -50%) scale(1.4)';
    this.hitMarkerEl.style.transition = 'none';

    // Force reflow then animate shrink
    void this.hitMarkerEl.offsetHeight;
    this.hitMarkerEl.style.transition = 'transform 0.15s ease-out, opacity 0.15s ease-out';
    this.hitMarkerEl.style.transform = 'translate(-50%, -50%) scale(1.0)';

    const duration = isKill ? 400 : 250;
    this.hitMarkerTimeout = setTimeout(() => {
      if (this.hitMarkerEl) {
        this.hitMarkerEl.style.display = 'none';
        this.hitMarkerEl.style.fontSize = '24px';
        this.hitMarkerEl.style.color = 'white';
      }
      this.hitMarkerTimeout = null;
    }, duration);
  }

  /** Apply suppression effect (called when enemy bullets pass near the player) */
  onSuppression(intensity = 0.5): void {
    this.suppressionAmount = Math.min(1, this.suppressionAmount + intensity);
    this.updateSuppressionOverlay();
  }

  /** Create the suppression overlay (vignette + blur when bullets near) */
  private createSuppressionOverlay(): void {
    this.suppressionOverlay = document.createElement('div');
    this.suppressionOverlay.id = 'suppression-overlay';
    this.suppressionOverlay.style.cssText = `
      position: fixed;
      top: 0; left: 0; right: 0; bottom: 0;
      pointer-events: none;
      z-index: 85;
      display: none;
      background: radial-gradient(circle at center, transparent 40%, rgba(0,0,0,0.4) 100%);
    `;
    document.body.appendChild(this.suppressionOverlay);
  }

  /** Update suppression overlay opacity based on current suppression amount */
  private updateSuppressionOverlay(): void {
    if (!this.suppressionOverlay) return;
    if (this.suppressionAmount <= 0.01) {
      this.suppressionOverlay.style.display = 'none';
    } else {
      this.suppressionOverlay.style.display = 'block';
      this.suppressionOverlay.style.opacity = String(this.suppressionAmount);
    }
  }

  /** Clean up DOM elements and Three.js objects */
  dispose(): void {
    if (this.hitMarkerEl) {
      this.hitMarkerEl.remove();
      this.hitMarkerEl = null;
    }
    if (this.scopeOverlay) {
      this.scopeOverlay.remove();
      this.scopeOverlay = null;
    }
    if (this.suppressionOverlay) {
      this.suppressionOverlay.remove();
      this.suppressionOverlay = null;
    }
    if (this.flashLight) {
      this.scene.remove(this.flashLight);
      this.flashLight.dispose();
      this.flashLight = null;
    }
    if (this.flashTimeout !== null) clearTimeout(this.flashTimeout);
    if (this.hitMarkerTimeout !== null) clearTimeout(this.hitMarkerTimeout);

    // Clean up tracers
    for (const tracer of this.tracers) {
      this.scene.remove(tracer.line);
      tracer.material.dispose();
      tracer.line.geometry.dispose();
    }
    this.tracers = [];

    // Clean up viewmodel
    this.viewmodel.dispose();
  }
}
