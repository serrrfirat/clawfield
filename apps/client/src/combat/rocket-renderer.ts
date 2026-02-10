import * as THREE from 'three';
import type { RocketState, Vec3 } from '@clawfield/shared';
import { GRAVITY, ROCKET_MOTOR_GRAVITY, ROCKET_MOTOR_TIME } from '@clawfield/shared';
import { soundManager, SoundId } from '../audio/sound-manager';
import type { ParticleSystem } from './particle-system';

/** Smoke trail emission interval in seconds */
const TRAIL_INTERVAL = 0.015;

/** Max active impact flashes (performance cap) */
const MAX_FLASHES = 4;

/** Impact flash lifetime in seconds */
const FLASH_LIFETIME = 0.35;

/** Tracked rocket with mesh and interpolation data */
interface TrackedRocket {
  group: THREE.Group;
  light: THREE.PointLight;
  velocity: Vec3;
  motorTime: number;
  lastUpdate: number;
  trailTimer: number;
}

/** Temporary impact flash */
interface ImpactFlash {
  light: THREE.PointLight;
  age: number;
}

/**
 * Client-side rocket rendering.
 *
 * Each rocket is a visible cylinder+cone projectile oriented along its
 * velocity vector, with a glowing exhaust light and thick smoke trail.
 * On removal (impact), spawns explosion particles and a bright flash.
 */
export class RocketRenderer {
  private scene: THREE.Scene;
  private rockets = new Map<number, TrackedRocket>();
  private particles: ParticleSystem | null = null;
  private flashes: ImpactFlash[] = [];

  /** Shared geometry and materials */
  private readonly bodyGeometry: THREE.CylinderGeometry;
  private readonly noseGeometry: THREE.ConeGeometry;
  private readonly bodyMaterial: THREE.MeshStandardMaterial;
  private readonly noseMaterial: THREE.MeshStandardMaterial;

  constructor(scene: THREE.Scene) {
    this.scene = scene;

    // Rocket body: cylinder oriented along Y (rotated to velocity later)
    this.bodyGeometry = new THREE.CylinderGeometry(0.12, 0.14, 0.5, 8);
    this.bodyMaterial = new THREE.MeshStandardMaterial({
      color: 0x555555,
      emissive: 0xff4400,
      emissiveIntensity: 1.0,
    });

    // Nose cone at the front
    this.noseGeometry = new THREE.ConeGeometry(0.12, 0.2, 8);
    this.noseMaterial = new THREE.MeshStandardMaterial({
      color: 0x884422,
      emissive: 0xff6600,
      emissiveIntensity: 0.5,
    });
  }

  setParticleSystem(ps: ParticleSystem): void {
    this.particles = ps;
  }

  /** Spawn a client-predicted rocket for instant visual feedback */
  spawnLocal(position: Vec3, direction: Vec3, speed: number): void {
    const id = -(Date.now() % 100000); // negative ID to avoid collision with server IDs
    const velocity: Vec3 = {
      x: direction.x * speed,
      y: direction.y * speed,
      z: direction.z * speed,
    };
    this.createRocket(id, position, velocity, 0);
  }

  /** Update from server rocket states */
  updateFromServer(rockets: RocketState[]): void {
    const serverIds = new Set<number>();

    for (const sr of rockets) {
      serverIds.add(sr.id);

      const existing = this.rockets.get(sr.id);
      if (existing) {
        // Snap to server position
        existing.group.position.set(sr.position.x, sr.position.y, sr.position.z);
        existing.velocity = { ...sr.velocity };
        existing.motorTime = sr.motorTime;
        existing.lastUpdate = performance.now();
        this.orientToVelocity(existing.group, sr.velocity);
      } else {
        this.createRocket(sr.id, sr.position, sr.velocity, sr.motorTime);
      }
    }

    // Remove rockets no longer present on server (they hit something)
    for (const [id, tracked] of this.rockets) {
      if (!serverIds.has(id)) {
        this.onRocketImpact(tracked);
        this.removeRocket(id, tracked);
      }
    }
  }

