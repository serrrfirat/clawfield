/**
 * map-writer.ts — Write CLWF binary .map + .palette.json + .meta.json
 *
 * Output format matches apps/server/src/map-loader.ts expectations exactly.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ClassifiedGrid, MapMeta, RGB } from './types.js';

const CHUNK_SIZE = 16;
const CHUNK_VOXEL_COUNT = CHUNK_SIZE ** 3; // 4096
const MAGIC = 'CLWF';
const VERSION = 1;
const PALETTE_SIZE = 256;
const HEADER_SIZE = 4 + 1 + 4 + 2 + PALETTE_SIZE * 3; // 779 bytes
const CHUNK_RECORD_SIZE = 6 + CHUNK_VOXEL_COUNT; // 4102 bytes

/**
 * Write the complete map output: .map binary + .palette.json + .meta.json
 */
export function writeMap(
  grid: ClassifiedGrid,
  meta: MapMeta | null,
  outputBase: string,
): void {
  console.log('Writing map files...');

  // Ensure output directory exists
  const dir = path.dirname(outputBase);
  fs.mkdirSync(dir, { recursive: true });

  // Write binary .map
  writeCLWF(grid, `${outputBase}.map`);

  // Write palette JSON
  writePalette(grid.palette, `${outputBase}.palette.json`);

  // Write metadata JSON
  if (meta) {
    writeMeta(meta, `${outputBase}.meta.json`);
  }
}

function writeCLWF(grid: ClassifiedGrid, outputPath: string): void {
  const chunkEntries = Array.from(grid.chunks.entries());

  // Filter to non-empty chunks
  const nonEmpty = chunkEntries.filter(([, data]) => {
    for (let i = 0; i < data.length; i++) {
      if (data[i] !== 0) return true;
    }
    return false;
  });

  console.log(`  Writing ${nonEmpty.length} non-empty chunks to ${path.basename(outputPath)}...`);

  const totalSize = HEADER_SIZE + nonEmpty.length * CHUNK_RECORD_SIZE;
  const buffer = Buffer.alloc(totalSize);
  let offset = 0;

  // Header: magic
  buffer.write(MAGIC, offset, 4, 'ascii');
  offset += 4;

  // Header: version
  buffer.writeUInt8(VERSION, offset);
  offset += 1;

  // Header: chunk count
  buffer.writeUInt32LE(nonEmpty.length, offset);
  offset += 4;

  // Header: palette size
  buffer.writeUInt16LE(PALETTE_SIZE, offset);
  offset += 2;

  // Header: palette (256 × RGB)
  for (let i = 0; i < PALETTE_SIZE; i++) {
    const c = grid.palette[i] ?? { r: 0, g: 0, b: 0 };
    buffer.writeUInt8(c.r, offset); offset += 1;
    buffer.writeUInt8(c.g, offset); offset += 1;
    buffer.writeUInt8(c.b, offset); offset += 1;
  }

  // Chunks
  for (const [key, data] of nonEmpty) {
    const [cx, cy, cz] = key.split(',').map(Number);
    buffer.writeInt16LE(cx, offset); offset += 2;
    buffer.writeInt16LE(cy, offset); offset += 2;
    buffer.writeInt16LE(cz, offset); offset += 2;

    for (let i = 0; i < CHUNK_VOXEL_COUNT; i++) {
      buffer.writeUInt8(data[i], offset);
      offset += 1;
    }
  }

  fs.writeFileSync(outputPath, buffer);
  const sizeMB = (totalSize / 1024 / 1024).toFixed(2);
  console.log(`  Binary map: ${sizeMB} MB (${nonEmpty.length} chunks)`);
}

function writePalette(palette: RGB[], outputPath: string): void {
  const hexPalette = palette.map(c => {
    if (!c) return 0;
    return (c.r << 16) | (c.g << 8) | c.b;
  });

  fs.writeFileSync(outputPath, JSON.stringify(hexPalette, null, 2));
  console.log(`  Palette: ${path.basename(outputPath)}`);
}

function writeMeta(meta: MapMeta, outputPath: string): void {
  const output = {
    name: meta.name,
    description: meta.description,
    spawnPoints: meta.spawnPoints,
    capturePoints: meta.capturePoints,
    objectives: meta.objectives,
    waterIndices: meta.waterIndices,
  };

  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
  console.log(`  Metadata: ${path.basename(outputPath)}`);
  console.log(`    Spawns: Alpha=${meta.spawnPoints.alpha.length}, Bravo=${meta.spawnPoints.bravo.length}`);
  console.log(`    Capture points: ${meta.capturePoints.length}`);
}
