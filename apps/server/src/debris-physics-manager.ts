import RAPIER from '@dimforge/rapier3d-compat';
import { MAT_AIR, type Vec3 } from '@clawfield/shared';

export interface DebrisBody {
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  id: number;
  scale: number;
  material: number;
  color: number;
  settled: boolean;
  age: number;
}

export interface DebrisState {
  id: number;
  position: Vec3;
  rotation: { x: number; y: number; z: number; w: number };
  scale: number;
  color: number;
  material: number;
  settled: boolean;
}

// Track if Rapier is initialized
let rapierInitialized = false;

/**
 * Initialize Rapier WASM. Must be called before creating any DebrisPhysicsManager.
 */
export async function initRapier(): Promise<void> {
  if (rapierInitialized) return;
  try {
    await RAPIER.init();
    rapierInitialized = true;
    console.log('[DebrisPhysics] Rapier WASM initialized successfully');
  } catch (e) {
    console.error('[DebrisPhysics] Failed to initialize Rapier WASM:', e);
    throw e;
  }
}

/**
 * Server-side debris physics manager.
 * Creates Rapier rigid bodies for debris and handles player-debris collision.
 */
export class DebrisPhysicsManager {
  private world: RAPIER.World | null = null;
  private bodies = new Map<number, DebrisBody>();
  private nextId = 1;
  private initialized = false;
  private disposed = false;
  private getVoxel: (x: number, y: number, z: number) => number;
  
  // Constants
  private static readonly GRAVITY = { x: 0, y: -25, z: 0 };
  private static readonly MAX_BODIES = 1000;
  private static readonly SETTLE_THRESHOLD = 0.1; // velocity threshold for settling
  private static readonly MAX_AGE_MOVING = 45; // seconds before cleanup (moving)
  private static readonly MAX_AGE_SETTLED = 240; // seconds before cleanup (settled)
  private static readonly RUBBLE_DENSITY = 2.5;
  
  constructor(getVoxel: (x: number, y: number, z: number) => number) {
    if (!rapierInitialized) {
      throw new Error('Rapier not initialized. Call initRapier() first.');
    }
    this.getVoxel = getVoxel;
    this.world = new RAPIER.World(DebrisPhysicsManager.GRAVITY);
    this.initialized = true;
    console.log('[DebrisPhysics] Physics world created');
  }
  
  /**
   * Check if the physics manager is ready.
   */
  isReady(): boolean {
    return this.initialized && !this.disposed && this.world !== null;
  }
  
  /**
   * Spawn debris bodies from destroyed voxels.
   * Voxels are clustered into chunks of varying sizes for performance.
   */
  spawnDebris(
    voxels: Vec3[],
    colors: number[],
    materials: number[],
    impactPos: Vec3,
    impactDir: Vec3
  ): number[] {
    if (!this.world || this.disposed) return [];

    const spawnedIds: number[] = [];
    
    // Clean up old bodies if we're at capacity
    if (this.bodies.size >= DebrisPhysicsManager.MAX_BODIES) {
      this.cleanupOldestBodies(10);
    }
    
    // Cluster voxels into chunks
    const chunks = this.clusterVoxels(voxels, colors, materials);
    
    for (const chunk of chunks) {
      const id = this.nextId++;
      const halfSize = chunk.scale * 0.5;
      
      // Create dynamic rigid body at chunk center
      const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(
          chunk.pos.x + halfSize,
          chunk.pos.y + halfSize,
          chunk.pos.z + halfSize
        )
        .setLinearDamping(0.4)
        .setAngularDamping(0.5);
      
      const body = this.world!.createRigidBody(bodyDesc);
      
      // Box collider sized to the chunk
      const colliderDesc = RAPIER.ColliderDesc.cuboid(halfSize, halfSize, halfSize)
        .setRestitution(0.1)
        .setFriction(0.8)
        .setDensity(DebrisPhysicsManager.RUBBLE_DENSITY);
      
      const collider = this.world!.createCollider(colliderDesc, body);
      
      // Apply explosion impulse
      const mass = DebrisPhysicsManager.RUBBLE_DENSITY * Math.pow(chunk.scale, 3);
      const dx = chunk.pos.x - impactPos.x;
      const dy = chunk.pos.y - impactPos.y;
      const dz = chunk.pos.z - impactPos.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
      
      // Inverse distance falloff
      const distFactor = Math.max(0.2, 1.0 - dist / 15);
      const outSpeed = (6 + Math.random() * 8) * mass * distFactor;
      const upSpeed = (4 + Math.random() * 6) * mass * distFactor;
      
      const impulse = {
        x: (dx / dist) * outSpeed + (Math.random() - 0.5) * 2 * mass,
        y: Math.abs(dy / dist) * upSpeed * 0.5 + upSpeed,
        z: (dz / dist) * outSpeed + (Math.random() - 0.5) * 2 * mass,
      };
      
      const torque = {
        x: (Math.random() - 0.5) * 3 * mass,
        y: (Math.random() - 0.5) * 3 * mass,
        z: (Math.random() - 0.5) * 3 * mass,
      };
      
      body.applyImpulse(impulse, true);
      body.applyTorqueImpulse(torque, true);
      
      this.bodies.set(id, {
        body,
        collider,
        id,
        scale: chunk.scale,
        material: chunk.mat,
        color: chunk.color,
        settled: false,
        age: 0,
      });
      
      spawnedIds.push(id);
    }
    
    return spawnedIds;
  }
  