  /** Per-frame interpolation, trail emission, and flash updates */
  update(dt: number): void {
    // Update rockets
    for (const [_id, tracked] of this.rockets) {
      // Two-phase gravity interpolation
      tracked.motorTime += dt;
      const grav = tracked.motorTime <= ROCKET_MOTOR_TIME
        ? ROCKET_MOTOR_GRAVITY
        : GRAVITY;
      tracked.velocity.y += grav * dt;

      // Advance position
      tracked.group.position.x += tracked.velocity.x * dt;
      tracked.group.position.y += tracked.velocity.y * dt;
      tracked.group.position.z += tracked.velocity.z * dt;

      // Orient mesh along velocity
      this.orientToVelocity(tracked.group, tracked.velocity);

      // Emit smoke trail
      tracked.trailTimer += dt;
      if (tracked.trailTimer >= TRAIL_INTERVAL && this.particles) {
        tracked.trailTimer -= TRAIL_INTERVAL;
        const pos = tracked.group.position;

        // Exhaust flame particles (close to rocket, orange)
        this.particles.emit({
          position: { x: pos.x, y: pos.y, z: pos.z },
          count: 1,
          direction: { x: -tracked.velocity.x, y: -tracked.velocity.y, z: -tracked.velocity.z },
          speedMin: 0.5,
          speedMax: 2.0,
          spread: 0.3,
          lifetimeMin: 0.1,
          lifetimeMax: 0.3,
          sizeMin: 0.1,
          sizeMax: 0.2,
          colors: [[1.0, 0.6, 0.2], [1.0, 0.4, 0.1]],
          gravityScale: 0,
        });

        // Smoke trail (gray, lingers longer)
        this.particles.emit({
          position: { x: pos.x, y: pos.y, z: pos.z },
          count: 3,
          direction: { x: 0, y: 1, z: 0 },
          speedMin: 0.2,
          speedMax: 0.8,
          spread: 0.6,
          lifetimeMin: 0.6,
          lifetimeMax: 2.0,
          sizeMin: 0.25,
          sizeMax: 0.6,
          colors: [[0.7, 0.68, 0.6], [0.5, 0.48, 0.42], [0.4, 0.38, 0.35]],
          gravityScale: -0.02,
        });
      }
    }

    // Update impact flashes (fade out and remove)
    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const flash = this.flashes[i];
      flash.age += dt;
      if (flash.age >= FLASH_LIFETIME) {
        this.scene.remove(flash.light);
        flash.light.dispose();
        this.flashes.splice(i, 1);
      } else {
        // Fade out
        const t = flash.age / FLASH_LIFETIME;
        flash.light.intensity = 5 * (1 - t * t);
      }
    }
  }

  /** Clean up all rockets and shared resources */
  dispose(): void {
    for (const [id, tracked] of this.rockets) {
      this.removeRocket(id, tracked);
    }
    for (const flash of this.flashes) {
      this.scene.remove(flash.light);
      flash.light.dispose();
    }
    this.flashes.length = 0;
    this.bodyGeometry.dispose();
    this.noseGeometry.dispose();
    this.bodyMaterial.dispose();
    this.noseMaterial.dispose();
  }

  // ── Private helpers ─────────────────────────────────

  private createRocket(
    id: number,
    position: Vec3,
    velocity: Vec3,
    motorTime: number,
  ): void {
    const group = new THREE.Group();

    // Body cylinder
    const body = new THREE.Mesh(this.bodyGeometry, this.bodyMaterial);
    group.add(body);

    // Nose cone (offset forward along Y since that's the velocity axis before rotation)
    const nose = new THREE.Mesh(this.noseGeometry, this.noseMaterial);
    nose.position.y = 0.35; // top of body (0.25) + half cone height (0.1)
    group.add(nose);

    // Exhaust glow light at the rear
    const light = new THREE.PointLight(0xff6600, 2, 8);
    light.position.y = -0.3; // behind the rocket
    group.add(light);

    group.position.set(position.x, position.y, position.z);
    this.orientToVelocity(group, velocity);
    this.scene.add(group);

    this.rockets.set(id, {
      group,
      light,
      velocity: { ...velocity },
      motorTime,
      lastUpdate: performance.now(),
      trailTimer: 0,
    });
  }

  /** Spawn explosion effects at the rocket's last position */
  private onRocketImpact(tracked: TrackedRocket): void {
    const pos = tracked.group.position;
    const impactPos = { x: pos.x, y: pos.y, z: pos.z };

    // Play explosion sound at impact location
    soundManager.play3D(SoundId.Explosion, impactPos);

    // Spawn impact flash light
    if (this.flashes.length < MAX_FLASHES) {
      const flash = new THREE.PointLight(0xff8800, 5, 15);
      flash.position.set(pos.x, pos.y, pos.z);
      this.scene.add(flash);
      this.flashes.push({ light: flash, age: 0 });
    }

    if (!this.particles) return;

    // Bright sparks (fast, orange/yellow)
    this.particles.emit({
      position: impactPos,
      count: 35,
      direction: { x: 0, y: 1, z: 0 },
      speedMin: 8,
      speedMax: 22,
      spread: 2.0,
      lifetimeMin: 0.15,
      lifetimeMax: 0.6,
      sizeMin: 0.08,
      sizeMax: 0.2,
      colors: [[1.0, 0.9, 0.3], [1.0, 0.6, 0.1], [1.0, 0.8, 0.2]],
      gravityScale: 0.5,
    });

    // Dark debris (slower, brown)
    this.particles.emit({
      position: impactPos,
      count: 18,
      direction: { x: 0, y: 1, z: 0 },
      speedMin: 4,
      speedMax: 12,
      spread: 1.8,
      lifetimeMin: 0.4,
      lifetimeMax: 1.2,
      sizeMin: 0.1,
      sizeMax: 0.35,
      colors: [[0.3, 0.25, 0.15], [0.2, 0.15, 0.1], [0.15, 0.12, 0.08]],
      gravityScale: 1.0,
    });

    // Smoke puff (slow, large, gray — rises)
    this.particles.emit({
      position: impactPos,
      count: 10,
      direction: { x: 0, y: 1, z: 0 },
      speedMin: 1,
      speedMax: 3,
      spread: 1.5,
      lifetimeMin: 1.0,
      lifetimeMax: 2.5,
      sizeMin: 0.4,
      sizeMax: 1.0,
      colors: [[0.5, 0.48, 0.42], [0.4, 0.38, 0.35], [0.6, 0.58, 0.52]],
      gravityScale: -0.1,
    });
  }

  private removeRocket(id: number, tracked: TrackedRocket): void {
    this.scene.remove(tracked.group);
    tracked.light.dispose();
    this.rockets.delete(id);
  }

  /** Orient a group so its local Y+ axis points along the velocity vector */
  private orientToVelocity(group: THREE.Group, velocity: Vec3): void {
    const len = Math.sqrt(velocity.x * velocity.x + velocity.y * velocity.y + velocity.z * velocity.z);
    if (len < 1e-6) return;
    // Cylinder default orientation is along Y. We want it along velocity.
    const dir = new THREE.Vector3(velocity.x / len, velocity.y / len, velocity.z / len);
    const up = new THREE.Vector3(0, 1, 0);
    const quat = new THREE.Quaternion().setFromUnitVectors(up, dir);
    group.quaternion.copy(quat);
  }
}
