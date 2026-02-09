import * as THREE from 'three';
import { VOXEL_SIZE } from '@clawfield/shared';

type VoxelGetter = (wx: number, wy: number, wz: number) => number;
type Vec3 = { x: number; y: number; z: number };

export interface DebrisSpawnConfig {
  position: Vec3;
  count: number;
  color: number;       // hex color
  speedMin: number;
  speedMax: number;
  direction?: Vec3;    // null/undefined = spherical
  spread: number;      // cone half-angle in radians
  scaleMin?: number;
  scaleMax?: number;
}

const MAX_DEBRIS = 1500;
const GRAVITY = -20;
const BOUNCE_DAMPING = 0.3;
const FRICTION = 0.6;
const ANGULAR_DAMPING = 0.5;
const SETTLE_SPEED = 0.5;
const SETTLE_BOUNCES = 3;
/** Debris must be airborne for this long before bounces/settling count */
const GRACE_PERIOD = 0.15;

// Rubble: settled debris that stays on the ground as physical evidence
const RUBBLE_CHANCE = 0.6;       // 60% of debris becomes rubble
const RUBBLE_LIFETIME = 30.0;    // rubble persists for 30s
const FADING_LIFETIME = 4.0;     // non-rubble fades after 4s total
const FADE_DURATION = 1.5;       // fade-out takes 1.5s (scale → 0)

interface DebrisState {
  alive: boolean;
  px: number; py: number; pz: number;
  vx: number; vy: number; vz: number;
  rx: number; ry: number; rz: number;
  avx: number; avy: number; avz: number;
  age: number;
  lifetime: number;
  bounceCount: number;
  settled: boolean;
  settledTime: number;
  scale: number;
  baseScale: number;
  // Non-uniform shape multipliers (applied on top of scale)
  shapeX: number; shapeY: number; shapeZ: number;
  isRubble: boolean;   // persistent ground rubble
}

const _euler = new THREE.Euler();
const _quat = new THREE.Quaternion();
const _pos = new THREE.Vector3();
const _scale = new THREE.Vector3();
const _matrix = new THREE.Matrix4();
const _color = new THREE.Color();

export class DebrisSystem {
  private mesh: THREE.InstancedMesh;
  private debris: DebrisState[];
  private getVoxel: VoxelGetter | null = null;
  private activeCount = 0;

  constructor(scene: THREE.Scene) {
    const geometry = new THREE.BoxGeometry(VOXEL_SIZE, VOXEL_SIZE, VOXEL_SIZE);
    const material = new THREE.MeshStandardMaterial({
      roughness: 0.85,
      metalness: 0.0,
    });

    this.mesh = new THREE.InstancedMesh(geometry, material, MAX_DEBRIS);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(
      new Float32Array(MAX_DEBRIS * 3), 3
    );
    this.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;

    scene.add(this.mesh);

    // Initialize pool
    this.debris = [];
    for (let i = 0; i < MAX_DEBRIS; i++) {
      this.debris.push(this.createDeadDebris());
    }
  }

  setVoxelGetter(getter: VoxelGetter): void {
    this.getVoxel = getter;
  }

  private createDeadDebris(): DebrisState {
    return {
      alive: false,
      px: 0, py: 0, pz: 0,
      vx: 0, vy: 0, vz: 0,
      rx: 0, ry: 0, rz: 0,
      avx: 0, avy: 0, avz: 0,
      age: 0,
      lifetime: FADING_LIFETIME,
      bounceCount: 0,
      settled: false,
      settledTime: 0,
      scale: 1,
      baseScale: 1,
      shapeX: 1, shapeY: 1, shapeZ: 1,
      isRubble: false,
    };
  }

