import * as THREE from 'three';
import type { ProjectileState, Vec3 } from '@clawfield/shared';
import { GRAVITY, MAT_METAL, MAT_WOOD, MAT_WOOD_DARK, MAT_CONCRETE, MAT_CONCRETE_DARK, MAT_ROAD } from '@clawfield/shared';
import type { ParticleSystem } from './particle-system';
import type { ImpactSystem } from './impact-system';
import { soundManager, SoundId } from '../audio/sound-manager';

/** Maximum number of point lights attached to projectiles (performance cap) */
const MAX_PROJECTILE_LIGHTS = 5;
const PROJECTILE_CORE_VISIBLE = false;
const IMPACT_VISUAL_LIFT = 0.42;

/** Number of trail segments per bullet trace (creates TRAIL_LENGTH+1 vertices) */
const TRAIL_LENGTH = 8;

/** Tracked projectile with mesh and interpolation data */
interface TrackedProjectile {
  mesh: THREE.Mesh;
  light: THREE.PointLight | null;
  velocity: Vec3;
  ownerId?: string;
  nearMissUntil?: number;
  lastUpdate: number;
  /** Max range — local projectiles are cleaned up when they exceed this */
  maxRange?: number;
  /** Distance traveled so far (local projectiles only) */
  distanceTraveled?: number;
  /** Target world position — local projectiles snap here on removal for precise impact */
  targetPos?: Vec3;
  /** Trail line mesh for bullet trace */
  trail: THREE.Line;
  /** Trail vertex positions buffer (mutated in-place each frame) */
  trailPositions: Float32Array;
}

/**
 * Manages visible projectile meshes in the scene.
 *
 * For the local player: spawns client-predicted projectiles immediately
 * at the camera/muzzle position for instant visual feedback.
 * For other players: receives authoritative state from the server.
 */
/** Impact spark particle colors (bright yellows and oranges) */
const IMPACT_COLORS: [number, number, number][] = [
  [1.0, 0.85, 0.2],
  [1.0, 0.65, 0.1],
  [1.0, 0.9, 0.5],
  [0.9, 0.5, 0.1],
  [1.0, 1.0, 0.85],
  [1.0, 0.75, 0.35],
];

const IMPACT_FLASH_COLORS: [number, number, number][] = [
  [1.0, 1.0, 1.0],
  [1.0, 0.95, 0.8],
  [1.0, 0.88, 0.62],
];

export class ProjectileRenderer {
  private scene: THREE.Scene;
  private projectiles = new Map<number, TrackedProjectile>();
  private particles: ParticleSystem | null = null;
  private impactSystem: ImpactSystem | null = null;
  private voxelGetter: ((wx: number, wy: number, wz: number) => number) | null = null;
  private onImpact: ((position: Vec3, impulse: Vec3) => void) | null = null;

  /** Local player ID — used to skip own projectiles from server data */
  private localPlayerId: string | null = null;

  /** Counter for client-predicted projectile IDs (negative to avoid server ID conflicts) */
  private localNextId = -1;

  /** Shared geometry and material for all projectile meshes (reused for performance) */
  private readonly sharedGeometry: THREE.BoxGeometry;
  private readonly sharedMaterial: THREE.MeshBasicMaterial;
  private readonly trailMaterial: THREE.ShaderMaterial;

  /** Count of currently active projectile lights */
  private activeLightCount = 0;

