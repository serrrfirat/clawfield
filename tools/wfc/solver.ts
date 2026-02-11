/**
 * WFC (Wave Function Collapse) solver.
 *
 * 1. Init: every grid cell gets all tile variants as possibilities.
 * 2. Pick lowest-entropy cell → weighted-random collapse.
 * 3. AC-3 constraint propagation to prune neighbors.
 * 4. Repeat until all cells collapsed (or backtrack on contradiction).
 */

import type { GridCell, TileVariant, SocketType } from './types.js';

/** Sockets match if they are equal (symmetric compatibility). */
function compatible(a: SocketType, b: SocketType): boolean {
  return a === b;
}

/** Seeded PRNG (xoshiro128**) for reproducible maps. */
function createRng(seed: number) {
  let s = [seed | 1, seed ^ 0xdeadbeef, seed ^ 0xcafebabe, seed ^ 0x12345678];
  function rotl(x: number, k: number) { return (x << k) | (x >>> (32 - k)); }
  function next(): number {
    const result = Math.imul(rotl(Math.imul(s[1], 5), 7), 9) >>> 0;
    const t = s[1] << 9;
    s[2] ^= s[0]; s[3] ^= s[1]; s[1] ^= s[2]; s[0] ^= s[3];
    s[2] ^= t; s[3] = rotl(s[3], 11);
    return result / 0x100000000;
  }
  // Warm up
  for (let i = 0; i < 20; i++) next();
  return next;
}

/** Weighted random selection from a set of variant indices. */
function weightedPick(possible: Set<number>, variants: TileVariant[], rng: () => number): number {
  let total = 0;
  for (const idx of possible) total += variants[idx].spec.weight;
  let r = rng() * total;
  for (const idx of possible) {
    r -= variants[idx].spec.weight;
    if (r <= 0) return idx;
  }
  return [...possible][possible.size - 1];
}

/** Shannon entropy with weights. */
function entropy(possible: Set<number>, variants: TileVariant[], rng: () => number): number {
  if (possible.size <= 1) return 0;
  let sumW = 0, sumWLogW = 0;
  for (const idx of possible) {
    const w = variants[idx].spec.weight;
    sumW += w;
    sumWLogW += w * Math.log(w);
  }
  // Add tiny noise to break ties
  return Math.log(sumW) - sumWLogW / sumW + rng() * 1e-6;
}

export interface SolveResult {
  grid: GridCell[][];
  width: number;
  depth: number;
}

/**
 * Run the WFC solver on a width×depth grid.
 * Returns the collapsed grid or throws if unable to solve.
 */
export function solve(
  variants: TileVariant[],
  width: number,
  depth: number,
  seed: number,
  maxAttempts = 100,
): SolveResult {
  const allIndices = new Set<number>();
  for (let i = 0; i < variants.length; i++) allIndices.add(i);

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const rng = createRng(seed + attempt);
    const grid = initGrid(width, depth, allIndices);

    try {
      solveLoop(grid, variants, width, depth, rng);
      return { grid, width, depth };
    } catch {
      // Contradiction — retry with different seed offset
    }
  }

  throw new Error(`WFC failed after ${maxAttempts} attempts with seed ${seed}`);
}

function initGrid(width: number, depth: number, allIndices: Set<number>): GridCell[][] {
  const grid: GridCell[][] = [];
  for (let z = 0; z < depth; z++) {
    grid[z] = [];
    for (let x = 0; x < width; x++) {
      grid[z][x] = { x, z, possible: new Set(allIndices), collapsed: null };
    }
  }
  return grid;
}

function solveLoop(
  grid: GridCell[][],
  variants: TileVariant[],
  width: number,
  depth: number,
  rng: () => number,
): void {
  const totalCells = width * depth;
  let collapsedCount = 0;

  while (collapsedCount < totalCells) {
    // Find lowest-entropy uncollapsed cell
    let minEntropy = Infinity;
    let minCell: GridCell | null = null;

    for (let z = 0; z < depth; z++) {
      for (let x = 0; x < width; x++) {
        const cell = grid[z][x];
        if (cell.collapsed !== null) continue;
        if (cell.possible.size === 0) throw new Error('Contradiction');
        const e = entropy(cell.possible, variants, rng);
        if (e < minEntropy) {
          minEntropy = e;
          minCell = cell;
        }
      }
    }

    if (!minCell) break;

    // Collapse
    const chosen = weightedPick(minCell.possible, variants, rng);
    minCell.collapsed = chosen;
    minCell.possible = new Set([chosen]);
    collapsedCount++;

    // Propagate constraints
    propagate(grid, minCell.x, minCell.z, variants, width, depth);
  }
}

/** Directions: [dx, dz, ourEdge, theirEdge] */
const DIRS: [number, number, 'n' | 'e' | 's' | 'w', 'n' | 'e' | 's' | 'w'][] = [
  [0, -1, 'n', 's'], // north neighbor
  [1, 0, 'e', 'w'],  // east neighbor
  [0, 1, 's', 'n'],  // south neighbor
  [-1, 0, 'w', 'e'], // west neighbor
];

function propagate(
  grid: GridCell[][],
  startX: number,
  startZ: number,
  variants: TileVariant[],
  width: number,
  depth: number,
): void {
  const stack: [number, number][] = [[startX, startZ]];

  while (stack.length > 0) {
    const [cx, cz] = stack.pop()!;
    const cell = grid[cz][cx];

    for (const [dx, dz, ourEdge, theirEdge] of DIRS) {
      const nx = cx + dx;
      const nz = cz + dz;
      if (nx < 0 || nx >= width || nz < 0 || nz >= depth) continue;

      const neighbor = grid[nz][nx];
      if (neighbor.collapsed !== null) continue;

      // Collect all socket types our cell can present on ourEdge
      const ourSockets = new Set<SocketType>();
      for (const idx of cell.possible) {
        ourSockets.add(variants[idx].sockets[ourEdge]);
      }

      // Remove neighbor possibilities that can't match any of our sockets
      const sizeBefore = neighbor.possible.size;
      for (const nIdx of neighbor.possible) {
        const theirSocket = variants[nIdx].sockets[theirEdge];
        let hasMatch = false;
        for (const s of ourSockets) {
          if (compatible(s, theirSocket)) { hasMatch = true; break; }
        }
        if (!hasMatch) neighbor.possible.delete(nIdx);
      }

      if (neighbor.possible.size === 0) throw new Error('Contradiction');

      // If we removed possibilities, propagate further
      if (neighbor.possible.size < sizeBefore) {
        stack.push([nx, nz]);
      }
    }
  }
}
