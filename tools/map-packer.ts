/**
 * map-packer.ts
 *
 * Converts JSON map data (chunks + palette) into a compact binary
 * .map file for fast loading at runtime.
 *
 * Usage:
 *   npx tsx tools/map-packer.ts <chunks.json> <palette.json> <output.map>
 *
 * Example:
 *   npx tsx tools/map-packer.ts assets/maps/shoreline.chunks.json assets/maps/shoreline.palette.json assets/maps/shoreline.map
 *
 * Binary format:
 *   Header:
 *     magic:        "CLWF"  (4 bytes, ASCII)
 *     version:      u8 = 1  (1 byte)
 *     chunkCount:   u32 LE  (4 bytes)
 *     paletteSize:  u16 LE  (2 bytes) = 256
 *     palette:      [r:u8, g:u8, b:u8] x 256  (768 bytes)
 *
 *   Chunks (repeated chunkCount times):
 *     cx:     i16 LE  (2 bytes)
 *     cy:     i16 LE  (2 bytes)
 *     cz:     i16 LE  (2 bytes)
 *     voxels: u8[4096] (4096 bytes = 16^3)
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAGIC = 'CLWF';
const VERSION = 1;
const PALETTE_SIZE = 256;
const CHUNK_VOXEL_COUNT = 16 * 16 * 16; // 4096

// Header layout:
//   magic (4) + version (1) + chunkCount (4) + paletteSize (2) + palette (768)
const HEADER_SIZE = 4 + 1 + 4 + 2 + PALETTE_SIZE * 3; // 779 bytes

// Per-chunk layout:
//   cx (2) + cy (2) + cz (2) + voxels (4096)
const CHUNK_RECORD_SIZE = 2 + 2 + 2 + CHUNK_VOXEL_COUNT; // 4102 bytes

// ---------------------------------------------------------------------------
// Types matching the JSON formats
// ---------------------------------------------------------------------------

interface PaletteColor {
  r: number;
  g: number;
  b: number;
}

interface ChunkData {
  key: string;
  voxels: number[];
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main(): void {
  const args = process.argv.slice(2);

  if (args.length < 3) {
    console.error(
      'Usage: npx tsx tools/map-packer.ts <chunks.json> <palette.json> <output.map>'
    );
    process.exit(1);
  }

  const chunksPath = path.resolve(args[0]);
  const palettePath = path.resolve(args[1]);
  const outputPath = path.resolve(args[2]);

  // Validate inputs exist
  if (!fs.existsSync(chunksPath)) {
    console.error(`Error: chunks file not found: ${chunksPath}`);
    process.exit(1);
  }
  if (!fs.existsSync(palettePath)) {
    console.error(`Error: palette file not found: ${palettePath}`);
    process.exit(1);
  }

  console.log('=== Clawfield Map Packer ===\n');

  // -------------------------------------------------------------------------
  // 1. Read palette (small file, straightforward)
  // -------------------------------------------------------------------------
  console.log(`Reading palette from ${palettePath}...`);
  const paletteRaw = fs.readFileSync(palettePath, 'utf-8');
  const palette: PaletteColor[] = JSON.parse(paletteRaw);

  if (palette.length < PALETTE_SIZE) {
    console.error(
      `Error: expected at least ${PALETTE_SIZE} palette entries, got ${palette.length}`
    );
    process.exit(1);
  }
  if (palette.length > PALETTE_SIZE) {
    console.log(
      `  Palette has ${palette.length} entries, truncating to ${PALETTE_SIZE} (extra entries unused by u8 voxel indices)`
    );
    palette.length = PALETTE_SIZE;
  }
  console.log(`  Palette: ${palette.length} colors loaded`);

  // -------------------------------------------------------------------------
  // 2. Read chunks (large file -- parse in one go, Node handles it fine)
  // -------------------------------------------------------------------------
  console.log(`Reading chunks from ${chunksPath}...`);
  const chunksFileSize = fs.statSync(chunksPath).size;
  console.log(
    `  File size: ${(chunksFileSize / 1024 / 1024).toFixed(1)} MB`
  );

  const startParse = performance.now();
  const chunksRaw = fs.readFileSync(chunksPath, 'utf-8');
  const parseReadMs = performance.now() - startParse;
  console.log(`  Read time: ${(parseReadMs / 1000).toFixed(1)}s`);

  const startJson = performance.now();
  const chunks: ChunkData[] = JSON.parse(chunksRaw);
  const jsonMs = performance.now() - startJson;
  console.log(`  JSON parse time: ${(jsonMs / 1000).toFixed(1)}s`);
  console.log(`  Chunks loaded: ${chunks.length}`);

  // -------------------------------------------------------------------------
  // 3. Allocate output buffer
  // -------------------------------------------------------------------------
  const totalSize = HEADER_SIZE + chunks.length * CHUNK_RECORD_SIZE;
  console.log(
    `\nAllocating output buffer: ${(totalSize / 1024 / 1024).toFixed(1)} MB`
  );

  const buffer = Buffer.alloc(totalSize);
  let offset = 0;

  // -------------------------------------------------------------------------
  // 4. Write header
  // -------------------------------------------------------------------------
  // Magic: "CLWF" (4 bytes ASCII)
  buffer.write(MAGIC, offset, 4, 'ascii');
  offset += 4;

  // Version: u8
  buffer.writeUInt8(VERSION, offset);
  offset += 1;

  // Chunk count: u32 LE
  buffer.writeUInt32LE(chunks.length, offset);
  offset += 4;

  // Palette size: u16 LE
  buffer.writeUInt16LE(PALETTE_SIZE, offset);
  offset += 2;

  // Palette: 256 x (r, g, b)
  for (let i = 0; i < PALETTE_SIZE; i++) {
    const color = palette[i];
    buffer.writeUInt8(color.r, offset);
    offset += 1;
    buffer.writeUInt8(color.g, offset);
    offset += 1;
    buffer.writeUInt8(color.b, offset);
    offset += 1;
  }

  console.log(`  Header written: ${offset} bytes`);

  // -------------------------------------------------------------------------
  // 5. Write chunks
  // -------------------------------------------------------------------------
  console.log(`\nPacking ${chunks.length} chunks...`);

  const startPack = performance.now();
  const progressInterval = Math.max(1, Math.floor(chunks.length / 20));

  for (let ci = 0; ci < chunks.length; ci++) {
    if (ci % progressInterval === 0) {
      const pct = ((ci / chunks.length) * 100).toFixed(0);
      process.stdout.write(
        `  Progress: ${pct}% (${ci.toLocaleString()}/${chunks.length.toLocaleString()} chunks)\r`
      );
    }

    const chunk = chunks[ci];

    // Parse chunk key "cx,cy,cz"
    const parts = chunk.key.split(',');
    const cx = parseInt(parts[0], 10);
    const cy = parseInt(parts[1], 10);
    const cz = parseInt(parts[2], 10);

    // cx: i16 LE
    buffer.writeInt16LE(cx, offset);
    offset += 2;

    // cy: i16 LE
    buffer.writeInt16LE(cy, offset);
    offset += 2;

    // cz: i16 LE
    buffer.writeInt16LE(cz, offset);
    offset += 2;

    // voxels: u8[4096]
    const voxels = chunk.voxels;
    for (let vi = 0; vi < CHUNK_VOXEL_COUNT; vi++) {
      buffer.writeUInt8(voxels[vi] ?? 0, offset);
      offset += 1;
    }
  }

  const packMs = performance.now() - startPack;
  process.stdout.write(
    `  Progress: 100% (${chunks.length.toLocaleString()}/${chunks.length.toLocaleString()} chunks)\n`
  );
  console.log(`  Pack time: ${(packMs / 1000).toFixed(1)}s`);

  // -------------------------------------------------------------------------
  // 6. Write output file
  // -------------------------------------------------------------------------
  console.log(`\nWriting binary map to ${outputPath}...`);
  fs.writeFileSync(outputPath, buffer);

  // -------------------------------------------------------------------------
  // 7. Summary
  // -------------------------------------------------------------------------
  const outputSize = fs.statSync(outputPath).size;
  const ratio = chunksFileSize / outputSize;
  const totalMs = performance.now() - startParse;

  console.log('\n=== Packing complete ===');
  console.log(`  Input chunks:  ${(chunksFileSize / 1024 / 1024).toFixed(1)} MB (JSON)`);
  console.log(`  Output binary: ${(outputSize / 1024 / 1024).toFixed(1)} MB (.map)`);
  console.log(`  Compression:   ${ratio.toFixed(1)}x smaller`);
  console.log(`  Chunk count:   ${chunks.length.toLocaleString()}`);
  console.log(`  Header size:   ${HEADER_SIZE} bytes`);
  console.log(`  Per-chunk:     ${CHUNK_RECORD_SIZE} bytes (6 coord + 4096 voxels)`);
  console.log(`  Total time:    ${(totalMs / 1000).toFixed(1)}s`);
  console.log(`  Output:        ${outputPath}`);
}

main();