  constructor(scene: THREE.Scene) {
    this.scene = scene;

    // Elongated box that looks like a tracer round
    this.sharedGeometry = new THREE.BoxGeometry(0.13, 0.13, 0.24);
    this.sharedMaterial = new THREE.MeshBasicMaterial({ color: 0xfff19a });

    // Trail line shader: per-vertex alpha for fading tracer effect
    this.trailMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: new THREE.Color(0xfff0b0) },
      },
      vertexShader: /* glsl */ `
        attribute float aAlpha;
        varying float vAlpha;
        void main() {
          vAlpha = aAlpha;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        varying float vAlpha;
        void main() {
          gl_FragColor = vec4(uColor, vAlpha * 0.95);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
  }

  setParticleSystem(ps: ParticleSystem): void {
    this.particles = ps;
  }

  setImpactSystem(impact: ImpactSystem): void {
    this.impactSystem = impact;
  }

  setVoxelGetter(getter: (wx: number, wy: number, wz: number) => number): void {
    this.voxelGetter = getter;
  }

  setOnImpact(callback: ((position: Vec3, impulse: Vec3) => void) | null): void {
    this.onImpact = callback;
  }

  setLocalPlayerId(id: string): void {
    this.localPlayerId = id;
  }

  /**
   * Update from server projectile states.
   * Adds new projectiles, updates existing ones, removes stale ones.
   * Skips local predicted projectiles (negative IDs) and projectiles owned by local player.
   */
  updateFromServer(projectiles: ProjectileState[]): void {
    const serverIds = new Set<number>();

    for (const sp of projectiles) {
      // Skip if this projectile belongs to the local player (we simulate it locally)
      if (this.localPlayerId && sp.ownerId === this.localPlayerId) {
        continue;
      }

      serverIds.add(sp.id);

      const existing = this.projectiles.get(sp.id);
      if (existing) {
        // Update position and velocity from server
        existing.mesh.position.set(sp.position.x, sp.position.y, sp.position.z);
        existing.velocity = { ...sp.velocity };
        existing.lastUpdate = performance.now();

        if (existing.light) {
          existing.light.position.copy(existing.mesh.position);
        }
        this.updateTrail(existing);
      } else {
        // Create new projectile from server state
        this.createProjectile(sp);
      }
    }

    // Remove server projectiles no longer present (don't touch local predicted ones)
    for (const [id, tracked] of this.projectiles) {
      if (id > 0 && !serverIds.has(id)) {
        this.removeProjectile(id, tracked);
      }
    }
  }

  /**
   * Spawn a client-predicted projectile for instant visual feedback.
   * Uses negative IDs to avoid conflicts with server-assigned IDs.
   */
  spawnLocal(
    position: Vec3,
    velocity: Vec3,
    maxRange: number,
    targetPos?: Vec3
  ): void {
    const id = this.localNextId--;
    const mesh = new THREE.Mesh(this.sharedGeometry, this.sharedMaterial);
    mesh.visible = PROJECTILE_CORE_VISIBLE;
    mesh.position.set(position.x, position.y, position.z);
    this.scene.add(mesh);

    let light: THREE.PointLight | null = null;
    if (this.activeLightCount < MAX_PROJECTILE_LIGHTS) {
      light = new THREE.PointLight(0xffaa00, 0.5, 4);
      light.position.copy(mesh.position);
      this.scene.add(light);
      this.activeLightCount++;
    }

    const trail = this.createTrailLine();
    this.scene.add(trail.line);

    const tracked: TrackedProjectile = {
      mesh,
      light,
      velocity: { ...velocity },
      lastUpdate: performance.now(),
      maxRange,
      distanceTraveled: 0,
      targetPos,
      trail: trail.line,
      trailPositions: trail.positions,
    };

    this.initializeTrail(tracked);
    this.projectiles.set(id, tracked);
  }

  /**
   * Per-frame update: interpolate projectile positions locally between server ticks.
   * Also advances local predicted projectiles.
   */
  update(dt: number, listenerPos: Vec3): void {
    const now = performance.now();

    for (const [id, tracked] of this.projectiles) {
      // 1. Update position based on velocity
      const moveX = tracked.velocity.x * dt;
      const moveY = tracked.velocity.y * dt;
      const moveZ = tracked.velocity.z * dt;

      const prevPos = { ...tracked.mesh.position };

      tracked.mesh.position.x += moveX;
      tracked.mesh.position.y += moveY;
      tracked.mesh.position.z += moveZ;

      // 2. Rotate mesh to face direction of travel
      tracked.mesh.lookAt(
        tracked.mesh.position.x + tracked.velocity.x,
        tracked.mesh.position.y + tracked.velocity.y,
        tracked.mesh.position.z + tracked.velocity.z
      );

      if (tracked.light) {
        tracked.light.position.copy(tracked.mesh.position);
      }

      this.updateTrail(tracked);

      // 3. Check for near-miss whiz sound (only if not recently played)
      if (id > 0 && (!tracked.nearMissUntil || now > tracked.nearMissUntil)) {
        // Simple distance check to listener
        const dx = tracked.mesh.position.x - listenerPos.x;
        const dy = tracked.mesh.position.y - listenerPos.y;
        const dz = tracked.mesh.position.z - listenerPos.z;
        const distSq = dx * dx + dy * dy + dz * dz;

        // If close (within 3m) and moving fast enough
        if (distSq < 9) {
          soundManager.play3D(SoundId.BulletWhiz, tracked.mesh.position, { volume: 0.15, pitch: 0.9 + Math.random() * 0.2 });
          tracked.nearMissUntil = now + 200; // Debounce whiz sounds per bullet
        }
      }

      // 4. Handle local projectile expiration/impact
      if (id < 0) {
        const moveDist = Math.sqrt(moveX * moveX + moveY * moveY + moveZ * moveZ);
        tracked.distanceTraveled = (tracked.distanceTraveled || 0) + moveDist;

        // Check if we hit max range or passed target
        let shouldRemove = false;
        if (tracked.maxRange && tracked.distanceTraveled >= tracked.maxRange) {
          shouldRemove = true;
        }

        // If we have a specific target point (raycast hit), check if we passed it
        if (tracked.targetPos) {
          const toTarget = {
            x: tracked.targetPos.x - prevPos.x,
            y: tracked.targetPos.y - prevPos.y,
            z: tracked.targetPos.z - prevPos.z
          };
          const distToTargetSq = toTarget.x * toTarget.x + toTarget.y * toTarget.y + toTarget.z * toTarget.z;
          const moveDistSq = moveDist * moveDist;

          // If we moved further than the distance to target, we hit
          if (moveDistSq >= distToTargetSq) {
            // Snap to exact target pos for visual impact
            tracked.mesh.position.set(tracked.targetPos.x, tracked.targetPos.y, tracked.targetPos.z);
            shouldRemove = true;
          }
        }

        if (shouldRemove) {
          this.removeProjectile(id, tracked);
        }
      }
    }
  }

  dispose(): void {
    for (const [id, tracked] of this.projectiles) {
      this.removeProjectile(id, tracked);
    }
    this.sharedGeometry.dispose();
    this.sharedMaterial.dispose();
    this.trailMaterial.dispose();
  }

  private createProjectile(sp: ProjectileState): void {
    const mesh = new THREE.Mesh(this.sharedGeometry, this.sharedMaterial);
    mesh.visible = PROJECTILE_CORE_VISIBLE;
    mesh.position.set(sp.position.x, sp.position.y, sp.position.z);
    this.scene.add(mesh);

    let light: THREE.PointLight | null = null;
    if (this.activeLightCount < MAX_PROJECTILE_LIGHTS) {
      light = new THREE.PointLight(0xffaa00, 0.5, 4);
      light.position.copy(mesh.position);
      this.scene.add(light);
      this.activeLightCount++;
    }

    const trail = this.createTrailLine();
    this.scene.add(trail.line);

    const tracked: TrackedProjectile = {
      mesh,
      light,
      velocity: { ...sp.velocity },
      ownerId: sp.ownerId,
      lastUpdate: performance.now(),
      trail: trail.line,
      trailPositions: trail.positions,
    };

    this.initializeTrail(tracked);
    this.projectiles.set(sp.id, tracked);
  }

  private createTrailLine(): { line: THREE.Line; positions: Float32Array } {
    // Create buffers for trail
    const positions = new Float32Array((TRAIL_LENGTH + 1) * 3);
    const alphas = new Float32Array(TRAIL_LENGTH + 1);

    // Initialize alphas (fade out towards tail)
    for (let i = 0; i <= TRAIL_LENGTH; i++) {
      alphas[i] = 1.0 - i / TRAIL_LENGTH;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('aAlpha', new THREE.BufferAttribute(alphas, 1));

    // Initially collapse all points to 0
    geometry.setDrawRange(0, 1);

    const mat = this.trailMaterial.clone();
    const line = new THREE.Line(geometry, mat);
    line.frustumCulled = false; // Always render
    return { line, positions };
  }

  private initializeTrail(tracked: TrackedProjectile): void {
    const p = tracked.mesh.position;
    for (let i = 0; i <= TRAIL_LENGTH; i++) {
      tracked.trailPositions[i * 3 + 0] = p.x;
      tracked.trailPositions[i * 3 + 1] = p.y;
      tracked.trailPositions[i * 3 + 2] = p.z;
    }
    const attr = tracked.trail.geometry.getAttribute('position') as THREE.BufferAttribute;
    attr.needsUpdate = true;
    tracked.trail.geometry.setDrawRange(0, 1);
  }

  private updateTrail(tracked: TrackedProjectile): void {
    // Shift positions down (0 is head, N is tail)
    // Actually, let's keep 0 as head.
    // Shift: pos[i] = pos[i-1] is wrong direction if 0 is head.
    // We want 0 (head) to take new pos. 1 takes old 0. 2 takes old 1.
    for (let i = TRAIL_LENGTH; i > 0; i--) {
      tracked.trailPositions[i * 3 + 0] = tracked.trailPositions[(i - 1) * 3 + 0];
      tracked.trailPositions[i * 3 + 1] = tracked.trailPositions[(i - 1) * 3 + 1];
      tracked.trailPositions[i * 3 + 2] = tracked.trailPositions[(i - 1) * 3 + 2];
    }

    // Set head
    const p = tracked.mesh.position;
    tracked.trailPositions[0] = p.x;
    tracked.trailPositions[1] = p.y;
    tracked.trailPositions[2] = p.z;

    const attr = tracked.trail.geometry.getAttribute('position') as THREE.BufferAttribute;
    attr.needsUpdate = true;

    // Expand draw range as trail grows
    const currentDraw = tracked.trail.geometry.drawRange.count;
    if (currentDraw <= TRAIL_LENGTH) {
      tracked.trail.geometry.setDrawRange(0, currentDraw + 1);
    }
  }

  /**
   * Helper: project position A towards B by a fraction t, but stopping at B
   * Used for smooth interpolation if needed, or hitscan snapping
   */
  private projectTowards(a: Vec3, b: Vec3, maxDist: number): Vec3 {
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const abz = b.z - a.z;
    const dist = Math.sqrt(abx * abx + aby * aby + abz * abz);

    if (dist <= maxDist) return { ...b };

    const t = maxDist / dist;
    return {
      x: a.x + abx * t,
      y: a.y + aby * t,
      z: a.z + abz * t,
    };
  }

  /** Snap point P onto line segment AB */
  private snapToSegment(p: Vec3, a: Vec3, b: Vec3): Vec3 {
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const abz = b.z - a.z;
    const apx = p.x - a.x;
    const apy = p.y - a.y;
    const apz = p.z - a.z;

    const abLenSq = abx * abx + aby * aby + abz * abz;
    if (abLenSq < 1e-8) return { ...a };
    const t = Math.max(0, Math.min(1, (apx * abx + apy * aby + apz * abz) / abLenSq));
    return {
      x: a.x + abx * t,
      y: a.y + aby * t,
      z: a.z + abz * t,
    };
  }

  /** Remove a projectile from the scene and clean up its resources */
  private removeProjectile(id: number, tracked: TrackedProjectile): void {
    const pos = tracked.mesh.position;
    const wx = Math.floor(pos.x);
    const wy = Math.floor(pos.y);
    const wz = Math.floor(pos.z);
    const mat = this.voxelGetter ? this.voxelGetter(wx, wy, wz) : 0;

    if (this.impactSystem) {
      this.impactSystem.spawnImpact({ x: pos.x, y: pos.y, z: pos.z }, tracked.velocity, mat);
    }

    if (this.onImpact) {
      this.onImpact(
        { x: pos.x, y: pos.y, z: pos.z },
        { x: tracked.velocity.x, y: tracked.velocity.y, z: tracked.velocity.z },
      );
    }

    // Spawn impact sparks at the projectile's last position
    if (this.particles) {
      this.particles.emit({
        position: { x: pos.x, y: pos.y + IMPACT_VISUAL_LIFT, z: pos.z },
        count: 28,
        speedMin: 4.2,
        speedMax: 11.8,
        spread: Math.PI,
        lifetimeMin: 0.18,
        lifetimeMax: 0.62,
        sizeMin: 0.16,
        sizeMax: 0.34,
        colors: IMPACT_COLORS,
        gravityScale: 0.5,
      });

      this.particles.emit({
        position: { x: pos.x, y: pos.y + IMPACT_VISUAL_LIFT + 0.05, z: pos.z },
        count: 16,
        speedMin: 5.5,
        speedMax: 14.2,
        spread: Math.PI * 0.95,
        lifetimeMin: 0.08,
        lifetimeMax: 0.24,
        sizeMin: 0.18,
        sizeMax: 0.42,
        colors: IMPACT_FLASH_COLORS,
        gravityScale: 0.2,
      });
    }

    // Play impact sound for all projectiles (server and local predicted)
    {
      let impactSound = SoundId.ImpactDirt;
      if (mat === MAT_METAL) impactSound = SoundId.ImpactMetal;
      else if (mat === MAT_WOOD || mat === MAT_WOOD_DARK) impactSound = SoundId.ImpactWood;
      else if (mat === MAT_CONCRETE || mat === MAT_CONCRETE_DARK || mat === MAT_ROAD) impactSound = SoundId.ImpactConcrete;

      soundManager.play3D(impactSound, { x: pos.x, y: pos.y, z: pos.z }, {
        volume: 0.2 + Math.random() * 0.12,
        pitch: 0.9 + Math.random() * 0.2,
        refDistance: 6,
      });

      if ((impactSound === SoundId.ImpactConcrete || impactSound === SoundId.ImpactMetal) && Math.random() < 0.35) {
        soundManager.play3D(SoundId.Ricochet, { x: pos.x, y: pos.y, z: pos.z }, {
          volume: 0.16 + Math.random() * 0.1,
          pitch: 0.95 + Math.random() * 0.15,
          refDistance: 9,
        });
      }
    }

    this.scene.remove(tracked.mesh);
    // Geometry and material are shared, so don't dispose per-projectile

    // Clean up trail
    this.scene.remove(tracked.trail);
    tracked.trail.geometry.dispose();

    if (tracked.light) {
      this.scene.remove(tracked.light);
      tracked.light.dispose();
      this.activeLightCount--;
    }

    this.projectiles.delete(id);
  }
}