  /** Find a free slot. Prefers: dead > oldest settled rubble > oldest anything */
  private findFreeSlot(): number {
    // 1. Dead slot
    for (let i = 0; i < MAX_DEBRIS; i++) {
      if (!this.debris[i].alive) return i;
    }

    // 2. Oldest settled rubble (evict rubble before active physics debris)
    let oldestRubbleIdx = -1;
    let oldestRubbleAge = 0;
    for (let i = 0; i < MAX_DEBRIS; i++) {
      const d = this.debris[i];
      if (d.settled && d.age > oldestRubbleAge) {
        oldestRubbleAge = d.age;
        oldestRubbleIdx = i;
      }
    }
    if (oldestRubbleIdx >= 0) return oldestRubbleIdx;

    // 3. Oldest anything
    let oldestIdx = 0;
    let oldestAge = 0;
    for (let i = 0; i < MAX_DEBRIS; i++) {
      if (this.debris[i].age > oldestAge) {
        oldestAge = this.debris[i].age;
        oldestIdx = i;
      }
    }
    return oldestIdx;
  }

  spawn(config: DebrisSpawnConfig): void {
    const { position, count, color, speedMin, speedMax, direction, spread } = config;
    const scaleMin = config.scaleMin ?? 0.3;
    const scaleMax = config.scaleMax ?? 1.0;

    _color.set(color);

    for (let i = 0; i < count; i++) {
      const idx = this.findFreeSlot();
      const d = this.debris[idx];

      d.alive = true;
      d.px = position.x;
      d.py = position.y;
      d.pz = position.z;

      // Generate velocity direction
      let dx: number, dy: number, dz: number;
      if (direction) {
        // Cone emission around direction
        const theta = Math.random() * spread;
        const phi = Math.random() * Math.PI * 2;
        const dirLen = Math.sqrt(direction.x ** 2 + direction.y ** 2 + direction.z ** 2);
        const ndx = direction.x / dirLen;
        const ndy = direction.y / dirLen;
        const ndz = direction.z / dirLen;
        let ux: number, uy: number, uz: number;
        if (Math.abs(ndy) < 0.9) {
          ux = 0; uy = 1; uz = 0;
        } else {
          ux = 1; uy = 0; uz = 0;
        }
        const tx = ndy * uz - ndz * uy;
        const ty = ndz * ux - ndx * uz;
        const tz = ndx * uy - ndy * ux;
        const tLen = Math.sqrt(tx * tx + ty * ty + tz * tz);
        const ntx = tx / tLen, nty = ty / tLen, ntz = tz / tLen;
        const bx = ndy * ntz - ndz * nty;
        const by = ndz * ntx - ndx * ntz;
        const bz = ndx * nty - ndy * ntx;

        const sinTheta = Math.sin(theta);
        const cosTheta = Math.cos(theta);
        const cosPhi = Math.cos(phi);
        const sinPhi = Math.sin(phi);

        dx = ndx * cosTheta + ntx * sinTheta * cosPhi + bx * sinTheta * sinPhi;
        dy = ndy * cosTheta + nty * sinTheta * cosPhi + by * sinTheta * sinPhi;
        dz = ndz * cosTheta + ntz * sinTheta * cosPhi + bz * sinTheta * sinPhi;
      } else {
        // Spherical emission
        const theta = Math.acos(2 * Math.random() - 1);
        const phi = Math.random() * Math.PI * 2;
        dx = Math.sin(theta) * Math.cos(phi);
        dy = Math.sin(theta) * Math.sin(phi);
        dz = Math.cos(theta);
      }

      const speed = speedMin + Math.random() * (speedMax - speedMin);
      d.vx = dx * speed;
      d.vy = dy * speed;
      d.vz = dz * speed;

      // Random rotation and angular velocity
      d.rx = Math.random() * Math.PI * 2;
      d.ry = Math.random() * Math.PI * 2;
      d.rz = Math.random() * Math.PI * 2;
      d.avx = (Math.random() - 0.5) * 10;
      d.avy = (Math.random() - 0.5) * 10;
      d.avz = (Math.random() - 0.5) * 10;

      d.age = 0;
      d.bounceCount = 0;
      d.settled = false;
      d.settledTime = 0;
      d.baseScale = scaleMin + Math.random() * (scaleMax - scaleMin);
      d.scale = d.baseScale;

      // Randomize shape: cubes, slabs, chips, pillars
      // Pick a shape type for variety
      const shapeRoll = Math.random();
      if (shapeRoll < 0.3) {
        // Cube (roughly uniform)
        d.shapeX = 0.8 + Math.random() * 0.4;
        d.shapeY = 0.8 + Math.random() * 0.4;
        d.shapeZ = 0.8 + Math.random() * 0.4;
      } else if (shapeRoll < 0.55) {
        // Flat slab / chip
        d.shapeX = 0.8 + Math.random() * 0.8;
        d.shapeY = 0.2 + Math.random() * 0.4;
        d.shapeZ = 0.8 + Math.random() * 0.8;
      } else if (shapeRoll < 0.75) {
        // Tall shard / pillar
        d.shapeX = 0.3 + Math.random() * 0.4;
        d.shapeY = 1.0 + Math.random() * 1.0;
        d.shapeZ = 0.3 + Math.random() * 0.4;
      } else {
        // Long plank
        d.shapeX = 1.0 + Math.random() * 1.0;
        d.shapeY = 0.3 + Math.random() * 0.4;
        d.shapeZ = 0.3 + Math.random() * 0.4;
      }

      // Decide if this piece becomes persistent rubble
      d.isRubble = Math.random() < RUBBLE_CHANCE;
      d.lifetime = d.isRubble ? RUBBLE_LIFETIME : FADING_LIFETIME;

      // Set color
      this.mesh.instanceColor!.setXYZ(idx, _color.r, _color.g, _color.b);
    }

    this.mesh.instanceColor!.needsUpdate = true;
  }

