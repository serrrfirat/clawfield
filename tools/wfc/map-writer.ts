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

/**
 * Build a unified palette from all tile palettes, remapping voxel color indices.
 */
function buildUnifiedPalette(
  result: SolveResult,
  variants: TileVariant[],
  tilePalettes: Map<string, RGB[]>,
): { palette: RGB3[]; remappedGrid: Uint8Array[][] } {
  const palette: RGB3[] = new Array(PALETTE_SIZE).fill(null).map(() => ({ r: 0, g: 0, b: 0 }));
  let nextFree = 1; // index 0 = air

  // Map from tile name → remap table (old index → new index)
  const remapTables = new Map<string, Uint8Array>();

  // Build remap for each tile's palette
  for (const [name, tilePal] of tilePalettes) {
    const remap = new Uint8Array(256);
    remap[0] = 0;
    for (let i = 1; i < tilePal.length && i < 256; i++) {
      const c = tilePal[i];
      if (c.r === 0 && c.g === 0 && c.b === 0) { remap[i] = 0; continue; }

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

  // Remap all tile voxels
  const { grid, width, depth } = result;
  const remappedGrid: Uint8Array[][] = [];
  for (let z = 0; z < depth; z++) {
    remappedGrid[z] = [];
    for (let x = 0; x < width; x++) {
      const cell = grid[z][x];
      if (cell.collapsed === null) {
        remappedGrid[z][x] = new Uint8Array(CHUNK_VOXEL_COUNT);
        continue;
      }
      const variant = variants[cell.collapsed];
      const remap = remapTables.get(variant.spec.name)!;
      const remapped = new Uint8Array(CHUNK_VOXEL_COUNT);
      for (let i = 0; i < CHUNK_VOXEL_COUNT; i++) {
        remapped[i] = remap[variant.voxels[i]];
      }
      remappedGrid[z][x] = remapped;
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
  const { width, depth } = result;

  // Collect non-empty chunks
  // Each WFC tile = one chunk (16³). Chunk coords = tile coords.
  const nonEmpty: { cx: number; cy: number; cz: number; data: Uint8Array }[] = [];
  for (let z = 0; z < depth; z++) {
    for (let x = 0; x < width; x++) {
      const data = remappedGrid[z][x];
      let empty = true;
      for (let i = 0; i < data.length; i++) {
        if (data[i] !== 0) { empty = false; break; }
      }
      if (!empty) {
        nonEmpty.push({ cx: x, cy: 0, cz: z, data });
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
    height: CHUNK_SIZE,
    tileSize: CHUNK_SIZE,
    gridWidth: width,
    gridDepth: depth,
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
