#!/usr/bin/env node
/**
 * voxelearth-import.ts — Import real-world locations as CLWF voxel maps.
 *
 * Uses VoxelEarth's Java pipeline (3D Tiles → Draco decode → CPU voxelize)
 * then converts the JSON output to CLWF binary format.
 *
 * Usage:
 *   npx tsx tools/voxelearth-import.ts \
 *     --lat 40.758 --lon -73.9855 --radius 250 \
 *     --api-key $GOOGLE_TILES_API_KEY \
 *     --output assets/maps/times-square \
 *     --name "Times Square"
 *
 * Offline mode (skip Java pipeline, use existing JSON output):
 *   npx tsx tools/voxelearth-import.ts \
 *     --input /path/to/voxel-jsons \
 *     --output assets/maps/times-square
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type { ClassifiedGrid, MapMeta, RGB } from './geo-tiles/types.js';
import { writeMap } from './geo-tiles/map-writer.js';
import { generateMeta } from './geo-tiles/meta-generator.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CHUNK_SIZE = 16;

// WGS84 constants
const WGS84_A = 6378137.0; // semi-major axis (meters)
const WGS84_E2 = 0.00669437999014; // first eccentricity squared

/** Convert lat/lon (degrees) + height (meters) to ECEF XYZ */
function latLonToECEF(lat: number, lon: number, h: number = 0): [number, number, number] {
  const latRad = lat * Math.PI / 180;
  const lonRad = lon * Math.PI / 180;
  const sinLat = Math.sin(latRad);
  const cosLat = Math.cos(latRad);
  const sinLon = Math.sin(lonRad);
  const cosLon = Math.cos(lonRad);
  const N = WGS84_A / Math.sqrt(1 - WGS84_E2 * sinLat * sinLat);
  const x = (N + h) * cosLat * cosLon;
  const y = (N + h) * cosLat * sinLon;
  const z = (N * (1 - WGS84_E2) + h) * sinLat;
  return [x, y, z];
}

/**
 * Extract root node translation from a decoded GLB file.
 * After --rotate-flat, the decoder sets the root node to translation-only (ENU meters).
 * We parse the GLB JSON chunk to read this translation.
 */
function readGlbRootTranslation(glbPath: string): [number, number, number] {
  const buf = fs.readFileSync(glbPath);

  // GLB header: magic(4) + version(4) + length(4)
  // First chunk: length(4) + type(4) + data
  const chunkLen = buf.readUInt32LE(12);
  const chunkType = buf.readUInt32LE(16);

  // Type 0x4E4F534A = "JSON"
  if (chunkType !== 0x4E4F534A) return [0, 0, 0];

  const jsonStr = buf.subarray(20, 20 + chunkLen).toString('utf-8');
  const gltf = JSON.parse(jsonStr);

  // Find the scene's root node
  const sceneIdx = gltf.scene ?? 0;
  const scene = gltf.scenes?.[sceneIdx];
  if (!scene?.nodes?.length) return [0, 0, 0];

  const rootNodeIdx = scene.nodes[0];
  const rootNode = gltf.nodes?.[rootNodeIdx];
  if (!rootNode) return [0, 0, 0];

  // Check for translation property
  if (rootNode.translation) {
    return rootNode.translation as [number, number, number];
  }

  // Check for matrix (column-major 4x4) — extract translation from last column
  if (rootNode.matrix) {
    const m = rootNode.matrix;
    return [m[12], m[13], m[14]];
  }

  return [0, 0, 0];
}

// ---------------------------------------------------------------------------
// CLI option parsing
// ---------------------------------------------------------------------------

interface VEOptions {
  lat: number;
  lon: number;
  radius: number;
  apiKey: string;
  output: string;
  name: string;
  gridSize: number;
  skipMeta: boolean;
  input: string | null;
  parallel: number;
  verbose: boolean;
}

