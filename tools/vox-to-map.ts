#!/usr/bin/env node
/**
 * vox-to-map.ts — Convert a MagicaVoxel .vox file to CLWF .map format.
 *
 * Usage:
 *   npx tsx tools/vox-to-map.ts <input.vox> <output-base> [--name "Map Name"]
 *
 * Example:
 *   npx tsx tools/vox-to-map.ts assets/vox/crossroads.vox assets/maps/crossroads --name "Crossroads"
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

const CHUNK_SIZE = 16;
const CHUNK_VOXEL_COUNT = CHUNK_SIZE ** 3;
const MAGIC = 'CLWF';
const VERSION = 1;
const PALETTE_SIZE = 256;
const HEADER_SIZE = 4 + 1 + 4 + 2 + PALETTE_SIZE * 3;
const CHUNK_RECORD_SIZE = 6 + CHUNK_VOXEL_COUNT;

interface RGB { r: number; g: number; b: number }
interface Voxel { x: number; y: number; z: number; colorIndex: number }

// ---------------------------------------------------------------------------
// MagicaVoxel .vox parser (minimal, single-model)
// ---------------------------------------------------------------------------

function parseVox(buf: Buffer): { voxels: Voxel[]; palette: RGB[]; sizeX: number; sizeY: number; sizeZ: number } {
  let offset = 0;

  const magic = buf.toString('ascii', offset, offset + 4); offset += 4;
  if (magic !== 'VOX ') throw new Error(`Not a .vox file (magic: ${magic})`);
  const version = buf.readUInt32LE(offset); offset += 4;
  console.log(`  VOX version: ${version}`);

  // Read MAIN chunk header
  const mainId = buf.toString('ascii', offset, offset + 4); offset += 4;
  const mainContentSize = buf.readUInt32LE(offset); offset += 4;
  const mainChildSize = buf.readUInt32LE(offset); offset += 4;

  let sizeX = 0, sizeY = 0, sizeZ = 0;
  const voxels: Voxel[] = [];
  const palette: RGB[] = new Array(PALETTE_SIZE).fill(null).map(() => ({ r: 0, g: 0, b: 0 }));
  let hasPalette = false;

  const endOffset = offset + mainChildSize;

  while (offset < endOffset && offset < buf.length - 12) {
    const chunkId = buf.toString('ascii', offset, offset + 4); offset += 4;
    const contentSize = buf.readUInt32LE(offset); offset += 4;
    const childSize = buf.readUInt32LE(offset); offset += 4;
    const contentStart = offset;

    switch (chunkId) {
      case 'SIZE':
        sizeX = buf.readUInt32LE(offset); offset += 4;
        sizeY = buf.readUInt32LE(offset); offset += 4;
        sizeZ = buf.readUInt32LE(offset); offset += 4;
        break;

      case 'XYZI': {
        const numVoxels = buf.readUInt32LE(offset); offset += 4;
        for (let i = 0; i < numVoxels; i++) {
          const x = buf.readUInt8(offset); offset += 1;
          const y = buf.readUInt8(offset); offset += 1;
          const z = buf.readUInt8(offset); offset += 1;
          const ci = buf.readUInt8(offset); offset += 1;
          voxels.push({ x, y, z, colorIndex: ci });
        }
        break;
      }

      case 'RGBA': {
        hasPalette = true;
        for (let i = 0; i < 256; i++) {
          const r = buf.readUInt8(offset); offset += 1;
          const g = buf.readUInt8(offset); offset += 1;
          const b = buf.readUInt8(offset); offset += 1;
          const a = buf.readUInt8(offset); offset += 1;
          // RGBA chunk index 0 = palette index 1
          palette[(i + 1) % 256] = { r, g, b };
        }
        break;
      }
    }

    // Skip to end of chunk
    offset = contentStart + contentSize + childSize;
  }

  if (!hasPalette) {
    // Use default MagicaVoxel palette
    console.log('  No palette in file, using defaults');
  }

  return { voxels, palette, sizeX, sizeY, sizeZ };
}

// ---------------------------------------------------------------------------
// Convert voxels to chunked CLWF format
// ---------------------------------------------------------------------------

function voxelsToChunks(
  voxels: Voxel[],
  sizeX: number, sizeY: number, sizeZ: number,
  rotate90: boolean = false,
): Map<string, Uint8Array> {
  const chunks = new Map<string, Uint8Array>();

  for (const v of voxels) {
    // MagicaVoxel coordinate swap: vox(x,y,z) → game(x, z, y)
    // VOX: X=right, Y=depth, Z=up → Game: X=right, Y=up, Z=depth
    let gx = v.x;
    const gy = v.z;  // VOX Z (up) → game Y (up)
    let gz = v.y;  // VOX Y (depth) → game Z (depth)

    // Optional 90° CW rotation around Y (up) axis
    if (rotate90) {
      const oldGx = gx;
      gx = gz;
      gz = sizeX - 1 - oldGx;
    }

    const cx = Math.floor(gx / CHUNK_SIZE);
    const cy = Math.floor(gy / CHUNK_SIZE);
    const cz = Math.floor(gz / CHUNK_SIZE);
    const key = `${cx},${cy},${cz}`;

    let chunk = chunks.get(key);
    if (!chunk) {
      chunk = new Uint8Array(CHUNK_VOXEL_COUNT);
      chunks.set(key, chunk);
    }

    const lx = ((gx % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    const ly = ((gy % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    const lz = ((gz % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;

    chunk[lx + ly * CHUNK_SIZE + lz * CHUNK_SIZE * CHUNK_SIZE] = v.colorIndex;
  }

  return chunks;
}

// ---------------------------------------------------------------------------
// Write CLWF binary
// ---------------------------------------------------------------------------

function writeCLWF(
  chunks: Map<string, Uint8Array>,
  palette: RGB[],
  outputPath: string,
): void {
  const chunkEntries = Array.from(chunks.entries()).filter(([, data]) => {
    for (let i = 0; i < data.length; i++) {
      if (data[i] !== 0) return true;
    }
    return false;
  });

  const totalSize = HEADER_SIZE + chunkEntries.length * CHUNK_RECORD_SIZE;
  const buffer = Buffer.alloc(totalSize);
  let offset = 0;

  // Magic
  buffer.write(MAGIC, offset, 4, 'ascii'); offset += 4;
  // Version
  buffer.writeUInt8(VERSION, offset); offset += 1;
  // Chunk count
  buffer.writeUInt32LE(chunkEntries.length, offset); offset += 4;
  // Palette size
  buffer.writeUInt16LE(PALETTE_SIZE, offset); offset += 2;
  // Palette RGB
  for (let i = 0; i < PALETTE_SIZE; i++) {
    const c = palette[i] ?? { r: 0, g: 0, b: 0 };
    buffer.writeUInt8(c.r, offset); offset += 1;
    buffer.writeUInt8(c.g, offset); offset += 1;
    buffer.writeUInt8(c.b, offset); offset += 1;
  }

  // Chunks
  for (const [key, data] of chunkEntries) {
    const [cx, cy, cz] = key.split(',').map(Number);
    buffer.writeInt16LE(cx, offset); offset += 2;
    buffer.writeInt16LE(cy, offset); offset += 2;
    buffer.writeInt16LE(cz, offset); offset += 2;
    data.forEach((v, i) => { buffer.writeUInt8(v, offset + i); });
    offset += CHUNK_VOXEL_COUNT;
  }

  fs.writeFileSync(outputPath, buffer);
  const sizeMB = (totalSize / 1024 / 1024).toFixed(2);
  console.log(`  Binary map: ${sizeMB} MB (${chunkEntries.length} chunks)`);
}

function writePalette(palette: RGB[], outputPath: string): void {
  const hex = palette.map(c => c ? (c.r << 16) | (c.g << 8) | c.b : 0);
  fs.writeFileSync(outputPath, JSON.stringify(hex, null, 2));
}

function writeMeta(name: string, outputPath: string): void {
  // Spawn points at opposite ends of the map center road
  const meta = {
    name,
    description: `Hand-crafted urban combat map`,
    spawnPoints: {
      alpha: [
        { x: 128, y: 1, z: 3 },
        { x: 100, y: 1, z: 3 },
        { x: 140, y: 1, z: 3 },
      ],
      bravo: [
        { x: 128, y: 1, z: 252 },
        { x: 100, y: 1, z: 252 },
        { x: 155, y: 1, z: 252 },
      ],
    },
    capturePoints: [
      { id: 'A', position: { x: 128, y: 1, z: 60 }, initialOwner: -1 },
      { id: 'B', position: { x: 128, y: 1, z: 128 }, initialOwner: -1 },
      { id: 'C', position: { x: 128, y: 1, z: 196 }, initialOwner: -1 },
    ],
    objectives: [],
    waterIndices: [],
  };
  fs.writeFileSync(outputPath, JSON.stringify(meta, null, 2));
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main(): void {
  const args = process.argv.slice(2);
  if (args.length < 2) {
    console.error('Usage: npx tsx tools/vox-to-map.ts <input.vox> <output-base> [--name "Name"] [--rotate90]');
    process.exit(1);
  }

  const inputPath = path.resolve(args[0]);
  const outputBase = path.resolve(args[1]);
  let name = path.basename(outputBase);
  let rotate90 = false;

  for (let i = 2; i < args.length; i++) {
    if (args[i] === '--name' && args[i + 1]) { name = args[i + 1]; i++; }
    if (args[i] === '--rotate90') { rotate90 = true; }
  }

  console.log(`=== VOX → CLWF Converter ===`);
  console.log(`  Input: ${inputPath}`);
  console.log(`  Output: ${outputBase}`);
  console.log(`  Name: ${name}`);
  if (rotate90) console.log(`  Rotate: 90° CW around Y axis`);

  // Read and parse .vox
  const voxBuf = fs.readFileSync(inputPath);
  console.log(`  File size: ${(voxBuf.length / 1024).toFixed(1)} KB`);

  const { voxels, palette, sizeX, sizeY, sizeZ } = parseVox(voxBuf);
  console.log(`  Model size: ${sizeX} × ${sizeY} × ${sizeZ}`);
  console.log(`  Voxels: ${voxels.length}`);

  // Convert to chunks
  const chunks = voxelsToChunks(voxels, sizeX, sizeY, sizeZ, rotate90);
  console.log(`  Chunks: ${chunks.size}`);

  // Ensure output directory
  fs.mkdirSync(path.dirname(outputBase), { recursive: true });

  // Write files
  writeCLWF(chunks, palette, `${outputBase}.map`);
  writePalette(palette, `${outputBase}.palette.json`);
  writeMeta(name, `${outputBase}.meta.json`);

  console.log(`\n=== Done ===`);
  console.log(`  ${outputBase}.map`);
  console.log(`  ${outputBase}.palette.json`);
  console.log(`  ${outputBase}.meta.json`);
}

main();
