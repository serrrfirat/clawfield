/**
 * Loads tile specs from tileset.json, parses .vox files, and generates
 * rotated variants for the WFC solver.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { TileSpec, TileVariant, VoxVoxel, RGB } from './types.js';
import { rotateTile } from './rotation.js';

const SIZE = 16;

function idx(x: number, y: number, z: number): number {
  return x + z * SIZE + y * SIZE * SIZE;
}

/**
 * Minimal .vox parser (single-model files only).
 * Reuses the same logic as map-compose.ts parseVoxBinary.
 */
function parseVox(buf: Buffer): { voxels: VoxVoxel[]; palette: RGB[]; sizeX: number; sizeY: number; sizeZ: number } {
  let offset = 0;
  const magic = buf.toString('ascii', offset, offset + 4); offset += 4;
  if (magic !== 'VOX ') throw new Error(`Not a .vox file (magic: ${magic})`);
  offset += 4; // version

  offset += 4; // mainId
  offset += 4; // mainContentSize
  const mainChildSize = buf.readUInt32LE(offset); offset += 4;

  let sizeX = 0, sizeY = 0, sizeZ = 0;
  const voxels: VoxVoxel[] = [];
  const palette: RGB[] = new Array(256).fill(null).map(() => ({ r: 0, g: 0, b: 0 }));

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
        const n = buf.readUInt32LE(offset); offset += 4;
        for (let i = 0; i < n; i++) {
          const x = buf.readUInt8(offset++);
          const y = buf.readUInt8(offset++);
          const z = buf.readUInt8(offset++);
          const ci = buf.readUInt8(offset++);
          voxels.push({ x, y, z, colorIndex: ci });
        }
        break;
      }
      case 'RGBA':
        for (let i = 0; i < 256; i++) {
          const r = buf.readUInt8(offset++);
          const g = buf.readUInt8(offset++);
          const b = buf.readUInt8(offset++);
          offset++; // alpha
          palette[(i + 1) % 256] = { r, g, b };
        }
        break;
    }
    offset = contentStart + contentSize + childSize;
  }

  return { voxels, palette, sizeX, sizeY, sizeZ };
}

/**
 * Convert sparse voxel list to a flat 16³ Uint8Array.
 * MagicaVoxel uses (x, z, y) with Z up; we store (x, y, z) with Y up.
 * So MV.z → our Y, MV.y → our Z.
 */
function voxelsToGrid(voxels: VoxVoxel[]): Uint8Array {
  const grid = new Uint8Array(SIZE * SIZE * SIZE);
  for (const v of voxels) {
    const x = v.x;
    const y = v.z; // MV Z-up → our Y-up
    const z = v.y;
    if (x < SIZE && y < SIZE && z < SIZE) {
      grid[idx(x, y, z)] = v.colorIndex;
    }
  }
  return grid;
}

/**
 * Load all tile specs and generate variants (with rotations).
 */
export function loadTiles(tilesetPath: string): { variants: TileVariant[]; palettes: Map<string, RGB[]> } {
  const dir = path.dirname(tilesetPath);
  const specs: TileSpec[] = JSON.parse(fs.readFileSync(tilesetPath, 'utf-8'));
  const variants: TileVariant[] = [];
  const palettes = new Map<string, RGB[]>();

  for (const spec of specs) {
    const voxPath = path.resolve(dir, spec.file);
    const buf = fs.readFileSync(voxPath);
    const parsed = parseVox(buf as Buffer);
    const baseVoxels = voxelsToGrid(parsed.voxels);
    palettes.set(spec.name, parsed.palette);

    // Add base variant (rotation 0)
    variants.push({ spec, rotation: 0, sockets: { ...spec.sockets }, voxels: baseVoxels });

    // Add rotated variants if tile is rotatable
    if (spec.rotatable) {
      for (let r = 1; r <= 3; r++) {
        const rotated = rotateTile(baseVoxels, spec.sockets, r);
        variants.push({ spec, rotation: r, sockets: rotated.sockets, voxels: rotated.voxels });
      }
    }
  }

  return { variants, palettes };
}