function printUsage(): void {
  console.log(`
VoxelEarth Import — Real-world locations → CLWF voxel maps

Usage:
  npx tsx tools/voxelearth-import.ts [options]

Required (unless --input):
  --lat <float>       Latitude of center point
  --lon <float>       Longitude of center point
  --api-key <string>  Google 3D Tiles API key (or env GOOGLE_TILES_API_KEY)
  --output <path>     Output base path (e.g. assets/maps/times-square)

Optional:
  --radius <float>    Capture radius in meters (default: 250)
  --name <string>     Map display name (default: basename of output)
  --grid-size <int>   Voxelizer grid resolution (default: 128)
  --parallel <int>    Download parallelism (default: 16)
  --skip-meta         Skip auto-generating spawn/capture metadata
  --input <dir>       Skip Java pipeline, read existing voxel JSONs from dir
  --verbose, -v       Show Java tool output
  --help, -h          Show this help
`);
}

function parseArgs(argv: string[]): VEOptions {
  const args = argv.slice(2);
  const opts: Partial<VEOptions> = {
    radius: 250,
    gridSize: 128,
    skipMeta: false,
    input: null,
    parallel: 16,
    verbose: false,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--lat':       opts.lat = parseFloat(args[++i]); break;
      case '--lon':       opts.lon = parseFloat(args[++i]); break;
      case '--radius':    opts.radius = parseFloat(args[++i]); break;
      case '--api-key':   opts.apiKey = args[++i]; break;
      case '--output':    opts.output = args[++i]; break;
      case '--name':      opts.name = args[++i]; break;
      case '--grid-size': opts.gridSize = parseInt(args[++i], 10); break;
      case '--parallel':  opts.parallel = parseInt(args[++i], 10); break;
      case '--skip-meta': opts.skipMeta = true; break;
      case '--input':     opts.input = args[++i]; break;
      case '--verbose': case '-v': opts.verbose = true; break;
      case '--help': case '-h':
        printUsage();
        process.exit(0);
      default:
        console.error(`Unknown option: ${args[i]}`);
        printUsage();
        process.exit(1);
    }
  }

  // Defaults from environment
  if (!opts.apiKey) opts.apiKey = process.env.GOOGLE_TILES_API_KEY ?? '';

  // Validation
  if (!opts.output) {
    console.error('Error: --output is required');
    process.exit(1);
  }
  if (!opts.input) {
    if (opts.lat === undefined || opts.lon === undefined) {
      console.error('Error: --lat and --lon are required (unless using --input)');
      process.exit(1);
    }
    if (!opts.apiKey) {
      console.error('Error: --api-key or GOOGLE_TILES_API_KEY env required (unless using --input)');
      process.exit(1);
    }
  }

  if (!opts.name) {
    opts.name = path.basename(opts.output!);
  }

  return opts as VEOptions;
}

// ---------------------------------------------------------------------------
// Java execution helper
// ---------------------------------------------------------------------------

function execJava(
  jarRelPath: string,
  args: string[],
  verbose: boolean,
): Promise<void> {
  const jarPath = path.resolve(__dirname, 'voxelearth', jarRelPath);
  return new Promise((resolve, reject) => {
    const proc = spawn('java', ['-jar', jarPath, ...args], {
      stdio: verbose ? 'inherit' : 'pipe',
    });

    let stderr = '';
    if (!verbose && proc.stderr) {
      proc.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
    }

    proc.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(
          `Java process exited with code ${code} (${jarRelPath})\n${stderr}`
        ));
      }
    });

    proc.on('error', (err) => {
      reject(new Error(`Failed to spawn Java process: ${err.message}`));
    });
  });
}

// ---------------------------------------------------------------------------
// Stage 1: Preflight checks
// ---------------------------------------------------------------------------

