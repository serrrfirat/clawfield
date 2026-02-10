import type { Vec3, DestructionEvent } from '@clawfield/shared';
import {
  MAT_AIR,
  MATERIAL_HARDNESS,
  DEFAULT_MATERIAL_HARDNESS,
  MATERIAL_COLORS,
  isDestructible,
  isGroundAnchor,
  BULLET_VOXEL_DAMAGE,
  BULLET_DESTRUCTION_COUNT,
  MAX_VOXEL_CHANGES_PER_TICK,
  STRUCTURAL_BUDGET_BULLET,
  STRUCTURAL_SUPPORT_RATIO,
  RUBBLE_DROP_MIN_SIZE,
  CRUSH_DAMAGE,
  SECTION_FALL_GRAVITY,
  SECTION_FALL_MIN_DURATION,
  SECTION_FALL_MAX_DURATION,
  getVoxel,
  setVoxel,
  checkConnectivity,
} from '@clawfield/shared';
import type { VoxelChange } from './gadget-manager.js';
import type { DebrisPhysicsManager, DebrisState } from './debris-physics-manager.js';

export interface CrushZone {
  min: Vec3;
  max: Vec3;
  damage: number;
}

/** A group of voxels falling through the air before landing */
interface PendingDrop {
  group: Vec3[];
  materials: number[];
  dropDist: number;
  landTime: number; // Date.now() timestamp when voxels get placed
  crushZone: CrushZone | null;
}

/** A single voxel dropping to the nearest surface below */
interface PendingVoxelDrop {
  x: number;
  landY: number; // Y where it lands
  z: number;
  material: number;
  landTime: number;
}

/**
 * Server-side destruction manager.
 *
 * Handles voxel removal from bullet impacts and explosions,
 * runs structural connectivity checks after explosions,
 * and queues voxel changes + visual events for broadcast.
 * 
 * Now with physics debris support - destroyed voxels become Rapier rigid bodies
 * that players can collide with and stand on.
 */
export class DestructionManager {
  private chunks: Map<string, Uint8Array>;
  private pendingChanges: VoxelChange[] = [];
  private pendingEvents: DestructionEvent[] = [];
  private pendingCrushZones: CrushZone[] = [];
  private pendingDrops: PendingDrop[] = [];
  private pendingVoxelDrops: PendingVoxelDrop[] = [];
  private debrisPhysics: DebrisPhysicsManager | null = null;
  private pendingDebrisBodies: Array<{
    voxels: Vec3[];
    colors: number[];
    materials: number[];
    impactPos: Vec3;
    impactDir: Vec3;
  }> = [];

  constructor(chunks: Map<string, Uint8Array>, debrisPhysics?: DebrisPhysicsManager) {
    this.chunks = chunks;
    this.debrisPhysics = debrisPhysics ?? null;
  }
  
  /**
   * Set the debris physics manager (call after construction if not provided)
   */
  setDebrisPhysics(debrisPhysics: DebrisPhysicsManager): void {
    this.debrisPhysics = debrisPhysics;
  }

  /**
   * Call every tick to advance pending drops.
   * When a falling group reaches its landing time, places voxels
   * and emits crush zones.
   */
  update(now: number): void {
    // Process group drops (structural collapses)
    for (let i = this.pendingDrops.length - 1; i >= 0; i--) {
      const drop = this.pendingDrops[i];
      if (now < drop.landTime) continue;

      for (let j = 0; j < drop.group.length; j++) {
        if (drop.materials[j] === MAT_AIR) continue;
        const v = drop.group[j];
        const newY = v.y - drop.dropDist;
        setVoxel(this.chunks, v.x, newY, v.z, drop.materials[j]);
        this.pendingChanges.push({ x: v.x, y: newY, z: v.z, material: drop.materials[j] });
      }

      if (drop.crushZone) {
        this.pendingCrushZones.push(drop.crushZone);
      }

      this.pendingDrops.splice(i, 1);
    }

    // Process individual voxel drops (bullet/explosion rubble)
    for (let i = this.pendingVoxelDrops.length - 1; i >= 0; i--) {
      const vd = this.pendingVoxelDrops[i];
      if (now < vd.landTime) continue;

      // Find first available air slot at or above the target — stack rubble
      let placeY = vd.landY;
      while (placeY < 256 && getVoxel(this.chunks, vd.x, placeY, vd.z) !== MAT_AIR) {
        placeY++;
      }
      if (placeY < 256) {
        setVoxel(this.chunks, vd.x, placeY, vd.z, vd.material);
        this.pendingChanges.push({ x: vd.x, y: placeY, z: vd.z, material: vd.material });
      }

      this.pendingVoxelDrops.splice(i, 1);
    }
  }

