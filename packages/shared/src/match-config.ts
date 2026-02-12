import type { MatchConfig } from './types.js';

export const DEFAULT_HEIGHTMAP_CONFIG: MatchConfig = {
  seed: 1337,
  terrain: { scale: 0.05, amplitude: 2 },
  bounds: { minX: -100, maxX: 100, minZ: -100, maxZ: 100 },
  spawns: {
    alpha: [
      { x: -60, y: 0, z: -5 },
      { x: -60, y: 0, z: 0 },
      { x: -60, y: 0, z: 5 },
    ],
    bravo: [
      { x: 60, y: 0, z: -5 },
      { x: 60, y: 0, z: 0 },
      { x: 60, y: 0, z: 5 },
    ],
  },
};