function preflight(opts: VEOptions): void {
  console.log('Stage 1: Preflight checks...');

  if (!opts.input) {
    // Check Java
    try {
      const result = require('node:child_process').execSync('java -version 2>&1', { encoding: 'utf-8' });
      if (opts.verbose) console.log(`  Java: ${result.split('\n')[0]}`);
    } catch {
      console.error('Error: Java not found. Run `bash tools/voxelearth-setup.sh` first.');
      process.exit(1);
    }

    // Check JARs
    const jars = ['jars/downloader.jar', 'jars/decoder.jar', 'jars/voxelizer.jar'];
    for (const jar of jars) {
      const jarPath = path.resolve(__dirname, 'voxelearth', jar);
      if (!fs.existsSync(jarPath)) {
        console.error(`Error: Missing ${jar}. Run \`bash tools/voxelearth-setup.sh\` first.`);
        process.exit(1);
      }
    }
    console.log('  Java and JARs OK');
  } else {
    if (!fs.existsSync(opts.input)) {
      console.error(`Error: Input directory not found: ${opts.input}`);
      process.exit(1);
    }
    console.log(`  Using existing JSON input: ${opts.input}`);
  }
}

// ---------------------------------------------------------------------------
// Stages 2-4: Java pipeline (download → decode → voxelize)
// ---------------------------------------------------------------------------

interface PipelineResult {
  voxelDir: string;
  tileTranslations: Map<string, [number, number, number]>;
  voxelUnit: number;
}

async function runJavaPipeline(opts: VEOptions): Promise<PipelineResult> {
  const workDir = path.resolve(__dirname, 'voxelearth', 'work', String(Date.now()));
  const tilesDir = path.join(workDir, 'tiles');
  const decodedDir = path.join(workDir, 'decoded');
  const voxelDir = path.join(workDir, 'voxels');

  fs.mkdirSync(voxelDir, { recursive: true });

  // Stage 2: Download tiles
  console.log('Stage 2: Downloading 3D tiles...');
  fs.mkdirSync(tilesDir, { recursive: true });
  await execJava('jars/downloader.jar', [
    '--key', opts.apiKey,
    '--lat', String(opts.lat),
    '--lng', String(opts.lon),
    '--radius', String(opts.radius),
    '-o', tilesDir,
    '--parallel', String(opts.parallel),
    ...(opts.verbose ? ['-v'] : []),
  ], opts.verbose);

  const glbCount = fs.readdirSync(tilesDir).filter((f: string) => f.endsWith('.glb')).length;
  console.log(`  Downloaded ${glbCount} tile GLBs`);

  // Stage 3: Decode Draco + rotate-flat to shared ENU origin
  console.log('Stage 3: Decoding Draco + rotating to ENU...');
  fs.mkdirSync(decodedDir, { recursive: true });

  // Compute ECEF origin for the shared ENU coordinate frame
  const ecef = latLonToECEF(opts.lat, opts.lon);
  if (opts.verbose) {
    console.log(`  ECEF origin: [${ecef.map(v => v.toFixed(4)).join(', ')}]`);
  }

  // Decoder expects -filelist with one GLB path per line
  const tileGlbs = fs.readdirSync(tilesDir).filter((f: string) => f.endsWith('.glb'));
  const decoderListPath = path.join(workDir, 'decoder-filelist.txt');
  fs.writeFileSync(decoderListPath, tileGlbs.map((f: string) => path.join(tilesDir, f)).join('\n'));

  await execJava('jars/decoder.jar', [
    '-filelist', decoderListPath,
    '-o', decodedDir,
    '-r',  // --rotate-flat: bake ECEF transforms into vertices, rotate to Y-up
    '--origin', `[${ecef.map(v => v.toFixed(4)).join(',')}]`,
    '-j', '8',
    ...(opts.verbose ? ['-v'] : []),
  ], opts.verbose);

  const decodedGlbs = fs.readdirSync(decodedDir).filter((f: string) => f.endsWith('.glb'));
  console.log(`  Decoded ${decodedGlbs.length} meshes`);

  // Stage 3b: Extract root translations from decoded GLBs (ENU meters)
  // After --rotate-flat, root node has translation-only transform in ENU space.
  console.log('  Extracting ENU translations from decoded GLBs...');
  const tileTranslations = new Map<string, [number, number, number]>();
  const VOXEL_UNIT = 0.467187; // meters per voxel (hardcoded 3D Tiles bbox / 128)

  for (const glbFile of decodedGlbs) {
    const glbPath = path.join(decodedDir, glbFile);
    const trans = readGlbRootTranslation(glbPath);
    // The voxelizer outputs with base name: "sha-decoded" → json is "sha-decoded_128.json"
    const baseName = glbFile.replace('.glb', '');
    tileTranslations.set(baseName, trans);
    if (opts.verbose) {
      console.log(`    ${baseName}: T=[${trans.map(v => v.toFixed(2)).join(', ')}]`);
    }
  }

  // Stage 4: Voxelize
  console.log('Stage 4: Voxelizing meshes...');

  // Voxelizer expects -filelist with one GLB path per line
  const voxelizerListPath = path.join(workDir, 'voxelizer-filelist.txt');
  fs.writeFileSync(voxelizerListPath, decodedGlbs.map((f: string) => path.join(decodedDir, f)).join('\n'));

  await execJava('jars/voxelizer.jar', [
    '-filelist', voxelizerListPath,
    '-s', String(opts.gridSize),
    '-o', voxelDir,
    '-3dtiles',
    ...(opts.verbose ? ['-v'] : []),
  ], opts.verbose);

  const jsonCount = fs.readdirSync(voxelDir).filter((f: string) => f.endsWith('.json')).length;
  console.log(`  Generated ${jsonCount} voxel JSON files`);

  return { voxelDir, tileTranslations, voxelUnit: VOXEL_UNIT };
}

