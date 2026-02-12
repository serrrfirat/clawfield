/**
 * Writes a collapsed WFC grid to CLWF binary format (.map + .meta.json + .palette.json).
 * Same binary format as map-compose.ts.
 */

import * as fs from 'node:fs';
import type { SolveResult } from './solver.js';
import type { TileVariant, RGB, GameplayMeta } from './types.js';

const CHUNK_SIZE = 16;
const CHUNK_VOXEL_COUNT = CHUNK_SIZE ** 3; // 4096
const MAGIC = 'CLWF';
const VERSION = 1;
const PALETTE_SIZE = 256;
const HEADER_SIZE = 4 + 1 + 4 + 2 + PALETTE_SIZE * 3; // 779 bytes
const CHUNK_RECORD_SIZE = 6 + CHUNK_VOXEL_COUNT; // 4102 bytes

interface RGB3 { r: number; g: number; b: number }

function colorDistance(a: RGB3, b: RGB3): number {
  const dr = a.r - b.r;
  const dg = a.g - b.g;
  const db = a.b - b.b;
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

interface RemappedCell {
  base: Uint8Array;
  stacks: { level: number; data: Uint8Array }[];
}

/**
 * Build a unified palette from all tile palettes, remapping voxel color indices.
 * Also remaps stack layer voxels for vertical chunks.
 */
function buildUnifiedPalette(
  result: SolveResult,
  variants: TileVariant[],
  tilePalettes: Map<string, RGB[]>,
): { palette: RGB3[]; remappedGrid: RemappedCell[][] } {
  const palette: RGB3[] = new Array(PALETTE_SIZE).fill(null).map(() => ({ r: 0, g: 0, b: 0 }));
  let nextFree = 1; // index 0 = air

  // Map from palette name → remap table (old index → new index)
  const remapTables = new Map<string, Uint8Array>();

  // Build remap for each tile's palette
  for (const [name, tilePal] of tilePalettes) {
    const remap = new Uint8Array(256);
    remap[0] = 0;
    for (let i = 1; i < tilePal.length && i < 256; i++) {
      const c = tilePal[i];
      // Only treat high palette indices (>200) with true black as air;
      // low indices may legitimately use black (asphalt, outlines, etc.)
      if (c.r === 0 && c.g === 0 && c.b === 0 && i > 200) { remap[i] = 0; continue; }

      // Check existing palette for close match
      let found = -1;
      for (let j = 1; j < nextFree; j++) {
        if (colorDistance(palette[j], c) <= 4) { found = j; break; }
      }
      if (found >= 0) {
        remap[i] = found;
      } else if (nextFree < PALETTE_SIZE) {
        palette[nextFree] = { ...c };
        remap[i] = nextFree;
        nextFree++;
      } else {
        // Overflow: find nearest
        let bestIdx = 1, bestDist = Infinity;
        for (let j = 1; j < PALETTE_SIZE; j++) {
          const d = colorDistance(palette[j], c);
          if (d < bestDist) { bestDist = d; bestIdx = j; }
        }
        remap[i] = bestIdx;
      }
    }
    remapTables.set(name, remap);
  }

  // Remap all tile voxels (base + stack layers)
  const { grid, width, depth } = result;
  const remappedGrid: RemappedCell[][] = [];
  for (let z = 0; z < depth; z++) {
    remappedGrid[z] = [];
    for (let x = 0; x < width; x++) {
      const cell = grid[z][x];
      if (cell.collapsed === null) {
        remappedGrid[z][x] = { base: new Uint8Array(CHUNK_VOXEL_COUNT), stacks: [] };
        continue;
      }
      const variant = variants[cell.collapsed];
      const baseRemap = remapTables.get(variant.spec.name)!;
      const remappedBase = new Uint8Array(CHUNK_VOXEL_COUNT);
      for (let i = 0; i < CHUNK_VOXEL_COUNT; i++) {
        remappedBase[i] = baseRemap[variant.voxels[i]];
      }

      // Remap stack layers
      const stacks: { level: number; data: Uint8Array }[] = [];
      if (variant.stackLayers) {
        for (const sl of variant.stackLayers) {
          const slRemap = remapTables.get(sl.paletteName) ?? baseRemap;
          const remappedSl = new Uint8Array(CHUNK_VOXEL_COUNT);
          for (let i = 0; i < CHUNK_VOXEL_COUNT; i++) {
            remappedSl[i] = slRemap[sl.voxels[i]];
          }
          stacks.push({ level: sl.level, data: remappedSl });
        }
      }

      remappedGrid[z][x] = { base: remappedBase, stacks };
    }
  }

  return { palette, remappedGrid };
}

/**
 * Write the collapsed grid as a CLWF .map binary file.
 */
export function writeMap(
  outputPath: string,
  result: SolveResult,
  variants: TileVariant[],
  tilePalettes: Map<string, RGB[]>,
  gameplay: GameplayMeta,
): void {
  const { palette, remappedGrid } = buildUnifiedPalette(result, variants, tilePalettes);
  const { grid, width, depth } = result;

  // Ground-fill pass: ensure y=0 layer has no air holes (prevents fall-through).
  // Only applies to base chunks (cy=0), not upper floors.
  // Detect ground color from the most common non-zero voxel at y=0 across grass tiles.
  let groundColor = 1; // fallback
  const colorCounts = new Map<number, number>();
  for (let z = 0; z < depth; z++) {
    for (let x = 0; x < width; x++) {
      const cell = grid[z][x];
      if (cell.collapsed === null) continue;
      const variant = variants[cell.collapsed];
      if (!variant.spec.tags.includes('grass')) continue;
      const data = remappedGrid[z][x].base;
      for (let gz = 0; gz < CHUNK_SIZE; gz++) {
        for (let gx = 0; gx < CHUNK_SIZE; gx++) {
          const idx = gx + 0 * CHUNK_SIZE + gz * CHUNK_SIZE * CHUNK_SIZE; // y=0
          const c = data[idx];
          if (c !== 0) colorCounts.set(c, (colorCounts.get(c) || 0) + 1);
        }
      }
    }
  }
  let maxCount = 0;
  for (const [c, count] of colorCounts) {
    if (count > maxCount) { maxCount = count; groundColor = c; }
  }

  // Fill air at y=0 in every non-empty base chunk
  let holesFilled = 0;
  for (let z = 0; z < depth; z++) {
    for (let x = 0; x < width; x++) {
      const data = remappedGrid[z][x].base;
      let hasVoxels = false;
      for (let i = 0; i < data.length; i++) {
        if (data[i] !== 0) { hasVoxels = true; break; }
      }
      if (!hasVoxels) continue;
      for (let gz = 0; gz < CHUNK_SIZE; gz++) {
        for (let gx = 0; gx < CHUNK_SIZE; gx++) {
          const idx = gx + 0 * CHUNK_SIZE + gz * CHUNK_SIZE * CHUNK_SIZE; // y=0
          if (data[idx] === 0) {
            data[idx] = groundColor;
            holesFilled++;
          }
        }
      }
    }
  }
  if (holesFilled > 0) {
    console.log(`  Ground-fill: patched ${holesFilled} holes at y=0 (color index ${groundColor})`);
  }

  // Collect non-empty chunks (base at cy=0 + stacked at cy=1, cy=2, ...)
  const nonEmpty: { cx: number; cy: number; cz: number; data: Uint8Array }[] = [];
  let maxCy = 0;
  for (let z = 0; z < depth; z++) {
    for (let x = 0; x < width; x++) {
      const cell = remappedGrid[z][x];
      // Base chunk (cy=0)
      const baseData = cell.base;
      let baseEmpty = true;
      for (let i = 0; i < baseData.length; i++) {
        if (baseData[i] !== 0) { baseEmpty = false; break; }
      }
      if (!baseEmpty) {
        nonEmpty.push({ cx: x, cy: 0, cz: z, data: baseData });
      }
      // Stacked chunks (cy=1, cy=2, ...)
      for (const stack of cell.stacks) {
        let stackEmpty = true;
        for (let i = 0; i < stack.data.length; i++) {
          if (stack.data[i] !== 0) { stackEmpty = false; break; }
        }
        if (!stackEmpty) {
          nonEmpty.push({ cx: x, cy: stack.level, cz: z, data: stack.data });
          if (stack.level > maxCy) maxCy = stack.level;
        }
      }
    }
  }

  console.log(`  Writing ${nonEmpty.length} non-empty chunks...`);

  const totalSize = HEADER_SIZE + nonEmpty.length * CHUNK_RECORD_SIZE;
  const buffer = Buffer.alloc(totalSize);
  let offset = 0;

  // Header
  buffer.write(MAGIC, offset, 4, 'ascii'); offset += 4;
  buffer.writeUInt8(VERSION, offset); offset += 1;
  buffer.writeUInt32LE(nonEmpty.length, offset); offset += 4;
  buffer.writeUInt16LE(PALETTE_SIZE, offset); offset += 2;

  // Palette
  for (let i = 0; i < PALETTE_SIZE; i++) {
    const c = palette[i];
    buffer.writeUInt8(c.r, offset); offset += 1;
    buffer.writeUInt8(c.g, offset); offset += 1;
    buffer.writeUInt8(c.b, offset); offset += 1;
  }

  // Chunk records
  for (const chunk of nonEmpty) {
    buffer.writeInt16LE(chunk.cx, offset); offset += 2;
    buffer.writeInt16LE(chunk.cy, offset); offset += 2;
    buffer.writeInt16LE(chunk.cz, offset); offset += 2;
    for (let i = 0; i < CHUNK_VOXEL_COUNT; i++) {
      buffer.writeUInt8(chunk.data[i], offset); offset += 1;
    }
  }

  fs.writeFileSync(outputPath, buffer);
  console.log(`  Binary map: ${(totalSize / 1024 / 1024).toFixed(2)} MB`);

  // Write meta
  const metaPath = outputPath.replace(/\.map$/, '.meta.json');
  const meta = {
    name: outputPath.split('/').pop()?.replace('.map', '') || 'incursion',
    generator: 'wfc',
    width: width * CHUNK_SIZE,
    depth: depth * CHUNK_SIZE,
    height: (maxCy + 1) * CHUNK_SIZE,
    tileSize: CHUNK_SIZE,
    gridWidth: width,
    gridDepth: depth,
    gridHeight: maxCy + 1,
    gameplay,
  };
  fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));

  // Write palette
  const palettePath = outputPath.replace(/\.map$/, '.palette.json');
  const palJson = palette.map((c, i) => ({ index: i, r: c.r, g: c.g, b: c.b }));
  fs.writeFileSync(palettePath, JSON.stringify(palJson, null, 2));

  console.log(`  Wrote: ${outputPath}`);
  console.log(`  Wrote: ${metaPath}`);
  console.log(`  Wrote: ${palettePath}`);
}
