#!/usr/bin/env node
/**
 * cli.ts — CLI entry point for the Google 3D Tiles → Voxel World pipeline.
 *
 * Usage:
 *   npx tsx tools/geo-tiles/cli.ts \
 *     --lat 40.758 --lon -73.9855 --radius 250 \
 *     --api-key $GOOGLE_TILES_API_KEY \
 *     --output assets/maps/times-square \
 *     --name "Times Square"
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CLIOptions, TileRef } from './types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
import { fetchTiles } from './tile-fetcher.js';
import { mergeTiles } from './tile-merger.js';
import { voxelize } from './voxelizer.js';
import { classifyColors } from './color-classifier.js';
import { detectAndGenerateInteriors } from './building-detector.js';
import { generateMeta } from './meta-generator.js';
import { writeMap } from './map-writer.js';

function parseArgs(argv: string[]): CLIOptions {
  const args = argv.slice(2);
  const opts: Partial<CLIOptions> = {
    voxelSize: 1,
    maxGeometricError: 2.0,
    skipInteriors: false,
    skipMeta: false,
    dryRun: false,
    verbose: false,
    cacheOnly: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const next = args[i + 1];

    switch (arg) {
      case '--lat':        opts.lat = parseFloat(next); i++; break;
      case '--lon':        opts.lon = parseFloat(next); i++; break;
      case '--radius':     opts.radius = parseFloat(next); i++; break;
      case '--api-key':    opts.apiKey = next; i++; break;
      case '--output':     opts.output = next; i++; break;
      case '--name':       opts.name = next; i++; break;
      case '--voxel-size': opts.voxelSize = parseFloat(next); i++; break;
      case '--max-error':  opts.maxGeometricError = parseFloat(next); i++; break;
      case '--skip-interiors': opts.skipInteriors = true; break;
      case '--skip-meta':  opts.skipMeta = true; break;
      case '--dry-run':    opts.dryRun = true; break;
      case '--cache-only': opts.cacheOnly = true; break;
      case '--verbose':
      case '-v':           opts.verbose = true; break;
      case '--help':
      case '-h':
        printHelp();
        process.exit(0);
      default:
        if (arg.startsWith('-')) {
          console.error(`Unknown option: ${arg}`);
          printHelp();
          process.exit(1);
        }
    }
  }

  // Validate required args
  if (!opts.lat || !opts.lon) {
    console.error('Error: --lat and --lon are required');
    printHelp();
    process.exit(1);
  }
  if (!opts.apiKey) {
    // Try environment variable
    opts.apiKey = process.env.GOOGLE_TILES_API_KEY ?? '';
    if (!opts.apiKey && !opts.cacheOnly) {
      console.error('Error: --api-key is required (or set GOOGLE_TILES_API_KEY env var)');
      process.exit(1);
    }
  }
  if (!opts.output) {
    console.error('Error: --output is required');
    printHelp();
    process.exit(1);
  }
  if (!opts.radius) {
    opts.radius = 250;
  }
  if (!opts.name) {
    opts.name = path.basename(opts.output);
  }

  return opts as CLIOptions;
}

function printHelp(): void {
  console.log(`
Google 3D Tiles → Clawfield Voxel Map Pipeline

Usage:
  npx tsx tools/geo-tiles/cli.ts [options]

Required:
  --lat <degrees>      Latitude of map center (e.g., 40.758)
  --lon <degrees>      Longitude of map center (e.g., -73.9855)
  --api-key <key>      Google Maps API key (or set GOOGLE_TILES_API_KEY env var)
  --output <path>      Output base path (e.g., assets/maps/times-square)

Optional:
  --name <name>        Map display name (default: output basename)
  --radius <meters>    Radius around center to fetch (default: 250)
  --voxel-size <m>     Voxel size in meters (default: 1)
  --max-error <value>  Max geometric error for tile LOD (default: 2.0)
  --skip-interiors     Skip building interior generation
  --skip-meta          Skip spawn/capture point generation
  --cache-only         Regenerate from cached GLBs (no API key needed)
  --dry-run            Fetch + merge only, don't write output
  --verbose, -v        Verbose logging
  --help, -h           Show this help
  `);
}

async function main(): Promise<void> {
  const startTime = performance.now();

  const opts = parseArgs(process.argv);

  console.log('=== Google 3D Tiles → Clawfield Map Pipeline ===');
  console.log(`  Center: ${opts.lat}, ${opts.lon}`);
  console.log(`  Radius: ${opts.radius}m`);
  console.log(`  Voxel size: ${opts.voxelSize}m`);
  console.log(`  Output: ${opts.output}`);
  console.log('');

  // Step 1: Fetch tiles (or load from cache)
  const cacheDir = path.resolve(__dirname, 'cache');
  const step1Start = performance.now();
  let tiles: TileRef[];

  if (opts.cacheOnly) {
    tiles = loadTilesFromCache(cacheDir, opts);
    console.log(`  Step 1 (cache-only): ${tiles.length} tiles from cache in ${elapsed(step1Start)}\n`);
  } else {
    tiles = await fetchTiles(opts, cacheDir);
    console.log(`  Step 1 (fetch): ${elapsed(step1Start)}\n`);
  }

  if (tiles.length === 0) {
    console.error('No tiles found! Check your coordinates and API key.');
    process.exit(1);
  }

  // Step 2: Merge tiles
  const step2Start = performance.now();
  const mergedScene = await mergeTiles(tiles, opts);
  console.log(`  Step 2 (merge): ${elapsed(step2Start)}\n`);

  if (mergedScene.positions.length === 0) {
    console.error('No geometry found in tiles!');
    process.exit(1);
  }

  // Step 3: Voxelize
  const step3Start = performance.now();
  const voxelGrid = await voxelize(mergedScene, opts);
  console.log(`  Step 3 (voxelize): ${elapsed(step3Start)}\n`);

  // Step 4: Classify colors
  const step4Start = performance.now();
  const classifiedGrid = classifyColors(voxelGrid);
  console.log(`  Step 4 (classify): ${elapsed(step4Start)}\n`);

  // Step 5: Building detection + interiors
  if (!opts.skipInteriors) {
    const step5Start = performance.now();
    detectAndGenerateInteriors(classifiedGrid);
    console.log(`  Step 5 (interiors): ${elapsed(step5Start)}\n`);
  }

  if (opts.dryRun) {
    console.log('Dry run complete. No files written.');
    console.log(`Total: ${elapsed(startTime)}`);
    return;
  }

  // Step 6: Generate metadata
  let meta = null;
  if (!opts.skipMeta) {
    const step6Start = performance.now();
    meta = generateMeta(classifiedGrid, opts.name);
    console.log(`  Step 6 (meta): ${elapsed(step6Start)}\n`);
  }

  // Step 7: Write output
  const step7Start = performance.now();
  const outputBase = path.resolve(opts.output);
  writeMap(classifiedGrid, meta, outputBase);
  console.log(`  Step 7 (write): ${elapsed(step7Start)}\n`);

  console.log('=== Pipeline Complete ===');
  console.log(`  Total time: ${elapsed(startTime)}`);
  console.log(`  Output files:`);
  console.log(`    ${outputBase}.map`);
  console.log(`    ${outputBase}.palette.json`);
  if (meta) {
    console.log(`    ${outputBase}.meta.json`);
  }
}

/**
 * Load tiles from cache directory without hitting the API.
 *
 * Google 3D Tiles GLBs embed ECEF positions in node-level matrices,
 * but in a swapped axis convention: (ECEF_X, ECEF_Z, -ECEF_Y).
 * The tile hierarchy normally provides the correction, but since we
 * don't have it in cache-only mode, we apply a fixed axis correction.
 */
