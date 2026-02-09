import type { Vec3 } from './types.js';

/**
 * BFS connectivity checker for voxel structures.
 *
 * After destroying voxels, checks whether remaining neighbor voxels
 * are still connected to the ground (y<=0). Disconnected groups
 * are returned for crumble/collapse effects.
 */

/** 6-connected neighbor offsets */
const NEIGHBORS: readonly [number, number, number][] = [
  [1, 0, 0], [-1, 0, 0],
  [0, 1, 0], [0, -1, 0],
  [0, 0, 1], [0, 0, -1],
];

export interface ConnectivityResult {
  /** Groups of voxel positions that are disconnected from ground */
  disconnected: Vec3[][];
  /** Whether the BFS completed within budget (false = ran out of budget) */
  complete: boolean;
}

/**
 * Check structural connectivity of voxels neighboring a set of removed positions.
 *
 * @param getVoxel - Reads a voxel at world coords (returns 0 for air)
 * @param removedVoxels - Positions that were just removed
 * @param maxBudget - Max voxels to visit across all BFS (budget cap for perf)
 * @param isAnchor - Returns true if a material is a ground anchor (terrain).
 *                   If not provided, only y<=0 counts as ground.
 * @param supportRatio - Max building voxels per ground contact. 0 = disabled
 *                       (any ground path = stable). When >0, BFS counts ground
 *                       contacts and collapses structures with too-thin support.
 */
export function checkConnectivity(
  getVoxel: (wx: number, wy: number, wz: number) => number,
  removedVoxels: Vec3[],
  maxBudget = 8000,
  isAnchor?: (mat: number) => boolean,
  supportRatio = 0,
): ConnectivityResult {
  // Collect unique boundary voxels (solid neighbors of removed voxels)
  const removedSet = new Set<string>();
  for (const v of removedVoxels) {
    removedSet.add(`${v.x},${v.y},${v.z}`);
  }

  const boundarySet = new Set<string>();
  const boundaryVoxels: Vec3[] = [];

  for (const v of removedVoxels) {
    for (const [dx, dy, dz] of NEIGHBORS) {
      const nx = v.x + dx;
      const ny = v.y + dy;
      const nz = v.z + dz;
      const key = `${nx},${ny},${nz}`;
      if (removedSet.has(key) || boundarySet.has(key)) continue;
      if (getVoxel(nx, ny, nz) !== 0) {
        boundarySet.add(key);
        boundaryVoxels.push({ x: nx, y: ny, z: nz });
      }
    }
  }

  const disconnected: Vec3[][] = [];
  const globalVisited = new Set<string>();
  let totalVisited = 0;
  let complete = true;
  const useRatio = supportRatio > 0;

  for (const start of boundaryVoxels) {
    const startKey = `${start.x},${start.y},${start.z}`;
    if (globalVisited.has(startKey)) continue;

    // BFS flood-fill from this boundary voxel
    const component: Vec3[] = [];
    const queue: Vec3[] = [start];
    const visited = new Set<string>([startKey]);
    let grounded = false;
    let groundContacts = 0;
    let budgetExceeded = false;

    while (queue.length > 0) {
      const current = queue.shift()!;
      component.push(current);
      totalVisited++;

      // --- Ground detection ---

      // Bedrock: always grounded
      if (current.y <= 0) {
        grounded = true;
        groundContacts++;
        if (!useRatio) break;
        if (groundContacts * supportRatio >= component.length) break;
        continue; // don't expand from bedrock
      }

      if (isAnchor) {
        const mat = getVoxel(current.x, current.y, current.z);
        if (isAnchor(mat)) {
          // Current voxel IS terrain — grounded, don't expand through it
          grounded = true;
          groundContacts++;
          if (!useRatio) break;
          if (groundContacts * supportRatio >= component.length) break;
          continue;
        }
        // Legacy mode (no ratio): also check resting-on-terrain
        if (!useRatio) {
          const matBelow = getVoxel(current.x, current.y - 1, current.z);
          if (isAnchor(matBelow)) {
            grounded = true;
            break;
          }
        }
        // Ratio mode: "resting on terrain" is detected via neighbor expansion below
      }

      // Budget exceeded: stop BFS, assume stable (safety net)
      if (totalVisited >= maxBudget) {
        budgetExceeded = true;
        complete = false;
        break;
      }

      // Expand to neighbors
      for (const [dx, dy, dz] of NEIGHBORS) {
        const nx = current.x + dx;
        const ny = current.y + dy;
        const nz = current.z + dz;
        const key = `${nx},${ny},${nz}`;
        if (visited.has(key)) continue;
        const nmat = getVoxel(nx, ny, nz);
        if (nmat === 0) continue;

        visited.add(key);

        // In ratio mode: terrain neighbors are ground contacts but not queued.
        // This keeps BFS scoped to the building — terrain mass won't inflate contacts.
        if (useRatio && isAnchor && isAnchor(nmat)) {
          grounded = true;
          groundContacts++;
        } else {
          queue.push({ x: nx, y: ny, z: nz });
        }
      }
    }

    // Mark all visited positions in global set
    for (const key of visited) {
      globalVisited.add(key);
    }

    if (budgetExceeded) break;

    // Determine stability
    if (grounded && useRatio && component.length > groundContacts * supportRatio) {
      // Connected to ground but support too thin — collapse
      disconnected.push(component);
    } else if (!grounded) {
      disconnected.push(component);
    }
  }

  return { disconnected, complete };
}