  /**
   * Check if a player AABB collides with any debris.
   * Returns the collision normal and penetration depth if collision occurs.
   */
  checkPlayerCollision(
    playerPos: Vec3,
    playerRadius: number,
    playerHeight: number
  ): { collision: boolean; normal?: Vec3; penetration?: number } {
    if (!this.world || this.disposed) return { collision: false };

    // Iterate all debris AABBs (fast enough for current body budget)
    for (const debris of this.bodies.values()) {
      const debrisPos = debris.body.translation();
      const halfSize = debris.scale * 0.5;

      // Player AABB center approximation
      const playerCenterY = playerPos.y + playerHeight * 0.5;
      const dx = playerPos.x - debrisPos.x;
      const dy = playerCenterY - debrisPos.y;
      const dz = playerPos.z - debrisPos.z;

      const overlapX = playerRadius + halfSize - Math.abs(dx);
      const overlapY = playerHeight * 0.5 + halfSize - Math.abs(dy);
      const overlapZ = playerRadius + halfSize - Math.abs(dz);

      if (overlapX > 0 && overlapY > 0 && overlapZ > 0) {
        // Resolve along minimum penetration axis
        if (overlapX <= overlapY && overlapX <= overlapZ) {
          return {
            collision: true,
            normal: { x: dx >= 0 ? 1 : -1, y: 0, z: 0 },
            penetration: overlapX,
          };
        }
        if (overlapZ <= overlapX && overlapZ <= overlapY) {
          return {
            collision: true,
            normal: { x: 0, y: 0, z: dz >= 0 ? 1 : -1 },
            penetration: overlapZ,
          };
        }
        return {
          collision: true,
          normal: { x: 0, y: dy >= 0 ? 1 : -1, z: 0 },
          penetration: overlapY,
        };
      }
    }
    
    return { collision: false };
  }
  
  /**
   * Update all debris bodies - step physics and check for settled bodies.
   */
  update(dt: number): DebrisState[] {
    if (!this.world || this.disposed) return [];
    
    // Step the physics world
    this.world.timestep = Math.min(dt, 0.05);
    try {
      this.world.step();
    } catch (error) {
      // Mark manager unusable so callers can switch to fallback behavior.
      this.dispose();
      throw error;
    }
    
    const states: DebrisState[] = [];
    
    for (const debris of this.bodies.values()) {
      debris.age += dt;
      
      const pos = debris.body.translation();
      const rot = debris.body.rotation();
      const vel = debris.body.linvel();
      const speed = Math.sqrt(vel.x ** 2 + vel.y ** 2 + vel.z ** 2);

      // Simple terrain collision against voxel world (Rapier world has no terrain colliders)
      const halfSize = debris.scale * 0.5;
      const sampleX = Math.floor(pos.x);
      const sampleY = Math.floor(pos.y - halfSize - 0.05);
      const sampleZ = Math.floor(pos.z);
      const below = this.getVoxel(sampleX, sampleY, sampleZ);
      if (below !== MAT_AIR && vel.y <= 0) {
        const targetY = sampleY + 1 + halfSize;
        debris.body.setTranslation({ x: pos.x, y: targetY, z: pos.z }, true);
        debris.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
        debris.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      }
      
      // Check if body should settle
      if (!debris.settled && speed < DebrisPhysicsManager.SETTLE_THRESHOLD) {
        debris.settled = true;
        // Convert to fixed body for performance
        debris.body.setBodyType(RAPIER.RigidBodyType.Fixed, true);
      }
      
      states.push({
        id: debris.id,
        position: { x: pos.x, y: pos.y, z: pos.z },
        rotation: { x: rot.x, y: rot.y, z: rot.z, w: rot.w },
        scale: debris.scale,
        color: debris.color,
        material: debris.material,
        settled: debris.settled,
      });
    }
    
    // Cleanup old bodies
    this.cleanupOldBodies();
    
    return states;
  }
  