// ---------------------------------------------------------------------------
// Stage 5: Merge tile JSONs → unified voxel grid
// ---------------------------------------------------------------------------

interface TileVoxelData {
  blocks: Record<string, [number, number, number]>;
  xyzi: [number, number, number, number][];
}

function mergeTileJsons(
  jsonDir: string,
  tileTranslations: Map<string, [number, number, number]> | null,
  voxelUnit: number,
  verbose: boolean,
): {
  voxels: Map<string, RGB>;
  bounds: ClassifiedGrid['bounds'];
} {
  console.log('Stage 5: Merging tile voxels...');

  const files = fs.readdirSync(jsonDir);
  const dataFiles = files.filter((f: string) => f.endsWith('.json') && !f.endsWith('_position.json'));

  // Parse all tiles and compute world voxel positions using ENU translations.
  // The voxelizer outputs local voxels in ~[-64, 64] range. To get world position:
  //   worldVoxel = localVoxel + round(enuTranslation / voxelUnit)
  // Then we center everything around the median.

  interface ParsedTile {
    name: string;
    data: TileVoxelData;
    offsetX: number;  // translation offset in voxel units
    offsetY: number;
    offsetZ: number;
  }
  const parsedTiles: ParsedTile[] = [];

  for (const dataFile of dataFiles) {
    const dataPath = path.join(jsonDir, dataFile);
    const tileData: TileVoxelData = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));
    // JSON file: "sha-decoded_128.json" → base: "sha-decoded_128"
    // Translation key is just "sha-decoded" (GLB base name without _128)
    const jsonBase = dataFile.replace('.json', '');
    const transKey = jsonBase.replace(/_\d+$/, ''); // strip _128 suffix

    let offsetX = 0, offsetY = 0, offsetZ = 0;
    if (tileTranslations) {
      const trans = tileTranslations.get(transKey);
      if (trans) {
        offsetX = Math.round(trans[0] / voxelUnit);
        offsetY = Math.round(trans[1] / voxelUnit);
        offsetZ = Math.round(trans[2] / voxelUnit);
      }
    }

    parsedTiles.push({ name: jsonBase, data: tileData, offsetX, offsetY, offsetZ });
  }

  // First pass: sample world positions to find centering offsets
  const sampleX: number[] = [];
  const sampleZ: number[] = [];

  for (const tile of parsedTiles) {
    const step = Math.max(1, Math.floor(tile.data.xyzi.length / 10));
    for (let i = 0; i < tile.data.xyzi.length; i += step) {
      sampleX.push(tile.data.xyzi[i][0] + tile.offsetX);
      sampleZ.push(tile.data.xyzi[i][2] + tile.offsetZ);
    }
  }

  sampleX.sort((a, b) => a - b);
  sampleZ.sort((a, b) => a - b);
  const medX = sampleX.length > 0 ? sampleX[Math.floor(sampleX.length / 2)] : 0;
  const medZ = sampleZ.length > 0 ? sampleZ[Math.floor(sampleZ.length / 2)] : 0;

  // Also find min Y to shift ground to ~0
  const sampleY: number[] = [];
  for (const tile of parsedTiles) {
    const step = Math.max(1, Math.floor(tile.data.xyzi.length / 50));
    for (let i = 0; i < tile.data.xyzi.length; i += step) {
      sampleY.push(tile.data.xyzi[i][1] + tile.offsetY);
    }
  }
  sampleY.sort((a, b) => a - b);
  const minY = sampleY.length > 0 ? sampleY[Math.floor(sampleY.length * 0.01)] : 0;

  console.log(`  Centering: medX=${medX}, medZ=${medZ}, minY=${minY}`);

  // Second pass: collect world voxels
  const voxels = new Map<string, RGB>();
  let totalVoxels = 0;
  let xMin = Infinity, xMax = -Infinity;
  let yMin = Infinity, yMax = -Infinity;
  let zMin = Infinity, zMax = -Infinity;

  for (const tile of parsedTiles) {
    for (const [x, y, z, colorIdx] of tile.data.xyzi) {
      const rgb = tile.data.blocks[String(colorIdx)];
      if (!rgb) continue;

      // World position = local voxel + ENU translation offset, centered
      const wx = x + tile.offsetX - medX;
      const wy = y + tile.offsetY - minY;
      const wz = z + tile.offsetZ - medZ;

      const key = `${wx},${wy},${wz}`;
      voxels.set(key, { r: rgb[0], g: rgb[1], b: rgb[2] });

      if (wx < xMin) xMin = wx; if (wx > xMax) xMax = wx;
      if (wy < yMin) yMin = wy; if (wy > yMax) yMax = wy;
      if (wz < zMin) zMin = wz; if (wz > zMax) zMax = wz;

      totalVoxels++;
    }

    if (verbose) {
      console.log(`  Tile ${tile.name}: ${tile.data.xyzi.length} voxels (offset: ${tile.offsetX},${tile.offsetY},${tile.offsetZ})`);
    }
  }

  console.log(`  Total: ${totalVoxels} voxels from ${dataFiles.length} tiles`);
  console.log(`  Bounds: X[${xMin},${xMax}] Y[${yMin},${yMax}] Z[${zMin},${zMax}]`);
  console.log(`  Dimensions: ${xMax - xMin + 1} × ${yMax - yMin + 1} × ${zMax - zMin + 1}`);

  return {
    voxels,
    bounds: { xMin, xMax, yMin, yMax, zMin, zMax },
  };
}

