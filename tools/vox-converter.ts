/**
 * vox-converter.ts
 *
 * Converts a MagicaVoxel .vox file (with scene graph) into Clawfield's
 * chunk-based voxel format.
 *
 * Usage:  npx tsx tools/vox-converter.ts [path-to-vox] [output-prefix]
 * Example: npx tsx tools/vox-converter.ts assets/vox/shoreline_mvp.vox assets/maps/shoreline
 *
 * Outputs:
 *   <prefix>.chunks.json  — Array of { key, voxels }
 *   <prefix>.palette.json — Array of { r, g, b } for indices 0-255
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

// ---------------------------------------------------------------------------
// Constants (mirrors packages/shared/src/constants.ts)
// ---------------------------------------------------------------------------
const CHUNK_SIZE = 16;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface VoxModel {
  sizeX: number;
  sizeY: number;
  sizeZ: number;
  voxels: { x: number; y: number; z: number; colorIndex: number }[];
}

interface PaletteColor {
  r: number;
  g: number;
  b: number;
  a: number;
}

// Scene graph node types
interface TransformNode {
  type: 'nTRN';
  nodeId: number;
  attributes: Map<string, string>;
  childNodeId: number;
  layerId: number;
  frames: Map<string, string>[]; // each frame is a dict
}

interface GroupNode {
  type: 'nGRP';
  nodeId: number;
  attributes: Map<string, string>;
  childNodeIds: number[];
}

interface ShapeNode {
  type: 'nSHP';
  nodeId: number;
  attributes: Map<string, string>;
  models: { modelId: number; attributes: Map<string, string> }[];
}

type SceneNode = TransformNode | GroupNode | ShapeNode;

// ---------------------------------------------------------------------------
// Binary reader helper
// ---------------------------------------------------------------------------

class BinaryReader {
  private view: DataView;
  public offset: number;
  private buf: Buffer;

  constructor(buffer: Buffer) {
    this.buf = buffer;
    this.view = new DataView(
      buffer.buffer,
      buffer.byteOffset,
      buffer.byteLength
    );
    this.offset = 0;
  }

  get remaining(): number {
    return this.buf.byteLength - this.offset;
  }

  readUint8(): number {
    const v = this.view.getUint8(this.offset);
    this.offset += 1;
    return v;
  }

  readInt32(): number {
    const v = this.view.getInt32(this.offset, true);
    this.offset += 4;
    return v;
  }

  readUint32(): number {
    const v = this.view.getUint32(this.offset, true);
    this.offset += 4;
    return v;
  }

  readString(len: number): string {
    const slice = this.buf.subarray(this.offset, this.offset + len);
    this.offset += len;
    return slice.toString('ascii');
  }

  readDict(): Map<string, string> {
    const numPairs = this.readInt32();
    const dict = new Map<string, string>();
    for (let i = 0; i < numPairs; i++) {
      const keyLen = this.readInt32();
      const key = this.readString(keyLen);
      const valLen = this.readInt32();
      const val = this.readString(valLen);
      dict.set(key, val);
    }
    return dict;
  }

  skip(n: number): void {
    this.offset += n;
  }
}

// ---------------------------------------------------------------------------
// .vox parser
// ---------------------------------------------------------------------------

interface VoxFile {
  models: VoxModel[];
  palette: PaletteColor[];
  nodes: Map<number, SceneNode>;
}

function parseVox(filePath: string): VoxFile {
  console.log(`Reading ${filePath}...`);
  const buffer = fs.readFileSync(filePath);
  console.log(`  File size: ${(buffer.byteLength / 1024 / 1024).toFixed(1)} MB`);

  const reader = new BinaryReader(buffer);

  // Magic number
  const magic = reader.readString(4);
  if (magic !== 'VOX ') {
    throw new Error(`Invalid VOX file: magic = "${magic}"`);
  }

  const version = reader.readUint32();
  console.log(`  VOX version: ${version}`);

  // MAIN chunk
  const mainId = reader.readString(4);
  if (mainId !== 'MAIN') {
    throw new Error(`Expected MAIN chunk, got "${mainId}"`);
  }
  const mainContentSize = reader.readUint32();
  const mainChildrenSize = reader.readUint32();

  // Skip MAIN content (should be 0)
  reader.skip(mainContentSize);

  // Parse children of MAIN
  const models: VoxModel[] = [];
  const palette: PaletteColor[] = new Array(256);
  const nodes = new Map<number, SceneNode>();

  // Temporary: SIZE chunks precede XYZI chunks. We accumulate them.
  let pendingSize: { x: number; y: number; z: number } | null = null;

  // Default palette (MagicaVoxel default — we'll overwrite if RGBA is present)
  for (let i = 0; i < 256; i++) {
    palette[i] = { r: 0, g: 0, b: 0, a: 255 };
  }

  const mainEnd = reader.offset + mainChildrenSize;

  while (reader.offset < mainEnd) {
    if (reader.remaining < 12) break;

    const chunkId = reader.readString(4);
    const contentSize = reader.readUint32();
    const childrenSize = reader.readUint32();
    const chunkStart = reader.offset;

    switch (chunkId) {
      case 'SIZE': {
        const x = reader.readUint32();
        const y = reader.readUint32();
        const z = reader.readUint32();
        pendingSize = { x, y, z };
        break;
      }

      case 'XYZI': {
        const numVoxels = reader.readUint32();
        const voxels: VoxModel['voxels'] = new Array(numVoxels);
        for (let i = 0; i < numVoxels; i++) {
          const vx = reader.readUint8();
          const vy = reader.readUint8();
          const vz = reader.readUint8();
          const ci = reader.readUint8();
          voxels[i] = { x: vx, y: vy, z: vz, colorIndex: ci };
        }
        models.push({
          sizeX: pendingSize?.x ?? 0,
          sizeY: pendingSize?.y ?? 0,
          sizeZ: pendingSize?.z ?? 0,
          voxels,
        });
        pendingSize = null;
        break;
      }

      case 'RGBA': {
        for (let i = 0; i < 256; i++) {
          const r = reader.readUint8();
          const g = reader.readUint8();
          const b = reader.readUint8();
          const a = reader.readUint8();
          // RGBA chunk: index 0 in chunk = palette index 1, ..., index 254 = palette index 255
          // Index 255 in the chunk is unused. Palette index 0 is always empty/air.
          palette[i + 1] = { r, g, b, a };
        }
        // palette[0] stays as air
        palette[0] = { r: 0, g: 0, b: 0, a: 0 };
        break;
      }

      case 'nTRN': {
        const nodeId = reader.readUint32();
        const attributes = reader.readDict();
        const childNodeId = reader.readInt32();
        const _reservedId = reader.readInt32(); // -1
        const layerId = reader.readInt32();
        const numFrames = reader.readInt32();
        const frames: Map<string, string>[] = [];
        for (let i = 0; i < numFrames; i++) {
          frames.push(reader.readDict());
        }
        nodes.set(nodeId, {
          type: 'nTRN',
          nodeId,
          attributes,
          childNodeId,
          layerId,
          frames,
        });
        break;
      }

      case 'nGRP': {
        const nodeId = reader.readUint32();
        const attributes = reader.readDict();
        const numChildren = reader.readInt32();
        const childNodeIds: number[] = [];
        for (let i = 0; i < numChildren; i++) {
          childNodeIds.push(reader.readInt32());
        }
        nodes.set(nodeId, {
          type: 'nGRP',
          nodeId,
          attributes,
          childNodeIds,
        });
        break;
      }

      case 'nSHP': {
        const nodeId = reader.readUint32();
        const attributes = reader.readDict();
        const numModels = reader.readInt32();
        const modelList: ShapeNode['models'] = [];
        for (let i = 0; i < numModels; i++) {
          const modelId = reader.readInt32();
          const modelAttrs = reader.readDict();
          modelList.push({ modelId, attributes: modelAttrs });
        }
        nodes.set(nodeId, {
          type: 'nSHP',
          nodeId,
          attributes,
          models: modelList,
        });
        break;
      }

      default:
        // Unknown chunk — skip it
        break;
    }

    // Jump to end of chunk content + children (in case we didn't read all bytes)
    reader.offset = chunkStart + contentSize + childrenSize;
  }

  console.log(`  Models parsed: ${models.length}`);
  console.log(`  Scene graph nodes: ${nodes.size}`);

  return { models, palette, nodes };
}

// ---------------------------------------------------------------------------
// Rotation decoding
//
// The _r attribute in nTRN frames is a single byte encoding a 3x3 rotation
// matrix. The byte encodes:
//   bits 0-1: index of the non-zero entry in the first row  (0,1,2)
//   bits 2-3: index of the non-zero entry in the second row (0,1,2)
//   (the third row index is implied — the remaining one)
//   bit 4: sign of the first row entry  (0 = +1, 1 = -1)
//   bit 5: sign of the second row entry (0 = +1, 1 = -1)
//   bit 6: sign of the third row entry  (0 = +1, 1 = -1)
// ---------------------------------------------------------------------------

type Mat3 = [number, number, number, number, number, number, number, number, number];

function decodeRotation(r: number): Mat3 {
  const row0Idx = r & 0x3;
  const row1Idx = (r >> 2) & 0x3;

  // Third row index is the remaining one
  const used = new Set([row0Idx, row1Idx]);
  let row2Idx = 0;
  for (let i = 0; i < 3; i++) {
    if (!used.has(i)) {
      row2Idx = i;
      break;
    }
  }

  const sign0 = (r >> 4) & 1 ? -1 : 1;
  const sign1 = (r >> 5) & 1 ? -1 : 1;
  const sign2 = (r >> 6) & 1 ? -1 : 1;

  // Build 3x3 matrix (row-major)
  // mat[row * 3 + col]
  const mat: Mat3 = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  mat[0 * 3 + row0Idx] = sign0;
  mat[1 * 3 + row1Idx] = sign1;
  mat[2 * 3 + row2Idx] = sign2;
  return mat;
}

function identityMat3(): Mat3 {
  return [1, 0, 0, 0, 1, 0, 0, 0, 1];
}

function multiplyMat3(a: Mat3, b: Mat3): Mat3 {
  const out: Mat3 = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      out[row * 3 + col] =
        a[row * 3 + 0] * b[0 * 3 + col] +
        a[row * 3 + 1] * b[1 * 3 + col] +
        a[row * 3 + 2] * b[2 * 3 + col];
    }
  }
  return out;
}

function applyMat3(mat: Mat3, x: number, y: number, z: number): [number, number, number] {
  return [
    mat[0] * x + mat[1] * y + mat[2] * z,
    mat[3] * x + mat[4] * y + mat[5] * z,
    mat[6] * x + mat[7] * y + mat[8] * z,
  ];
}

// ---------------------------------------------------------------------------
// Scene graph traversal
// ---------------------------------------------------------------------------

interface WorldTransform {
  tx: number;
  ty: number;
  tz: number;
  rotation: Mat3;
}

interface PlacedModel {
  modelIndex: number;
  transform: WorldTransform;
}

function collectPlacedModels(voxFile: VoxFile): PlacedModel[] {
  const { nodes } = voxFile;
  const placed: PlacedModel[] = [];

  if (nodes.size === 0) {
    // No scene graph — each model is placed at origin.
    // This handles simple .vox files with a single model.
    for (let i = 0; i < voxFile.models.length; i++) {
      placed.push({
        modelIndex: i,
        transform: { tx: 0, ty: 0, tz: 0, rotation: identityMat3() },
      });
    }
    return placed;
  }

  // Recursive traversal
  function walk(nodeId: number, parentTransform: WorldTransform): void {
    const node = nodes.get(nodeId);
    if (!node) {
      console.warn(`  Warning: scene graph references missing node ${nodeId}`);
      return;
    }

    switch (node.type) {
      case 'nTRN': {
        // Extract translation and rotation from frame 0
        let ltx = 0;
        let lty = 0;
        let ltz = 0;
        let localRot: Mat3 = identityMat3();

        if (node.frames.length > 0) {
          const frame = node.frames[0];
          const tStr = frame.get('_t');
          if (tStr) {
            const parts = tStr.split(' ').map(Number);
            if (parts.length === 3) {
              ltx = parts[0];
              lty = parts[1];
              ltz = parts[2];
            }
          }
          const rStr = frame.get('_r');
          if (rStr) {
            localRot = decodeRotation(parseInt(rStr, 10));
          }
        }

        // Compose: world = parent_rot * local_translation + parent_translation
        const [rtx, rty, rtz] = applyMat3(parentTransform.rotation, ltx, lty, ltz);
        const composedTransform: WorldTransform = {
          tx: parentTransform.tx + rtx,
          ty: parentTransform.ty + rty,
          tz: parentTransform.tz + rtz,
          rotation: multiplyMat3(parentTransform.rotation, localRot),
        };

        walk(node.childNodeId, composedTransform);
        break;
      }

      case 'nGRP': {
        for (const childId of node.childNodeIds) {
          walk(childId, parentTransform);
        }
        break;
      }

      case 'nSHP': {
        for (const model of node.models) {
          placed.push({
            modelIndex: model.modelId,
            transform: { ...parentTransform, rotation: [...parentTransform.rotation] as Mat3 },
          });
        }
        break;
      }
    }
  }

  const rootTransform: WorldTransform = {
    tx: 0,
    ty: 0,
    tz: 0,
    rotation: identityMat3(),
  };

  walk(0, rootTransform);
  return placed;
}

// ---------------------------------------------------------------------------
// Chunk generation
// ---------------------------------------------------------------------------

function localIndex(lx: number, ly: number, lz: number): number {
  return lx + ly * CHUNK_SIZE + lz * CHUNK_SIZE * CHUNK_SIZE;
}

interface ChunkMap {
  chunks: Map<string, Uint8Array>;
  voxelCount: number;
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
}

function buildChunks(voxFile: VoxFile, placedModels: PlacedModel[]): ChunkMap {
  const chunks = new Map<string, Uint8Array>();
  let voxelCount = 0;
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;

  console.log(`\nPlacing voxels from ${placedModels.length} model instances...`);

  let progressInterval = Math.max(1, Math.floor(placedModels.length / 20));

  for (let mi = 0; mi < placedModels.length; mi++) {
    if (mi % progressInterval === 0) {
      const pct = ((mi / placedModels.length) * 100).toFixed(0);
      process.stdout.write(`  Progress: ${pct}% (${mi}/${placedModels.length} models)\r`);
    }

    const pm = placedModels[mi];
    const model = voxFile.models[pm.modelIndex];
    if (!model) {
      console.warn(`  Warning: model index ${pm.modelIndex} not found`);
      continue;
    }

    const { tx, ty, tz, rotation } = pm.transform;

    // MagicaVoxel stores voxels relative to model center.
    // The model origin is at (sizeX/2, sizeY/2, sizeZ/2).
    const originX = model.sizeX / 2;
    const originY = model.sizeY / 2;
    const originZ = model.sizeZ / 2;

    for (const voxel of model.voxels) {
      // Offset voxel from model center
      const lx = voxel.x - originX;
      const ly = voxel.y - originY;
      const lz = voxel.z - originZ;

      // Apply rotation then translation (in .vox coordinate space)
      const [rx, ry, rz] = applyMat3(rotation, lx, ly, lz);
      const voxWorldX = Math.floor(tx + rx);
      const voxWorldY = Math.floor(ty + ry);
      const voxWorldZ = Math.floor(tz + rz);

      // Coordinate swap: .vox has Y=depth, Z=up. Game has Y=up, Z=depth.
      // vox(x,y,z) -> game(x, z, -y)
      const gameX = voxWorldX;
      const gameY = voxWorldZ;   // vox Z (up) becomes game Y (up)
      const gameZ = -voxWorldY;  // vox Y (depth) becomes game Z, negated for RH handedness

      // Track bounds
      if (gameX < minX) minX = gameX;
      if (gameY < minY) minY = gameY;
      if (gameZ < minZ) minZ = gameZ;
      if (gameX > maxX) maxX = gameX;
      if (gameY > maxY) maxY = gameY;
      if (gameZ > maxZ) maxZ = gameZ;

      // Compute chunk key and local offset
      const cx = Math.floor(gameX / CHUNK_SIZE);
      const cy = Math.floor(gameY / CHUNK_SIZE);
      const cz = Math.floor(gameZ / CHUNK_SIZE);
      const chunkKey = `${cx},${cy},${cz}`;

      const localXi = ((gameX % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
      const localYi = ((gameY % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
      const localZi = ((gameZ % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;

      let chunk = chunks.get(chunkKey);
      if (!chunk) {
        chunk = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE * CHUNK_SIZE);
        chunks.set(chunkKey, chunk);
      }

      const idx = localIndex(localXi, localYi, localZi);
      if (chunk[idx] === 0) {
        voxelCount++;
      }
      // Store the palette index as the voxel value (1-255, 0 = air)
      chunk[idx] = voxel.colorIndex;
    }
  }

  process.stdout.write('\n');

  return { chunks, voxelCount, minX, minY, minZ, maxX, maxY, maxZ };
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

interface ChunkData {
  key: string;
  voxels: number[];
}

function writeOutput(
  chunkMap: ChunkMap,
  palette: PaletteColor[],
  outputPrefix: string,
  modelCount: number,
  instanceCount: number
): void {
  // Build chunks JSON
  const chunksPath = `${outputPrefix}.chunks.json`;
  const palettePath = `${outputPrefix}.palette.json`;

  console.log(`\nWriting chunks to ${chunksPath}...`);

  const chunkDataArray: ChunkData[] = [];
  for (const [key, data] of chunkMap.chunks) {
    // Only include non-empty chunks
    let hasData = false;
    for (let i = 0; i < data.length; i++) {
      if (data[i] !== 0) {
        hasData = true;
        break;
      }
    }
    if (!hasData) continue;

    chunkDataArray.push({
      key,
      voxels: Array.from(data),
    });
  }

  // Sort by key for deterministic output
  chunkDataArray.sort((a, b) => a.key.localeCompare(b.key));

  const chunksJson = JSON.stringify(chunkDataArray);
  fs.writeFileSync(chunksPath, chunksJson, 'utf-8');

  console.log(`Writing palette to ${palettePath}...`);

  const paletteJson = JSON.stringify(
    palette.map((c) => ({ r: c.r, g: c.g, b: c.b }))
  );
  fs.writeFileSync(palettePath, paletteJson, 'utf-8');

  // Stats
  const chunksSize = Buffer.byteLength(chunksJson);
  const paletteSize = Buffer.byteLength(paletteJson);

  console.log('\n=== Conversion complete ===');
  console.log(`  Models loaded:     ${modelCount} (${instanceCount} instances placed)`);
  console.log(`  World bounds:`);
  console.log(`    X: ${chunkMap.minX} to ${chunkMap.maxX} (range: ${chunkMap.maxX - chunkMap.minX + 1})`);
  console.log(`    Y: ${chunkMap.minY} to ${chunkMap.maxY} (range: ${chunkMap.maxY - chunkMap.minY + 1})`);
  console.log(`    Z: ${chunkMap.minZ} to ${chunkMap.maxZ} (range: ${chunkMap.maxZ - chunkMap.minZ + 1})`);
  console.log(`  Chunks generated:  ${chunkDataArray.length}`);
  console.log(`  Total voxels:      ${chunkMap.voxelCount.toLocaleString()}`);
  console.log(`  Chunks file size:  ${(chunksSize / 1024 / 1024).toFixed(1)} MB`);
  console.log(`  Palette file size: ${(paletteSize / 1024).toFixed(1)} KB`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main(): void {
  const args = process.argv.slice(2);

  const inputPath = args[0] ?? 'assets/vox/shoreline_mvp.vox';
  const outputPrefix = args[1] ?? 'assets/maps/shoreline';

  // Resolve relative paths from cwd
  const resolvedInput = path.resolve(inputPath);
  const resolvedOutput = path.resolve(outputPrefix);

  if (!fs.existsSync(resolvedInput)) {
    console.error(`Error: input file not found: ${resolvedInput}`);
    process.exit(1);
  }

  console.log('=== Clawfield VOX Converter ===\n');

  // 1. Parse .vox file
  const voxFile = parseVox(resolvedInput);

  console.log(`\nModels: ${voxFile.models.length}`);

  // 2. Build scene graph and collect placed models
  const placedModels = collectPlacedModels(voxFile);
  console.log(`Placed model instances: ${placedModels.length}`);

  // 3. Build chunk map
  const chunkMap = buildChunks(voxFile, placedModels);

  // 4. Write output
  writeOutput(chunkMap, voxFile.palette, resolvedOutput, voxFile.models.length, placedModels.length);
}

main();