  /**
   * Spawn falling debris from individual voxel positions.
   * Every voxel becomes a full-size debris piece that drops under pure gravity —
   * dense cascading rubble like Teardown/BattleBit building collapses.
   */
  spawnFallingDebris(voxels: Vec3[], color: number): void {
    _color.set(color);
    // Spawn one debris per voxel, up to budget
    const count = Math.min(voxels.length, MAX_DEBRIS);

    for (let vi = 0; vi < count; vi++) {
      const v = voxels[vi];
      const idx = this.findFreeSlot();
      const d = this.debris[idx];

      d.alive = true;
      // Voxel world coords map 1:1 to Three.js world coords — no VOXEL_SIZE scaling
      d.px = v.x + 0.5;
      d.py = v.y + 0.5;
      d.pz = v.z + 0.5;

      // Start at rest — pure gravity drop gives the heavy, cascading feel
      d.vx = (Math.random() - 0.5) * 0.5;
      d.vy = 0;
      d.vz = (Math.random() - 0.5) * 0.5;

      // Slow initial tumble (speeds up as gravity pulls them)
      d.rx = Math.random() * Math.PI * 2;
      d.ry = Math.random() * Math.PI * 2;
      d.rz = Math.random() * Math.PI * 2;
      d.avx = (Math.random() - 0.5) * 3;
      d.avy = (Math.random() - 0.5) * 3;
      d.avz = (Math.random() - 0.5) * 3;

      d.age = 0;
      d.bounceCount = 0;
      d.settled = false;
      d.settledTime = 0;
      // Full voxel-sized chunks — these ARE the building pieces
      d.baseScale = 0.85 + Math.random() * 0.3;
      d.scale = d.baseScale;

      // Varied rubble shapes — chunky blocks dominate for that BattleBit look
      const shapeRoll = Math.random();
      if (shapeRoll < 0.5) {
        // Chunky block (dominant — gives dense rubble pile look)
        d.shapeX = 0.8 + Math.random() * 0.4;
        d.shapeY = 0.8 + Math.random() * 0.4;
        d.shapeZ = 0.8 + Math.random() * 0.4;
      } else if (shapeRoll < 0.75) {
        // Flat slab (broken floor/wall)
        d.shapeX = 0.8 + Math.random() * 0.8;
        d.shapeY = 0.3 + Math.random() * 0.3;
        d.shapeZ = 0.8 + Math.random() * 0.8;
      } else {
        // Long beam / pillar fragment
        d.shapeX = 0.4 + Math.random() * 0.3;
        d.shapeY = 1.0 + Math.random() * 1.0;
        d.shapeZ = 0.4 + Math.random() * 0.3;
      }

      // Most falling debris becomes persistent rubble on the ground
      d.isRubble = Math.random() < 0.85;
      d.lifetime = d.isRubble ? RUBBLE_LIFETIME : FADING_LIFETIME;

      this.mesh.instanceColor!.setXYZ(idx, _color.r, _color.g, _color.b);
    }

    this.mesh.instanceColor!.needsUpdate = true;
  }