  /**
   * Get all current debris states for network sync.
   */
  getAllStates(): DebrisState[] {
    return Array.from(this.bodies.values()).map(debris => {
      const pos = debris.body.translation();
      const rot = debris.body.rotation();
      return {
        id: debris.id,
        position: { x: pos.x, y: pos.y, z: pos.z },
        rotation: { x: rot.x, y: rot.y, z: rot.z, w: rot.w },
        scale: debris.scale,
        color: debris.color,
        material: debris.material,
        settled: debris.settled,
      };
    });
  }
  
  /**
   * Remove a specific debris body by ID.
   */
  removeDebris(id: number): void {
    if (!this.world || this.disposed) return;
    const debris = this.bodies.get(id);
    if (debris) {
      try {
        this.world.removeRigidBody(debris.body);
      } catch {
        // Ignore stale-handle removals during recovery.
      }
      this.bodies.delete(id);
    }
  }
  
  /**
   * Clean up bodies that have exceeded max age.
   */
  private cleanupOldBodies(): void {
    const toRemove: number[] = [];
    
    for (const [id, debris] of this.bodies) {
      const maxAge = debris.settled
        ? DebrisPhysicsManager.MAX_AGE_SETTLED
        : DebrisPhysicsManager.MAX_AGE_MOVING;
      if (debris.age > maxAge) {
        toRemove.push(id);
      }
    }
    
    for (const id of toRemove) {
      this.removeDebris(id);
    }
  }
  
  /**
   * Remove oldest N bodies when at capacity.
   */
  private cleanupOldestBodies(count: number): void {
    const sorted = Array.from(this.bodies.entries())
      .sort((a, b) => a[1].age - b[1].age)
      .slice(0, count);
    
    for (const [id] of sorted) {
      this.removeDebris(id);
    }
  }
  
  /**
   * Cluster voxels into varied-size chunks for physics efficiency.
   */
  private clusterVoxels(
    voxels: Vec3[],
    colors: number[],
    materials: number[]
  ): Array<{ pos: Vec3; color: number; mat: number; scale: number }> {
    const result: Array<{ pos: Vec3; color: number; mat: number; scale: number }> = [];
    const used = new Set<string>();
    const voxelMap = new Map<string, number>();
    
    for (let i = 0; i < voxels.length; i++) {
      const v = voxels[i];
      voxelMap.set(`${v.x},${v.y},${v.z}`, i);
    }
    
    // Shuffle order for random clustering
    const indices = Array.from({ length: voxels.length }, (_, i) => i);
    for (let i = indices.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [indices[i], indices[j]] = [indices[j], indices[i]];
    }
    
    for (const idx of indices) {
      const v = voxels[idx];
      const key = `${v.x},${v.y},${v.z}`;
      if (used.has(key)) continue;
      
      // Try to form clusters (rare 3x3, some 2x2, mostly 1x1)
      let scale = 1;
      
      // 5% chance for 3x3 cluster
      if (Math.random() < 0.05) {
        if (this.canFormCluster(v, 3, voxelMap, used)) {
          scale = 3;
          this.markClusterUsed(v, 3, used);
        }
      }
      // 20% chance for 2x2 cluster
      else if (Math.random() < 0.20) {
        if (this.canFormCluster(v, 2, voxelMap, used)) {
          scale = 2;
          this.markClusterUsed(v, 2, used);
        }
      }
      
      used.add(key);
      result.push({
        pos: v,
        color: colors[idx] ?? 0x888888,
        mat: materials[idx] ?? 8,
        scale,
      });
    }
    
    return result;
  }
  
  private canFormCluster(
    pos: Vec3,
    size: number,
    voxelMap: Map<string, number>,
    used: Set<string>
  ): boolean {
    for (let dx = 0; dx < size; dx++) {
      for (let dy = 0; dy < size; dy++) {
        for (let dz = 0; dz < size; dz++) {
          const key = `${pos.x + dx},${pos.y + dy},${pos.z + dz}`;
          if (used.has(key) || !voxelMap.has(key)) {
            return false;
          }
        }
      }
    }
    return true;
  }
  
  private markClusterUsed(pos: Vec3, size: number, used: Set<string>): void {
    for (let dx = 0; dx < size; dx++) {
      for (let dy = 0; dy < size; dy++) {
        for (let dz = 0; dz < size; dz++) {
          used.add(`${pos.x + dx},${pos.y + dy},${pos.z + dz}`);
        }
      }
    }
  }
  
  /**
   * Clean up all bodies and free resources.
   */
  dispose(): void {
    if (!this.world || this.disposed) return;
    this.disposed = true;
    for (const debris of this.bodies.values()) {
      try {
        this.world.removeRigidBody(debris.body);
      } catch {
        // Ignore stale-handle removals during disposal.
      }
    }
    this.bodies.clear();
    this.world.free();
    this.world = null;
  }
}
