/**
 * vox-extract.ts
 *
 * Extracts individual models from a MagicaVoxel .vox file into
 * .component.json files for the component system.
 *
 * Usage:
 *   npx tsx tools/vox-extract.ts <input.vox> --output <output-dir>
 *
 * Example:
 *   npx tsx tools/vox-extract.ts assets/maps/Oasis_Hard_Cover.vox --output assets/components/oasis/
 *
 * Output per model:
 *   <output-dir>/model_NNN.component.json
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { parseVox, type VoxFile, type PaletteColor } from './vox-parse.js';

// ---------------------------------------------------------------------------
// Component format
// ---------------------------------------------------------------------------

interface ComponentVoxel {
  x: number;
  y: number;
  z: number;
  c: number; // color index
}

interface ComponentFile {
  name: string;
  version: number;
  bounds: { sizeX: number; sizeY: number; sizeZ: number };
  origin: { x: number; y: number; z: number };
  palette: { r: number; g: number; b: number }[];
  usedColors: number[];
  voxels: ComponentVoxel[];
  source?: { file: string; modelIndex: number };
}

// ---------------------------------------------------------------------------
// Model extraction
// ---------------------------------------------------------------------------

function extractModel(
  voxFile: VoxFile,
  modelIndex: number,
  sourceFile: string,
): ComponentFile | null {
  const model = voxFile.models[modelIndex];
  if (!model || model.voxels.length === 0) return null;

  // Convert VOX coords → game coords
  // VOX: X=right, Y=depth, Z=up
  // Game: X=right, Y=up, Z=depth
  // Swap: gameX=voxX, gameY=voxZ, gameZ=voxY
  const voxels: ComponentVoxel[] = [];
  const usedSet = new Set<number>();

  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

  for (const v of model.voxels) {
    const gx = v.x;
    const gy = v.z; // vox Z (up) → game Y (up)
    const gz = v.y; // vox Y (depth) → game Z (depth)

    if (gx < minX) minX = gx;
    if (gy < minY) minY = gy;
    if (gz < minZ) minZ = gz;
    if (gx > maxX) maxX = gx;
    if (gy > maxY) maxY = gy;
    if (gz > maxZ) maxZ = gz;

    usedSet.add(v.colorIndex);
    voxels.push({ x: gx, y: gy, z: gz, c: v.colorIndex });
  }

  // Normalize voxels so min corner is at (0,0,0)
  for (const v of voxels) {
    v.x -= minX;
    v.y -= minY;
    v.z -= minZ;
  }

  const sizeX = maxX - minX + 1;
  const sizeY = maxY - minY + 1;
  const sizeZ = maxZ - minZ + 1;

  // Origin: floor-center
  const origin = {
    x: Math.floor(sizeX / 2),
    y: 0,
    z: Math.floor(sizeZ / 2),
  };

  // Build palette (all 256 entries from source)
  const palette = voxFile.palette.map((c: PaletteColor) => ({
    r: c.r,
    g: c.g,
    b: c.b,
  }));

  const usedColors = Array.from(usedSet).sort((a, b) => a - b);

  const padIdx = String(modelIndex).padStart(3, '0');
  const name = `model_${padIdx}`;

  return {
    name,
    version: 1,
    bounds: { sizeX, sizeY, sizeZ },
    origin,
    palette,
    usedColors,
    voxels,
    source: { file: path.basename(sourceFile), modelIndex },
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main(): void {
  const args = process.argv.slice(2);

  // Parse args
  let inputPath = '';
  let outputDir = '';
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--output' && i + 1 < args.length) {
      outputDir = args[i + 1];
      i++;
    } else if (!inputPath) {
      inputPath = args[i];
    }
  }

  if (!inputPath || !outputDir) {
    console.error('Usage: npx tsx tools/vox-extract.ts <input.vox> --output <output-dir>');
    process.exit(1);
  }

  const resolvedInput = path.resolve(inputPath);
  const resolvedOutput = path.resolve(outputDir);

  if (!fs.existsSync(resolvedInput)) {
    console.error(`Error: input file not found: ${resolvedInput}`);
    process.exit(1);
  }

  console.log('=== Clawfield VOX Model Extractor ===\n');

  // 1. Parse .vox file
  const voxFile = parseVox(resolvedInput);

  // 2. Create output directory
  fs.mkdirSync(resolvedOutput, { recursive: true });

  // 3. Extract each unique model
  console.log(`\nExtracting ${voxFile.models.length} models...\n`);

  const summaryRows: string[] = [];
  let extracted = 0;
  let skipped = 0;

  for (let i = 0; i < voxFile.models.length; i++) {
    const component = extractModel(voxFile, i, resolvedInput);
    if (!component) {
      skipped++;
      continue;
    }

    const fileName = `${component.name}.component.json`;
    const filePath = path.join(resolvedOutput, fileName);
    fs.writeFileSync(filePath, JSON.stringify(component));

    extracted++;
    const size = fs.statSync(filePath).size;
    summaryRows.push(
      `  ${String(i).padStart(3)} | ${String(component.bounds.sizeX).padStart(3)}x${String(component.bounds.sizeY).padStart(3)}x${String(component.bounds.sizeZ).padStart(3)} | ${String(component.voxels.length).padStart(7)} voxels | ${(size / 1024).toFixed(1).padStart(7)} KB | ${component.name}`
    );
  }

  // 4. Print summary
  console.log('  Idx | Dimensions     |  Voxels  |    Size  | Name');
  console.log('  ----+----------------+----------+----------+------');
  for (const row of summaryRows) {
    console.log(row);
  }

  console.log(`\n=== Extraction complete ===`);
  console.log(`  Extracted: ${extracted} models`);
  console.log(`  Skipped:   ${skipped} (empty)`);
  console.log(`  Output:    ${resolvedOutput}`);
}

main();