  /** Convenience: spawn debris from a destruction event, scaled by radius */
  spawnFromDestruction(
    position: Vec3,
    kind: 'bullet' | 'explosion' | 'crumble' | 'collapse',
    materialColor: number,
    radius: number,
    voxels?: Vec3[],
  ): void {
    // For collapse/crumble with voxel positions: use falling debris
    if (voxels && voxels.length > 0 && (kind === 'collapse' || kind === 'crumble')) {
      this.spawnFallingDebris(voxels, materialColor);
      return;
    }

    // Scale factor: radius=1 is baseline, radius=4 (grenade) is 4x
    const r = Math.max(1, radius);

    switch (kind) {
      case 'bullet':
        this.spawn({
          position,
          count: 6,
          color: materialColor,
          speedMin: 2,
          speedMax: 6,
          direction: { x: 0, y: 1, z: 0 },
          spread: Math.PI * 0.5,
          scaleMin: 0.3,
          scaleMax: 0.6,
        });
        break;

      case 'explosion': {
        // Scale dramatically with blast radius
        const count = Math.min(120, Math.round(20 * r));
        this.spawn({
          position,
          count,
          color: materialColor,
          speedMin: 3 + r,
          speedMax: 8 + r * 3,
          spread: Math.PI * 2,
          scaleMin: 0.3,
          scaleMax: 0.6 + r * 0.2,
        });
        break;
      }

      case 'crumble': {
        const count = Math.min(60, Math.round(10 * r));
        this.spawn({
          position,
          count,
          color: materialColor,
          speedMin: 1,
          speedMax: 3 + r * 2,
          direction: { x: 0, y: -1, z: 0 },
          spread: Math.PI * 0.5,
          scaleMin: 0.4,
          scaleMax: 0.6 + r * 0.15,
        });
        break;
      }

      case 'collapse': {
        // Collapse = whole structure, go big
        const count = Math.min(150, Math.round(30 * r));
        this.spawn({
          position,
          count,
          color: materialColor,
          speedMin: 1 + r,
          speedMax: 5 + r * 3,
          spread: Math.PI * 2,
          scaleMin: 0.4,
          scaleMax: 0.7 + r * 0.2,
        });
        break;
      }
    }
  }