function loadTilesFromCache(cacheDir: string, opts: CLIOptions): TileRef[] {
  if (!fs.existsSync(cacheDir)) {
    console.error(`Cache directory not found: ${cacheDir}`);
    return [];
  }

  const glbFiles = fs.readdirSync(cacheDir).filter(f => f.endsWith('.glb'));
  console.log(`  Found ${glbFiles.length} cached GLBs`);

  // Correction matrix (column-major): converts node output space to standard ECEF
  // Node space: (ECEF_X, ECEF_Z, -ECEF_Y) → Standard ECEF: (X, Y, Z)
  //   ECEF_X = node_x, ECEF_Y = -node_z, ECEF_Z = node_y
  const axisCorrection = [
    1, 0, 0, 0,   // col 0: node_x → ECEF_X
    0, 0, 1, 0,   // col 1: node_y → ECEF_Z
    0, -1, 0, 0,  // col 2: node_z → -ECEF_Y
    0, 0, 0, 1,   // col 3: no translation
  ];

  const tiles: TileRef[] = [];
  for (const file of glbFiles) {
    tiles.push({
      glbPath: path.join(cacheDir, file),
      transform: axisCorrection,
      geometricError: 1.0,
    });
  }

  return tiles;
}

function elapsed(start: number): string {
  return `${((performance.now() - start) / 1000).toFixed(1)}s`;
}

main().catch(err => {
  console.error('Pipeline failed:', err);
  process.exit(1);
});
