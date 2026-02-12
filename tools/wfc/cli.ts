#!/usr/bin/env tsx
/**
 * WFC Map Generator CLI
 *
 * Usage:
 *   npx tsx tools/wfc/cli.ts --tileset assets/vox/tiles/tileset.json \
 *     --width 30 --depth 30 --seed 42 --output assets/maps/incursion-42
 */

import * as path from 'node:path';
import { loadTiles } from './tile-loader.js';
import { solve } from './solver.js';
import { placeGameplay } from './gameplay-placer.js';
import { writeMap } from './map-writer.js';

function parseArgs(): { tileset: string; width: number; depth: number; seed: number; output: string } {
  const args = process.argv.slice(2);
  let tileset = 'assets/vox/tiles/tileset.json';
  let width = 40;
  let depth = 40;
  let seed = Date.now();
  let output = 'assets/maps/incursion';

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--tileset': tileset = args[++i]; break;
      case '--width': width = parseInt(args[++i], 10); break;
      case '--depth': depth = parseInt(args[++i], 10); break;
      case '--seed': seed = parseInt(args[++i], 10); break;
      case '--output': output = args[++i]; break;
      case '--help':
        console.log('Usage: npx tsx tools/wfc/cli.ts [options]');
        console.log('  --tileset <path>  Path to tileset.json (default: assets/vox/tiles/tileset.json)');
        console.log('  --width <n>       Grid width in tiles (default: 40)');
        console.log('  --depth <n>       Grid depth in tiles (default: 40)');
        console.log('  --seed <n>        Random seed (default: current timestamp)');
        console.log('  --output <path>   Output path without extension (default: assets/maps/incursion)');
        process.exit(0);
    }
  }

  return { tileset, width, depth, seed, output };
}

async function main() {
  const { tileset, width, depth, seed, output } = parseArgs();
  const tilesetPath = path.resolve(tileset);
  const outputPath = output.endsWith('.map') ? output : `${output}.map`;

  console.log(`WFC Map Generator`);
  console.log(`  Tileset: ${tilesetPath}`);
  console.log(`  Grid: ${width}×${depth} (${width * 16}×${depth * 16} voxels)`);
  console.log(`  Seed: ${seed}`);
  console.log(`  Output: ${outputPath}`);
  console.log();

  // 1. Load tiles
  console.log('Loading tiles...');
  const { variants, palettes } = loadTiles(tilesetPath);
  console.log(`  ${variants.length} variants from ${palettes.size} base tiles`);

  // 2. Solve
  console.log('Solving WFC...');
  const t0 = performance.now();
  const result = solve(variants, width, depth, seed);
  const dt = performance.now() - t0;
  console.log(`  Solved in ${dt.toFixed(0)}ms`);

  // 3. Place gameplay elements
  console.log('Placing gameplay...');
  const gameplay = placeGameplay(result, variants);
  console.log(`  ${gameplay.spawns.team1.length} team1 spawns, ${gameplay.spawns.team2.length} team2 spawns`);
  console.log(`  ${gameplay.captureZones.length} capture zones`);

  // 4. Write map
  console.log('Writing map...');
  writeMap(outputPath, result, variants, palettes, gameplay);

  console.log('\nDone!');
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