  /**
   * Explode a sphere of voxels around a center point.
   * Removes destructible voxels within radius, then checks
   * structural connectivity for crumble/collapse.
   */
  explode(center: Vec3, radius: number): void {
    const r = Math.ceil(radius);
    const removed: Vec3[] = [];
    const removedColors: number[] = [];
    const removedMats: number[] = [];
    let avgColor = 0;

    for (let dx = -r; dx <= r; dx++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dz = -r; dz <= r; dz++) {
          if (dx * dx + dy * dy + dz * dz > radius * radius) continue;
          if (this.pendingChanges.length >= MAX_VOXEL_CHANGES_PER_TICK) break;

          const wx = Math.floor(center.x) + dx;
          const wy = Math.floor(center.y) + dy;
          const wz = Math.floor(center.z) + dz;

          const mat = getVoxel(this.chunks, wx, wy, wz);
          if (!isDestructible(mat)) continue;

          const color = MATERIAL_COLORS[mat] ?? 0x888888;

          setVoxel(this.chunks, wx, wy, wz, MAT_AIR);
          this.pendingChanges.push({ x: wx, y: wy, z: wz, material: MAT_AIR });
          removed.push({ x: wx, y: wy, z: wz });
          removedColors.push(color);
          removedMats.push(mat);

          if (avgColor === 0) avgColor = color;
        }
      }
    }

    if (removed.length === 0) return;

    // Use centroid of actually-destroyed voxels as the visual center
    // (grenade center may be underground/in terrain, making VFX look offset)
    let vx = 0, vy = 0, vz = 0;
    for (const v of removed) { vx += v.x; vy += v.y; vz += v.z; }
    const visualCenter: Vec3 = {
      x: vx / removed.length + 0.5,
      y: vy / removed.length + 0.5,
      z: vz / removed.length + 0.5,
    };

    // Queue physics debris body creation.
    // Even if physics is not ready yet, keep this queued and process later when available.
    this.pendingDebrisBodies.push({
      voxels: removed,
      colors: removedColors,
      materials: removedMats,
      impactPos: center,
      impactDir: { x: 0, y: 1, z: 0 },
    });

    this.pendingEvents.push({
      position: visualCenter,
      kind: 'explosion',
      radius,
      materialColor: avgColor,
      voxels: removed,
      voxelColors: removedColors,
      voxelMaterials: removedMats,
      impactDir: { x: 0, y: 1, z: 0 },
    });

    this.processConnectivity(removed, avgColor, undefined, center);
  }

  /**
   * Bullet impact: destroy 1-3 voxels along the bullet direction
   * if bullet damage >= material hardness.
   * Returns the hit material palette color (for particles), or 0 if nothing destroyed.
   */
  bulletImpact(hitPos: Vec3, direction: Vec3): number {
    if (this.pendingChanges.length >= MAX_VOXEL_CHANGES_PER_TICK) return 0;

    let hitColor = 0;
    const removed: Vec3[] = [];
    const removedColors: number[] = [];
    const removedMats: number[] = [];

    for (let i = 0; i < BULLET_DESTRUCTION_COUNT; i++) {
      const wx = Math.floor(hitPos.x + direction.x * i);
      const wy = Math.floor(hitPos.y + direction.y * i);
      const wz = Math.floor(hitPos.z + direction.z * i);

      const mat = getVoxel(this.chunks, wx, wy, wz);
      if (!isDestructible(mat)) continue;

      const hardness = MATERIAL_HARDNESS[mat] ?? DEFAULT_MATERIAL_HARDNESS;
      if (BULLET_VOXEL_DAMAGE < hardness) {
        if (hitColor === 0) hitColor = MATERIAL_COLORS[mat] ?? 0x888888;
        break;
      }

      const color = MATERIAL_COLORS[mat] ?? 0x888888;
      setVoxel(this.chunks, wx, wy, wz, MAT_AIR);
      this.pendingChanges.push({ x: wx, y: wy, z: wz, material: MAT_AIR });
      removed.push({ x: wx, y: wy, z: wz });
      removedColors.push(color);
      removedMats.push(mat);
      if (hitColor === 0) hitColor = color;

      if (this.pendingChanges.length >= MAX_VOXEL_CHANGES_PER_TICK) break;
    }

    if (removed.length > 0) {
      // Queue rubble drops: bullet chips fall to nearest surface
      this.queueRubbleDrops(removed, removedMats, 150); // short delay

      this.pendingEvents.push({
        position: { ...hitPos },
        kind: 'bullet',
        radius: 1,
        materialColor: hitColor,
        voxels: removed,
        voxelColors: removedColors,
        voxelMaterials: removedMats,
        impactDir: { ...direction },
      });

      // Run structural connectivity check after bullet destruction
      this.processConnectivity(removed, hitColor, STRUCTURAL_BUDGET_BULLET, hitPos);
    }

    return hitColor;
  }

  /**
   * Run connectivity check on removed voxels and process any disconnected groups.
   * Large groups drop as rigid bodies with delayed placement.
   * Small groups become visual-only debris.
   */
  private processConnectivity(
    removed: Vec3[],
    fallbackColor: number,
    budget?: number,
    impactPos?: Vec3,
  ): void {
    const voxelGetter = (wx: number, wy: number, wz: number) =>
      getVoxel(this.chunks, wx, wy, wz);
    const { disconnected } = checkConnectivity(
      voxelGetter,
      removed,
      budget,
      isGroundAnchor,
      STRUCTURAL_SUPPORT_RATIO,
    );

    for (const group of disconnected) {
      if (this.pendingChanges.length >= MAX_VOXEL_CHANGES_PER_TICK) break;

      // Save materials and compute per-voxel colors before removing
      const materials: number[] = [];
      const voxelColors: number[] = [];
      let groupColor = 0;
      let cx = 0, cy = 0, cz = 0;

      for (const v of group) {
        const mat = getVoxel(this.chunks, v.x, v.y, v.z);
        materials.push(mat);
        const color = MATERIAL_COLORS[mat] ?? 0x888888;
        voxelColors.push(color);
        if (mat !== MAT_AIR && groupColor === 0) {
          groupColor = color;
        }
        cx += v.x;
        cy += v.y;
        cz += v.z;
      }

      // Remove all voxels from current positions
      for (let i = 0; i < group.length; i++) {
        if (materials[i] !== MAT_AIR) {
          setVoxel(this.chunks, group[i].x, group[i].y, group[i].z, MAT_AIR);
          this.pendingChanges.push({ x: group[i].x, y: group[i].y, z: group[i].z, material: MAT_AIR });
        }
      }

      const len = group.length;
      const centroid: Vec3 = { x: cx / len, y: cy / len, z: cz / len };

      // Compute impact direction (from centroid toward impact point)
      let impactDir: Vec3 = { x: 0, y: 0, z: 0 };
      if (impactPos) {
        const dx = impactPos.x - centroid.x;
        const dz = impactPos.z - centroid.z;
        const dlen = Math.sqrt(dx * dx + dz * dz);
        if (dlen > 0.01) {
          impactDir = { x: dx / dlen, y: 0, z: dz / dlen };
        }
      }

      // Large groups: rigid body drop with delayed placement
      if (len >= RUBBLE_DROP_MIN_SIZE) {
        const dropResult = this.computeDrop(group, materials);
        if (dropResult.dropDist > 0) {
          // Compute fall duration from physics
          const physTime = Math.sqrt(2 * dropResult.dropDist / SECTION_FALL_GRAVITY);
          const fallDuration = Math.max(
            SECTION_FALL_MIN_DURATION,
            Math.min(SECTION_FALL_MAX_DURATION, physTime),
          );

          // Delay voxel placement until the fall animation completes
          this.pendingDrops.push({
            group,
            materials,
            dropDist: dropResult.dropDist,
            landTime: Date.now() + fallDuration * 1000,
            crushZone: dropResult.crushZone,
          });

          // Visual: falling section event with per-voxel data
          this.pendingEvents.push({
            position: centroid,
            kind: 'collapse',
            radius: Math.ceil(Math.cbrt(len)),
            materialColor: groupColor || fallbackColor,
            voxels: group,
            voxelColors,
            dropDistance: dropResult.dropDist,
            impactDir,
            fallDuration,
          });
          continue;
        }
        // dropDist === 0: can't fall, place back at same position
        for (let i = 0; i < group.length; i++) {
          if (materials[i] !== MAT_AIR) {
            setVoxel(this.chunks, group[i].x, group[i].y, group[i].z, materials[i]);
            this.pendingChanges.push({ x: group[i].x, y: group[i].y, z: group[i].z, material: materials[i] });
          }
        }
        continue;
      }

      // Small groups: visual debris only (no world geometry)
      this.pendingEvents.push({
        position: centroid,
        kind: 'crumble',
        radius: Math.ceil(Math.cbrt(len)),
        materialColor: groupColor || fallbackColor,
        voxels: group,
      });
    }
  }

  /**
   * Compute how far a disconnected group can drop (without placing voxels).
   * Returns the drop distance and crush zone bounding box.
   */
  private computeDrop(
    group: Vec3[],
    materials: number[],
  ): { dropDist: number; crushZone: CrushZone | null } {
    // Build column bottom map: for each (x,z) column, find the lowest y in the group
    const columnBottoms = new Map<string, number>();
    for (const v of group) {
      const key = `${v.x},${v.z}`;
      const existing = columnBottoms.get(key);
      if (existing === undefined || v.y < existing) {
        columnBottoms.set(key, v.y);
      }
    }

    // For each column, ray-cast down from bottom to find how far the group can drop
    let minDrop = Infinity;
    for (const [key, bottomY] of columnBottoms) {
      const [x, z] = key.split(',').map(Number);
      let drop = 0;
      for (let y = bottomY - 1; y >= -64; y--) {
        if (getVoxel(this.chunks, x, y, z) !== MAT_AIR) break;
        drop++;
      }
      minDrop = Math.min(minDrop, drop);
    }

    if (minDrop <= 0 || !isFinite(minDrop)) {
      return { dropDist: 0, crushZone: null };
    }

    // Compute crush zone bounding box (swept volume from old to new position)
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

    for (let i = 0; i < group.length; i++) {
      if (materials[i] === MAT_AIR) continue;
      const v = group[i];
      const newY = v.y - minDrop;
      minX = Math.min(minX, v.x);
      maxX = Math.max(maxX, v.x + 1);
      minY = Math.min(minY, newY);
      maxY = Math.max(maxY, v.y + 1);
      minZ = Math.min(minZ, v.z);
      maxZ = Math.max(maxZ, v.z + 1);
    }

    return {
      dropDist: minDrop,
      crushZone: {
        min: { x: minX, y: minY, z: minZ },
        max: { x: maxX, y: maxY, z: maxZ },
        damage: CRUSH_DAMAGE,
      },
    };
  }

  /**
   * Queue individual voxel drops: each destroyed voxel ray-casts down
   * to the nearest solid surface and lands there after a delay.
   * This makes rubble permanent world geometry.
   */
  private queueRubbleDrops(voxels: Vec3[], materials: number[], delayMs: number): void {
    const now = Date.now();
    // Track claimed column heights so voxels stack instead of overlapping
    const columnTops = new Map<string, number>();

    for (let i = 0; i < voxels.length; i++) {
      const mat = materials[i];
      if (mat === MAT_AIR) continue;

      const { x, y, z } = voxels[i];
      const colKey = `${x},${z}`;

      // Find the ground level for this column (cached per column)
      let baseY = columnTops.get(colKey);
      if (baseY === undefined) {
        // Ray-cast straight down to find the first solid surface
        baseY = -1;
        for (let cy = y - 1; cy >= -64; cy--) {
          if (getVoxel(this.chunks, x, cy, z) !== MAT_AIR) {
            baseY = cy + 1; // land on top of the solid voxel
            break;
          }
        }
        if (baseY < 0) continue; // no surface, skip entire column
        columnTops.set(colKey, baseY);
      }

      const landY = baseY;
      if (landY >= y) continue; // would land at or above original pos

      // Claim this slot, next voxel in same column stacks on top
      columnTops.set(colKey, landY + 1);

      this.pendingVoxelDrops.push({
        x,
        landY,
        z,
        material: mat,
        landTime: now + delayMs,
      });
    }
  }

  /** Drain pending voxel changes (same format as gadget system) */
  drainChanges(): VoxelChange[] {
    const changes = this.pendingChanges;
    this.pendingChanges = [];
    return changes;
  }

  /** Drain pending visual events for clients */
  drainEvents(): DestructionEvent[] {
    const events = this.pendingEvents;
    this.pendingEvents = [];
    return events;
  }

  /** Drain crush zones — game loop checks player positions against these */
  drainCrushZones(): CrushZone[] {
    const zones = this.pendingCrushZones;
    this.pendingCrushZones = [];
    return zones;
  }
  
  /**
   * Process pending debris body creation requests.
   * Call this from game loop to create Rapier physics bodies for destroyed voxels.
   * Returns the IDs of created debris bodies.
   */
  processPendingDebrisBodies(): number[] {
    if (!this.debrisPhysics || this.pendingDebrisBodies.length === 0) {
      return [];
    }
    
    const createdIds: number[] = [];
    
    for (const pending of this.pendingDebrisBodies) {
      const ids = this.debrisPhysics.spawnDebris(
        pending.voxels,
        pending.colors,
        pending.materials,
        pending.impactPos,
        pending.impactDir
      );
      createdIds.push(...ids);
    }
    
    this.pendingDebrisBodies = [];
    return createdIds;
  }
}
