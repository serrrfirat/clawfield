import * as THREE from 'three';
import type { WeaponStats } from '@clawfield/shared';
import { WEAPONS, WeaponId, CLASSES, ClassId, fireInterval } from '@clawfield/shared';
import { Viewmodel } from './viewmodel';
import type { InputCapture } from './input';
import { soundManager, SoundId } from '../audio/sound-manager';

/** Tracer line that fades and is removed */
interface Tracer {
  line: THREE.Line;
  material: THREE.LineBasicMaterial;
  /** Remaining lifetime in seconds */
  life: number;
}

/**
 * Tracer fade duration in seconds.
 * Short lifetime — serves as muzzle flash only; actual projectile
 * visuals are handled by ProjectileRenderer.
 */
const TRACER_LIFETIME = 0.05;

/**
 * Manages local weapon state and visual feedback.
 * Ammo/reload state is tracked locally for responsiveness
 * but corrected by authoritative server state.
 */
export class WeaponController {
  /** Current weapon stats */
  weapon: WeaponStats;

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

  constructor(scene: THREE.Scene, camera: THREE.PerspectiveCamera, classId: string = 'assault') {
    const classDef = CLASSES[classId as ClassId] ?? CLASSES[ClassId.Assault];
    this.weapon = WEAPONS[classDef.defaultPrimary];
    this.ammo = this.weapon.magSize;
    this.maxAmmo = this.weapon.magSize;
    this.scene = scene;
    this.camera = camera;

    this.viewmodel = new Viewmodel(camera);
    this.viewmodel.setWeaponType(this.weapon.name);

    this.createHitMarkerElement();
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

  /** Update fire cooldown, tracers, and viewmodel each frame */
  update(dt: number): void {
    if (this.fireCooldown > 0) {
      this.fireCooldown -= dt;
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

    // Update viewmodel recoil animation
    this.viewmodel.update(dt);
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

    // Play weapon fire sound
    const weaponSound = WeaponController.WEAPON_SOUND_MAP[this.weapon.name] ?? SoundId.ShootRifle;
    soundManager.play(weaponSound);

    // Apply recoil to the player's aim (modifies InputCapture so
    // subsequent frames start from the recoiled position, matching
    // Ravenfield's ApplyRecoil approach)
    if (inputCapture) {
      this.applyRecoil(inputCapture);
    }
  }

  /**
   * Apply weapon recoil: kickback pushes pitch up, random deviation
   * adds small random yaw/pitch offset. Values are in radians.
   * Ported from Ravenfield's Weapon.cs recoil system.
   */
  private applyRecoil(inputCapture: InputCapture): void {
    const kick = this.weapon.recoilKick;
    const random = this.weapon.recoilRandom;

    // Kickback: push pitch up (negative pitch = looking up in our system)
    // Random deviation: uniform random in [-random, +random] for both axes
    const randomPitch = (Math.random() * 2 - 1) * random;
    const randomYaw = (Math.random() * 2 - 1) * random;

    // Apply to InputCapture's accumulated yaw/pitch so recoil persists
    inputCapture.pitch -= kick + randomPitch;
    inputCapture.yaw += randomYaw;

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

  /** Change weapon class */
  setClass(classId: string): void {
    const classDef = CLASSES[classId as ClassId] ?? CLASSES[ClassId.Assault];
    this.weapon = WEAPONS[classDef.defaultPrimary];
    this.ammo = this.weapon.magSize;
    this.maxAmmo = this.weapon.magSize;
    this.reloading = false;
    this.fireCooldown = 0;
    this.viewmodel.setWeaponType(this.weapon.name);
  }

  /** Show a brief muzzle flash PointLight at camera position */
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

    // Create a small bright-yellow point light
    this.flashLight = new THREE.PointLight(0xffff44, 2, 8);
    this.flashLight.position.copy(this.camera.position);
    this.scene.add(this.flashLight);

    // Remove after 50ms
    this.flashTimeout = setTimeout(() => {
      if (this.flashLight) {
        this.scene.remove(this.flashLight);
        this.flashLight.dispose();
        this.flashLight = null;
      }
      this.flashTimeout = null;
    }, 50);
  }

  /**
   * Create a short muzzle flash tracer from the gun position.
   * Only extends 2m — actual projectile visuals are handled by
   * ProjectileRenderer receiving server-authoritative positions.
   */
  private fireTracer(): void {
    // Start point: camera position with a slight downward offset (gun position)
    const start = this.camera.position.clone();
    start.y -= 0.15;

    // Direction the camera is looking
    const dir = new THREE.Vector3(0, 0, -1);
    dir.applyQuaternion(this.camera.quaternion);

    // Short muzzle-flash-only tracer (2m) for immediate visual feedback
    const end = start.clone().add(dir.multiplyScalar(2));

    // Build line geometry
    const geometry = new THREE.BufferGeometry().setFromPoints([start, end]);
    const material = new THREE.LineBasicMaterial({
      color: 0xffaa00,
      transparent: true,
      opacity: 1,
    });
    const line = new THREE.Line(geometry, material);
    this.scene.add(line);

    this.tracers.push({ line, material, life: TRACER_LIFETIME });
  }

  /** Show hit marker when server confirms a hit */
  onHitConfirm(): void {
    soundManager.play(SoundId.HitConfirmDing);

    if (!this.hitMarkerEl) return;

    // Clear any existing timeout
    if (this.hitMarkerTimeout !== null) {
      clearTimeout(this.hitMarkerTimeout);
    }

    this.hitMarkerEl.style.display = 'block';

    this.hitMarkerTimeout = setTimeout(() => {
      if (this.hitMarkerEl) {
        this.hitMarkerEl.style.display = 'none';
      }
      this.hitMarkerTimeout = null;
    }, 200);
  }

  /** Clean up DOM elements and Three.js objects */
  dispose(): void {
    if (this.hitMarkerEl) {
      this.hitMarkerEl.remove();
      this.hitMarkerEl = null;
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
