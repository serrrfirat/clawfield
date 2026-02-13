import type { CollisionDisc, MatchConfig, Vec3 } from './types.js';
import { createTerrainHeight } from './terrain-noise.js';

const HEIGHTMAP_CHUNK_SIZE = 10;
const HEIGHTMAP_STONE_COUNT = 3;
const HEIGHTMAP_STONE_NOISE_SCALE = 0.15;
const HEIGHTMAP_STONE_NOISE_THRESHOLD = 0.55;
const HEIGHTMAP_STONE_SCALE_MIN = 0.7;
const HEIGHTMAP_STONE_SCALE_MAX = 1.4;
const HEIGHTMAP_STONE_RADIUS_MULT = 1.1;
const HEIGHTMAP_TREE_COUNT_MIN = 1;
const HEIGHTMAP_TREE_COUNT_MAX = 2;
const HEIGHTMAP_TREE_PADDING_FRAC = 0.1;
const HEIGHTMAP_TREE_RADIUS = 0.9;
const HEIGHTMAP_TREE_ATTEMPTS = 12;

function mulberry32(seed: number): () => number {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function buildHeightmapObstacleDiscs(cfg: MatchConfig): CollisionDisc[] {
  const obstacles: CollisionDisc[] = [];
  const worldSeed = Number.isFinite(cfg.seed) ? Math.floor(cfg.seed) : 1337;
  const placementNoise = createTerrainHeight(HEIGHTMAP_STONE_NOISE_SCALE, 1, worldSeed);

  const minChunkX = Math.floor(cfg.bounds.minX / HEIGHTMAP_CHUNK_SIZE);
  const maxChunkX = Math.ceil(cfg.bounds.maxX / HEIGHTMAP_CHUNK_SIZE) - 1;
  const minChunkZ = Math.floor(cfg.bounds.minZ / HEIGHTMAP_CHUNK_SIZE);
  const maxChunkZ = Math.ceil(cfg.bounds.maxZ / HEIGHTMAP_CHUNK_SIZE) - 1;

  for (let cx = minChunkX; cx <= maxChunkX; cx++) {
    for (let cz = minChunkZ; cz <= maxChunkZ; cz++) {
      const stones: Array<{ localX: number; localZ: number; radius: number }> = [];

      const cells = Math.max(8, Math.ceil(Math.sqrt(HEIGHTMAP_STONE_COUNT * 2.5)));
      const cellSize = HEIGHTMAP_CHUNK_SIZE / cells;
      const candidates: Array<{ score: number; localX: number; localZ: number; seed: number }> = [];

      for (let ix = 0; ix < cells; ix++) {
        for (let iz = 0; iz < cells; iz++) {
          const seed = ((cx * 73856093) ^ (cz * 19349663) ^ (ix * 83492791) ^ (iz * 2971215073) ^ worldSeed) >>> 0;
          const rng = mulberry32(seed);

          const centerX = -HEIGHTMAP_CHUNK_SIZE * 0.5 + (ix + 0.5) * cellSize;
          const centerZ = -HEIGHTMAP_CHUNK_SIZE * 0.5 + (iz + 0.5) * cellSize;
          const localX = centerX + (rng() - 0.5) * cellSize * 0.85;
          const localZ = centerZ + (rng() - 0.5) * cellSize * 0.85;

          const worldX = localX + cx * HEIGHTMAP_CHUNK_SIZE;
          const worldZ = localZ + cz * HEIGHTMAP_CHUNK_SIZE;
          const n = placementNoise(worldX, worldZ);
          const n01 = (n + 1) * 0.5;
          if (n01 < HEIGHTMAP_STONE_NOISE_THRESHOLD) continue;

          candidates.push({ score: n01 + rng() * 0.2, localX, localZ, seed });
        }
      }

      candidates.sort((a, b) => b.score - a.score);
      const chosen = candidates.slice(0, HEIGHTMAP_STONE_COUNT);

      for (const c of chosen) {
        const rng = mulberry32(c.seed ^ 0x1234567);
        const baseScale = HEIGHTMAP_STONE_SCALE_MIN + (HEIGHTMAP_STONE_SCALE_MAX - HEIGHTMAP_STONE_SCALE_MIN) * rng();
        const scaleX = baseScale * (0.8 + rng() * 0.4);
        const scaleZ = baseScale * (0.8 + rng() * 0.4);
        const radius = Math.max(scaleX, scaleZ) * HEIGHTMAP_STONE_RADIUS_MULT;
        stones.push({ localX: c.localX, localZ: c.localZ, radius });
        obstacles.push({ x: c.localX + cx * HEIGHTMAP_CHUNK_SIZE, z: c.localZ + cz * HEIGHTMAP_CHUNK_SIZE, r: radius });
      }

      const treeSeed = ((cx * 73856093) ^ (cz * 19349663) ^ 0x9e3779b9 ^ worldSeed) >>> 0;
      const treeRng = mulberry32(treeSeed);
      const treeCount = HEIGHTMAP_TREE_COUNT_MIN + Math.floor(treeRng() * (HEIGHTMAP_TREE_COUNT_MAX - HEIGHTMAP_TREE_COUNT_MIN + 1));
      const padding = HEIGHTMAP_CHUNK_SIZE * HEIGHTMAP_TREE_PADDING_FRAC;
      const placedTrees: Array<{ x: number; z: number }> = [];

      for (let i = 0; i < treeCount; i++) {
        let placed = false;
        for (let a = 0; a < HEIGHTMAP_TREE_ATTEMPTS && !placed; a++) {
          const localX = (-HEIGHTMAP_CHUNK_SIZE * 0.5 + padding) + treeRng() * (HEIGHTMAP_CHUNK_SIZE - padding * 2);
          const localZ = (-HEIGHTMAP_CHUNK_SIZE * 0.5 + padding) + treeRng() * (HEIGHTMAP_CHUNK_SIZE - padding * 2);

          const hitsStone = stones.some((s) => {
            const dx = localX - s.localX;
            const dz = localZ - s.localZ;
            return dx * dx + dz * dz <= (s.radius + HEIGHTMAP_TREE_RADIUS) * (s.radius + HEIGHTMAP_TREE_RADIUS);
          });
          if (hitsStone) continue;

          const hitsTree = placedTrees.some((t) => {
            const dx = localX - t.x;
            const dz = localZ - t.z;
            return dx * dx + dz * dz <= (HEIGHTMAP_TREE_RADIUS * 2) * (HEIGHTMAP_TREE_RADIUS * 2);
          });
          if (hitsTree) continue;

          placedTrees.push({ x: localX, z: localZ });
          obstacles.push({ x: localX + cx * HEIGHTMAP_CHUNK_SIZE, z: localZ + cz * HEIGHTMAP_CHUNK_SIZE, r: HEIGHTMAP_TREE_RADIUS });
          placed = true;
        }
      }
    }
  }

  return obstacles;
}

export function resolveDiscObstacleCollision(pos: Vec3, radius: number, obstacles: CollisionDisc[]): Vec3 {
  let x = pos.x;
  let z = pos.z;

  for (const o of obstacles) {
    const dx = x - o.x;
    const dz = z - o.z;
    const minDist = radius + o.r;
    const d2 = dx * dx + dz * dz;
    if (d2 >= minDist * minDist) continue;

    const d = Math.sqrt(Math.max(d2, 1e-6));
    const nx = d > 1e-4 ? dx / d : 1;
    const nz = d > 1e-4 ? dz / d : 0;
    const push = minDist - d;
    x += nx * push;
    z += nz * push;
  }

  return { x, y: pos.y, z };
}