// ---------------------------------------------------------------------------
// Stage 6: k-means palette quantization
// ---------------------------------------------------------------------------

function quantizePalette(
  voxels: Map<string, RGB>,
  maxColors: number = 255,
): { palette: RGB[]; assignments: Map<string, number> } {
  console.log('Stage 6: Quantizing colors to 256-entry palette...');

  // Collect unique colors (quantized to 5-bit for efficiency)
  const colorBuckets = new Map<number, { sum: [number, number, number]; count: number }>();

  for (const rgb of voxels.values()) {
    const key = ((rgb.r >> 3) << 10) | ((rgb.g >> 3) << 5) | (rgb.b >> 3);
    const bucket = colorBuckets.get(key);
    if (bucket) {
      bucket.sum[0] += rgb.r;
      bucket.sum[1] += rgb.g;
      bucket.sum[2] += rgb.b;
      bucket.count++;
    } else {
      colorBuckets.set(key, { sum: [rgb.r, rgb.g, rgb.b], count: 1 });
    }
  }

  // Compute bucket centroids as representative colors
  const uniqueColors: { r: number; g: number; b: number; weight: number }[] = [];
  for (const bucket of colorBuckets.values()) {
    uniqueColors.push({
      r: Math.round(bucket.sum[0] / bucket.count),
      g: Math.round(bucket.sum[1] / bucket.count),
      b: Math.round(bucket.sum[2] / bucket.count),
      weight: bucket.count,
    });
  }

  console.log(`  Unique color buckets: ${uniqueColors.length}`);

  const k = Math.min(maxColors, uniqueColors.length);

  // k-means++ initialization
  const centroids: [number, number, number][] = [];

  // Pick first centroid: highest-weight color
  let bestIdx = 0;
  for (let i = 1; i < uniqueColors.length; i++) {
    if (uniqueColors[i].weight > uniqueColors[bestIdx].weight) bestIdx = i;
  }
  centroids.push([uniqueColors[bestIdx].r, uniqueColors[bestIdx].g, uniqueColors[bestIdx].b]);

  // Pick remaining centroids with distance-weighted probability
  for (let ci = 1; ci < k; ci++) {
    let totalDist = 0;
    const dists: number[] = [];

    for (const c of uniqueColors) {
      let minD = Infinity;
      for (const cent of centroids) {
        const d = (c.r - cent[0]) ** 2 + (c.g - cent[1]) ** 2 + (c.b - cent[2]) ** 2;
        if (d < minD) minD = d;
      }
      dists.push(minD * c.weight);
      totalDist += minD * c.weight;
    }

    // Weighted random selection
    let r = Math.random() * totalDist;
    let picked = 0;
    for (let i = 0; i < dists.length; i++) {
      r -= dists[i];
      if (r <= 0) { picked = i; break; }
    }
    centroids.push([uniqueColors[picked].r, uniqueColors[picked].g, uniqueColors[picked].b]);
  }

  // Lloyd's iterations
  const maxIterations = 20;
  const clusterAssign = new Int32Array(uniqueColors.length);

  for (let iter = 0; iter < maxIterations; iter++) {
    let changed = 0;

    // Assign each color to nearest centroid
    for (let i = 0; i < uniqueColors.length; i++) {
      const c = uniqueColors[i];
      let bestCluster = 0;
      let bestDist = Infinity;

      for (let ci = 0; ci < centroids.length; ci++) {
        const cent = centroids[ci];
        const d = (c.r - cent[0]) ** 2 + (c.g - cent[1]) ** 2 + (c.b - cent[2]) ** 2;
        if (d < bestDist) { bestDist = d; bestCluster = ci; }
      }

      if (clusterAssign[i] !== bestCluster) {
        clusterAssign[i] = bestCluster;
        changed++;
      }
    }

    if (changed === 0) {
      console.log(`  k-means converged at iteration ${iter + 1}`);
      break;
    }

    // Recompute centroids
    const sums: [number, number, number][] = Array.from({ length: centroids.length }, () => [0, 0, 0]);
    const counts = new Float64Array(centroids.length);

    for (let i = 0; i < uniqueColors.length; i++) {
      const ci = clusterAssign[i];
      const c = uniqueColors[i];
      sums[ci][0] += c.r * c.weight;
      sums[ci][1] += c.g * c.weight;
      sums[ci][2] += c.b * c.weight;
      counts[ci] += c.weight;
    }

    for (let ci = 0; ci < centroids.length; ci++) {
      if (counts[ci] > 0) {
        centroids[ci] = [
          Math.round(sums[ci][0] / counts[ci]),
          Math.round(sums[ci][1] / counts[ci]),
          Math.round(sums[ci][2] / counts[ci]),
        ];
      }
    }
  }

  // Build palette (slot 0 = air, slots 1..k = clusters)
  const palette: RGB[] = [{ r: 0, g: 0, b: 0 }]; // Index 0 = air
  for (const cent of centroids) {
    palette.push({
      r: Math.min(255, Math.max(0, cent[0])),
      g: Math.min(255, Math.max(0, cent[1])),
      b: Math.min(255, Math.max(0, cent[2])),
    });
  }
  // Pad to 256
  while (palette.length < 256) {
    palette.push({ r: 0, g: 0, b: 0 });
  }

  // Build lookup: 5-bit quantized color → centroid index
  const bucketToCluster = new Map<number, number>();
  for (let i = 0; i < uniqueColors.length; i++) {
    const c = uniqueColors[i];
    const key = ((c.r >> 3) << 10) | ((c.g >> 3) << 5) | (c.b >> 3);
    bucketToCluster.set(key, clusterAssign[i] + 1); // +1 because slot 0 = air
  }

  // Assign each voxel to palette index
  const assignments = new Map<string, number>();
  for (const [posKey, rgb] of voxels) {
    const colorKey = ((rgb.r >> 3) << 10) | ((rgb.g >> 3) << 5) | (rgb.b >> 3);
    assignments.set(posKey, bucketToCluster.get(colorKey) ?? 1);
  }

  console.log(`  Palette: ${k} colors + air`);
  return { palette, assignments };
}

