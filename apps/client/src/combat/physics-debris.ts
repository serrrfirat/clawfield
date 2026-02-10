/**
 * physics-debris.ts
 *
 * Rapier-powered physics debris system for destruction.
 * Voxels get clustered into varied-size chunks (1x1, 2x2, 3x3)
 * that tumble, collide with terrain, and pile up as rubble.
 */
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';

type Vec3 = { x: number; y: number; z: number };
type VoxelGetter = (wx: number, wy: number, wz: number) => number;

const _matrix = new THREE.Matrix4();
const _pos = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _scaleVec = new THREE.Vector3();
const _color = new THREE.Color();

/** Max physics bodies across all active collapses */
const MAX_PHYSICS_BODIES = 2000;

/** Max lifetime before forced cleanup */
const MAX_LIFETIME = 15.0;

/** Voxel half-extent — voxels occupy 1x1x1 in world coords */
const HALF_EXTENT = 0.5;

interface PhysicsDebris {
  body: RAPIER.RigidBody;
  meshIndex: number;
  color: number;
  material: number; // voxel palette index for placing back into grid
  scale: number;  // 1, 2, or 3 — size of this chunk in voxels
  sleepTimer: number;
  age: number;
  settled: boolean;
}

interface CollapseGroup {
  debris: PhysicsDebris[];
  startTime: number;
}

export class PhysicsDebrisSystem {
  private scene: THREE.Scene;
  private world: RAPIER.World | null = null;
  private ready = false;
  private initPromise: Promise<void>;

  // Instanced mesh for rendering all physics debris
  private mesh!: THREE.InstancedMesh;
  private maxInstances = MAX_PHYSICS_BODIES;

  // Active collapse groups
  private groups: CollapseGroup[] = [];
  private totalBodies = 0;