  update(dt: number): void {
    // Cap dt to avoid physics explosion on tab-back
    const clampedDt = Math.min(dt, 0.05);
    let maxAlive = 0;

    for (let i = 0; i < MAX_DEBRIS; i++) {
      const d = this.debris[i];
      if (!d.alive) continue;

      d.age += clampedDt;

      // Kill after max lifetime
      if (d.age >= d.lifetime) {
        d.alive = false;
        _matrix.makeScale(0, 0, 0);
        this.mesh.setMatrixAt(i, _matrix);
        continue;
      }

      if (!d.settled) {
        // Apply gravity
        d.vy += GRAVITY * clampedDt;

        // Candidate position
        const nx = d.px + d.vx * clampedDt;
        const ny = d.py + d.vy * clampedDt;
        const nz = d.pz + d.vz * clampedDt;

        // During grace period, skip collision — let debris fly out of spawn voxel
        const pastGrace = d.age > GRACE_PERIOD;
        let bouncedThisFrame = false;

        // Voxel collision (per-axis)
        if (this.getVoxel && pastGrace) {
          // Y axis (ground/ceiling)
          if (this.getVoxel(Math.floor(d.px), Math.floor(ny), Math.floor(d.pz)) !== 0) {
            d.vy = -d.vy * BOUNCE_DAMPING;
            d.vx *= FRICTION;
            d.vz *= FRICTION;
            d.avx *= ANGULAR_DAMPING;
            d.avy *= ANGULAR_DAMPING;
            d.avz *= ANGULAR_DAMPING;
            bouncedThisFrame = true;
          } else {
            d.py = ny;
          }

          // X axis (walls)
          if (this.getVoxel(Math.floor(nx), Math.floor(d.py), Math.floor(d.pz)) !== 0) {
            d.vx = -d.vx * BOUNCE_DAMPING;
            d.avx *= ANGULAR_DAMPING;
            bouncedThisFrame = true;
          } else {
            d.px = nx;
          }

          // Z axis (walls)
          if (this.getVoxel(Math.floor(d.px), Math.floor(d.py), Math.floor(nz)) !== 0) {
            d.vz = -d.vz * BOUNCE_DAMPING;
            d.avz *= ANGULAR_DAMPING;
            bouncedThisFrame = true;
          } else {
            d.pz = nz;
          }

          // Count at most one bounce per frame
          if (bouncedThisFrame) d.bounceCount++;
        } else {
          // No voxel getter or still in grace period — move freely (ground plane fallback)
          d.px = nx;
          d.pz = nz;
          if (pastGrace && ny < 0) {
            d.py = 0;
            d.vy = -d.vy * BOUNCE_DAMPING;
            d.vx *= FRICTION;
            d.vz *= FRICTION;
            d.bounceCount++;
          } else {
            d.py = ny;
          }
        }

        // Update rotation
        d.rx += d.avx * clampedDt;
        d.ry += d.avy * clampedDt;
        d.rz += d.avz * clampedDt;

        // Settle check (only after grace period)
        if (pastGrace) {
          const speed = Math.sqrt(d.vx * d.vx + d.vy * d.vy + d.vz * d.vz);
          if (d.bounceCount >= SETTLE_BOUNCES || speed < SETTLE_SPEED) {
            d.settled = true;
            d.settledTime = d.age;
            d.vx = d.vy = d.vz = 0;
            d.avx = d.avy = d.avz = 0;
          }
        }
      } else {
        // Settled — rubble stays at full scale, non-rubble fades out
        if (d.isRubble) {
          // Rubble: stay at full scale, only fade in the last FADE_DURATION of lifetime
          const timeLeft = d.lifetime - d.age;
          if (timeLeft < FADE_DURATION) {
            d.scale = d.baseScale * (timeLeft / FADE_DURATION);
          }
          // Otherwise keep d.scale = d.baseScale (no change needed, set at settle)
        } else {
          // Non-rubble: fade out via scale after settling
          const fadeElapsed = d.age - d.settledTime;
          if (fadeElapsed > FADE_DURATION) {
            d.alive = false;
            _matrix.makeScale(0, 0, 0);
            this.mesh.setMatrixAt(i, _matrix);
            continue;
          }
          d.scale = d.baseScale * (1 - fadeElapsed / FADE_DURATION);
        }
      }

      // Build instance matrix with non-uniform shape
      _pos.set(d.px, d.py, d.pz);
      _euler.set(d.rx, d.ry, d.rz);
      _quat.setFromEuler(_euler);
      _scale.set(d.scale * d.shapeX, d.scale * d.shapeY, d.scale * d.shapeZ);
      _matrix.compose(_pos, _quat, _scale);
      this.mesh.setMatrixAt(i, _matrix);

      if (i >= maxAlive) maxAlive = i + 1;
    }

    this.mesh.count = maxAlive;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.activeCount = maxAlive;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.mesh.parent?.remove(this.mesh);
  }
}