// ---------------------------------------------------------------------------
// Stage 7: Build ClassifiedGrid and write output
// ---------------------------------------------------------------------------

function buildClassifiedGrid(
  assignments: Map<string, number>,
  palette: RGB[],
  bounds: ClassifiedGrid['bounds'],
): ClassifiedGrid {
  console.log('Stage 7: Building chunk grid...');

  const chunks = new Map<string, Uint8Array>();

  for (const [posKey, paletteIdx] of assignments) {
    const [wx, wy, wz] = posKey.split(',').map(Number);

    const cx = Math.floor(wx / CHUNK_SIZE);
    const cy = Math.floor(wy / CHUNK_SIZE);
    const cz = Math.floor(wz / CHUNK_SIZE);
    const chunkKey = `${cx},${cy},${cz}`;

    let chunk = chunks.get(chunkKey);
    if (!chunk) {
      chunk = new Uint8Array(CHUNK_SIZE ** 3);
      chunks.set(chunkKey, chunk);
    }

    const lx = ((wx % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    const ly = ((wy % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    const lz = ((wz % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    chunk[lx + ly * CHUNK_SIZE + lz * CHUNK_SIZE * CHUNK_SIZE] = paletteIdx;
  }

  console.log(`  Chunks: ${chunks.size}`);
  return { chunks, palette, bounds };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const opts = parseArgs(process.argv);

  console.log(`\nVoxelEarth Import: ${opts.name}`);
  if (!opts.input) {
    console.log(`  Location: ${opts.lat}, ${opts.lon} (radius ${opts.radius}m)`);
  }
  console.log(`  Output: ${opts.output}`);
  console.log('');

  // Stage 1
  preflight(opts);

  // Stages 2-4: Java pipeline or use existing input
  let jsonDir: string;
  let workDir: string | null = null;
  let tileTranslations: Map<string, [number, number, number]> | null = null;
  let voxelUnit = 0.467187; // default

  if (opts.input) {
    jsonDir = opts.input;
  } else {
    const result = await runJavaPipeline(opts);
    jsonDir = result.voxelDir;
    tileTranslations = result.tileTranslations;
    voxelUnit = result.voxelUnit;
    workDir = path.resolve(jsonDir, '..'); // work/<timestamp>
  }

  // Stage 5: Merge tiles
  const { voxels, bounds } = mergeTileJsons(jsonDir, tileTranslations, voxelUnit, opts.verbose);

  if (voxels.size === 0) {
    console.error('Error: No voxels found in tile data');
    process.exit(1);
  }

  // Stage 6: Quantize palette
  const { palette, assignments } = quantizePalette(voxels);

  // Stage 7: Build grid and write
  const grid = buildClassifiedGrid(assignments, palette, bounds);

  let meta: MapMeta | null = null;
  if (!opts.skipMeta) {
    meta = generateMeta(grid, opts.name);
  }

  writeMap(grid, meta, opts.output);

  // Clean up work directory on success
  if (workDir && fs.existsSync(workDir)) {
    fs.rmSync(workDir, { recursive: true, force: true });
    console.log(`\nCleaned up work directory`);
  }

  console.log(`\nDone! Map written to ${opts.output}.map`);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