  // Voxel getter for terrain collision generation
  private getVoxel: VoxelGetter | null = null;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.initPromise = this.init();
  }

  private async init(): Promise<void> {
    await RAPIER.init();

    // Create physics world with heavy gravity — rubble should feel weighty
    this.world = new RAPIER.World({ x: 0, y: -25, z: 0 });

    // Create instanced mesh for rendering — unit cube, scaled per-instance
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0.0 });
    this.mesh = new THREE.InstancedMesh(geo, mat, this.maxInstances);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(
      new Float32Array(this.maxInstances * 3), 3,
    );
    this.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.scene.add(this.mesh);

    this.ready = true;
  }

  setVoxelGetter(getter: VoxelGetter): void {
    this.getVoxel = getter;
  }

  /**
   * Spawn physics debris from any destruction event.
   * For explosions/collapses, voxels are clustered into varied-size chunks.
   * For bullets, each voxel is a single piece.
   */
  spawn(
    kind: 'bullet' | 'explosion' | 'crumble' | 'collapse',
    voxels: Vec3[],
    colors: number[],
    impactDir: Vec3,
    impactPos?: Vec3,
    materials?: number[],
  ): void {
    if (!this.ready || !this.world) return;

    // Budget: limit total bodies
    const budget = MAX_PHYSICS_BODIES - this.totalBodies;
    if (budget <= 0) return;

    const group: CollapseGroup = {
      debris: [],
      startTime: performance.now() / 1000,
    };

    // Compute centroid
    let cx = 0, cy = 0, cz = 0;
    for (const v of voxels) {
      cx += v.x; cy += v.y; cz += v.z;
    }
    cx /= voxels.length;
    cy /= voxels.length;
    cz /= voxels.length;

    const center = impactPos ?? { x: cx, y: cy, z: cz };

    // Normalize impact direction
    const idLen = Math.sqrt(impactDir.x ** 2 + impactDir.y ** 2 + impactDir.z ** 2);
    const normImpact = idLen > 0.01
      ? { x: impactDir.x / idLen, y: impactDir.y / idLen, z: impactDir.z / idLen }
      : { x: 0, y: 0, z: 0 };

    // Default material index for rubble (concrete-like)
    const defaultMat = 8;

    // Cluster voxels into varied-size chunks for explosions/collapses
    const chunks = (kind === 'explosion' || kind === 'collapse' || kind === 'crumble')
      ? this.clusterVoxels(voxels, colors, materials)
      : voxels.map((v, i) => ({ pos: v, color: colors[i] ?? 0x888888, mat: materials?.[i] ?? defaultMat, scale: 1 }));

    // Limit to budget
    const toSpawn = chunks.length > budget ? chunks.slice(0, budget) : chunks;

    for (const chunk of toSpawn) {
      const { pos, color, mat: chunkMat, scale } = chunk;
      const halfSize = scale * HALF_EXTENT;

      // Create dynamic rigid body at chunk center
      const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(
          pos.x + halfSize,
          pos.y + halfSize,
          pos.z + halfSize,
        )
        .setLinearDamping(0.4)
        .setAngularDamping(0.5);
      const body = this.world!.createRigidBody(bodyDesc);

      // Box collider sized to the chunk
      const colliderDesc = RAPIER.ColliderDesc.cuboid(halfSize, halfSize, halfSize)
        .setRestitution(0.05)
        .setFriction(0.9)
        .setDensity(2.5);
      this.world!.createCollider(colliderDesc, body);

      // --- Impulse profiles ---
      let impulse = { x: 0, y: 0, z: 0 };
      let torque = { x: 0, y: 0, z: 0 };
      // Scale impulse by mass (bigger chunks need more force)
      const massScale = scale * scale * scale;

      if (kind === 'bullet') {
        const speed = 0.8 + Math.random() * 1.5;
        impulse = {
          x: normImpact.x * speed + (Math.random() - 0.5) * 0.5,
          y: 0.5 + Math.random() * 0.8,
          z: normImpact.z * speed + (Math.random() - 0.5) * 0.5,
        };
        torque = {
          x: (Math.random() - 0.5) * 0.5,
          y: (Math.random() - 0.5) * 0.5,
          z: (Math.random() - 0.5) * 0.5,
        };
      } else if (kind === 'explosion') {
        // Outward blast — chunks scatter from crater with real force
        const dx = pos.x - center.x;
        const dy = pos.y - center.y;
        const dz = pos.z - center.z;
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
        // Closer chunks get MORE force (inverse distance falloff)
        const distFactor = Math.max(0.3, 1.0 - dist / 12);
        // Base speed: strong enough to throw chunks 5-15 voxels
        // Mass of scale=1 body ≈ 2.5kg, gravity=25, need impulse ≈ mass*velocity
        const mass = 2.5 * massScale; // approximate body mass
        const outSpeed = (8 + Math.random() * 12) * mass * distFactor;
        const upSpeed = (6 + Math.random() * 10) * mass * distFactor;
        impulse = {
          x: (dx / dist) * outSpeed + (Math.random() - 0.5) * 3.0 * mass,
          y: Math.abs(dy / dist) * upSpeed * 0.5 + upSpeed,
          z: (dz / dist) * outSpeed + (Math.random() - 0.5) * 3.0 * mass,
        };
        torque = {
          x: (Math.random() - 0.5) * 4.0 * mass,
          y: (Math.random() - 0.5) * 4.0 * mass,
          z: (Math.random() - 0.5) * 4.0 * mass,
        };
      } else {
        // Collapse/crumble: almost pure gravity, tiny scatter
        const distFromCenter = Math.sqrt((pos.x - cx) ** 2 + (pos.z - cz) ** 2);
        const tiltFactor = Math.min(distFromCenter / 10, 1) * 0.3;
        const strength = (0.2 + Math.random() * 0.5) * massScale;
        impulse = {
          x: normImpact.x * strength * tiltFactor + (Math.random() - 0.5) * 0.15,
          y: (Math.random() - 0.5) * 0.1 * massScale,
          z: normImpact.z * strength * tiltFactor + (Math.random() - 0.5) * 0.15,
        };
        torque = {
          x: (Math.random() - 0.5) * 0.3 * massScale,
          y: (Math.random() - 0.5) * 0.3 * massScale,
          z: (Math.random() - 0.5) * 0.3 * massScale,
        };
      }

      body.applyImpulse(impulse, true);
      body.applyTorqueImpulse(torque, true);

      // Allocate mesh instance
      const meshIndex = this.allocateMeshSlot();
      if (meshIndex < 0) break;

      _color.set(color);
      this.mesh.instanceColor!.setXYZ(meshIndex, _color.r, _color.g, _color.b);

      group.debris.push({
        body,
        meshIndex,
        color,
        material: chunkMat,
        scale,
        sleepTimer: 0,
        age: 0,
        settled: false,
      });
    }

    this.mesh.instanceColor!.needsUpdate = true;
    this.totalBodies += group.debris.length;
    this.groups.push(group);
  }

  /**
   * Cluster voxels into varied-size chunks.
   * Produces a mix of 3x3x3, 2x2x2, and 1x1x1 pieces for visual variety.
   */
  private clusterVoxels(
    voxels: Vec3[],
    colors: number[],
    materials?: number[],
  ): Array<{ pos: Vec3; color: number; mat: number; scale: number }> {
    const defaultMat = 8;
    const result: Array<{ pos: Vec3; color: number; mat: number; scale: number }> = [];
    const used = new Set<string>();
    const voxelMap = new Map<string, number>(); // key -> index

    for (let i = 0; i < voxels.length; i++) {
      const v = voxels[i];
      voxelMap.set(`${v.x},${v.y},${v.z}`, i);
    }

    // Shuffle order so clusters form randomly
    const indices = Array.from({ length: voxels.length }, (_, i) => i);
    for (let i = indices.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [indices[i], indices[j]] = [indices[j], indices[i]];
    }

    for (const idx of indices) {
      const v = voxels[idx];
      const key = `${v.x},${v.y},${v.z}`;
      if (used.has(key)) continue;

      // Try to form a 3x3x3 cluster (5% chance — rare big chunks)
      if (Math.random() < 0.05) {
        const cluster = this.tryCluster(v, 3, voxelMap, used);
        if (cluster) {
          used.add(key);
          for (const ck of cluster.keys) used.add(ck);
          result.push({ pos: { x: v.x, y: v.y, z: v.z }, color: colors[idx] ?? 0x888888, mat: materials?.[idx] ?? defaultMat, scale: 3 });
          continue;
        }
      }

      // Try to form a 2x2x2 cluster (20% chance — some medium chunks)
      if (Math.random() < 0.2) {
        const cluster = this.tryCluster(v, 2, voxelMap, used);
        if (cluster) {
          used.add(key);
          for (const ck of cluster.keys) used.add(ck);
          result.push({ pos: { x: v.x, y: v.y, z: v.z }, color: colors[idx] ?? 0x888888, mat: materials?.[idx] ?? defaultMat, scale: 2 });
          continue;
        }
      }

      // Single voxel
      used.add(key);
      result.push({ pos: v, color: colors[idx] ?? 0x888888, mat: materials?.[idx] ?? defaultMat, scale: 1 });
    }

    return result;
  }

  /** Try to form an NxNxN cluster starting from pos. Returns consumed keys or null. */
  private tryCluster(
    pos: Vec3,
    size: number,
    voxelMap: Map<string, number>,
    used: Set<string>,
  ): { keys: string[] } | null {
    const keys: string[] = [];
    for (let dx = 0; dx < size; dx++) {
      for (let dy = 0; dy < size; dy++) {
        for (let dz = 0; dz < size; dz++) {
          if (dx === 0 && dy === 0 && dz === 0) continue; // origin already handled
          const k = `${pos.x + dx},${pos.y + dy},${pos.z + dz}`;
          if (used.has(k) || !voxelMap.has(k)) return null;
          keys.push(k);
        }
      }
    }
    return { keys };
  }

  private allocateMeshSlot(): number {
    if (this.mesh.count >= this.maxInstances) return -1;
    return this.mesh.count++;
  }

  update(dt: number): void {
    if (!this.ready || !this.world || this.groups.length === 0) return;

    // Cap dt to avoid physics explosion
    const clampedDt = Math.min(dt, 0.05);

    // Step physics
    this.world.step();

    // Update each group
    let needsCompact = false;
    const now = performance.now() / 1000;

    for (let gi = this.groups.length - 1; gi >= 0; gi--) {
      const group = this.groups[gi];
      const groupAge = now - group.startTime;

      for (const d of group.debris) {
        if (d.settled) continue; // resting on surface, frozen as Fixed body

        d.age += clampedDt;

        // Read physics body position/rotation
        const pos = d.body.translation();
        const rot = d.body.rotation();

        // --- Voxel-grid ground collision ---
        if (this.getVoxel) {
          const halfSize = d.scale * HALF_EXTENT;
          const bx = Math.floor(pos.x);
          const by = Math.floor(pos.y - halfSize);
          const bz = Math.floor(pos.z);
          if (by < -64 || this.getVoxel(bx, by, bz) !== 0) {
            d.settled = true;

            // Snap to rest on top of the surface
            const landY = by + 1 + halfSize;
            d.body.setTranslation({ x: pos.x, y: landY, z: pos.z }, true);
            d.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
            d.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
            d.body.setBodyType(RAPIER.RigidBodyType.Fixed, true);

            // Update mesh at final resting position
            const fpos = d.body.translation();
            _pos.set(fpos.x, fpos.y, fpos.z);
            _quat.set(rot.x, rot.y, rot.z, rot.w);
            _scaleVec.set(d.scale, d.scale, d.scale);
            _matrix.compose(_pos, _quat, _scaleVec);
            this.mesh.setMatrixAt(d.meshIndex, _matrix);
            continue;
          }
        }

        // Update mesh instance for in-flight debris
        _pos.set(pos.x, pos.y, pos.z);
        _quat.set(rot.x, rot.y, rot.z, rot.w);
        _scaleVec.set(d.scale, d.scale, d.scale);
        _matrix.compose(_pos, _quat, _scaleVec);
        this.mesh.setMatrixAt(d.meshIndex, _matrix);
      }

      // Remove group after all debris settled + a brief linger, or on timeout
      const allSettled = group.debris.every(d => d.settled);
      const SETTLED_LINGER = 3.0; // seconds to keep settled debris visible
      const settledLongEnough = allSettled && groupAge > SETTLED_LINGER;
      if (settledLongEnough || groupAge > MAX_LIFETIME) {
        this.cleanupGroup(group);
        this.groups.splice(gi, 1);
        needsCompact = true;
      }
    }

    if (needsCompact) {
      this.compactMesh();
    }

    this.mesh.instanceMatrix.needsUpdate = true;
  }

  private cleanupGroup(group: CollapseGroup): void {
    if (!this.world) return;

    for (const d of group.debris) {
      this.world.removeRigidBody(d.body);
    }
    this.totalBodies -= group.debris.length;
  }

  /**
   * After removing groups, compact the mesh by reassigning indices.
   */
  private compactMesh(): void {
    let nextSlot = 0;
    for (const group of this.groups) {
      for (const d of group.debris) {
        d.meshIndex = nextSlot;
        _color.set(d.color);
        this.mesh.instanceColor!.setXYZ(nextSlot, _color.r, _color.g, _color.b);

        const pos = d.body.translation();
        const rot = d.body.rotation();
        _pos.set(pos.x, pos.y, pos.z);
        _quat.set(rot.x, rot.y, rot.z, rot.w);
        _scaleVec.set(d.scale, d.scale, d.scale);
        _matrix.compose(_pos, _quat, _scaleVec);
        this.mesh.setMatrixAt(nextSlot, _matrix);

        nextSlot++;
      }
    }
    this.mesh.count = nextSlot;
    this.mesh.instanceColor!.needsUpdate = true;
  }

  dispose(): void {
    if (this.world) {
      for (const group of this.groups) {
        this.cleanupGroup(group);
      }
      this.groups.length = 0;
      this.world.free();
      this.world = null;
    }
    if (this.mesh) {
      this.mesh.geometry.dispose();
      (this.mesh.material as THREE.Material).dispose();
      this.mesh.parent?.remove(this.mesh);
    }
  }
}
