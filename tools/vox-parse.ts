/**
 * vox-parse.ts
 *
 * Shared .vox file parser. Extracts models, palette, and scene graph
 * from MagicaVoxel .vox files (with scene graph support).
 *
 * Used by vox-converter.ts and vox-extract.ts.
 */

import * as fs from 'node:fs';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface VoxModel {
  sizeX: number;
  sizeY: number;
  sizeZ: number;
  voxels: { x: number; y: number; z: number; colorIndex: number }[];
}

export interface PaletteColor {
  r: number;
  g: number;
  b: number;
  a: number;
}

export interface TransformNode {
  type: 'nTRN';
  nodeId: number;
  attributes: Map<string, string>;
  childNodeId: number;
  layerId: number;
  frames: Map<string, string>[];
}

export interface GroupNode {
  type: 'nGRP';
  nodeId: number;
  attributes: Map<string, string>;
  childNodeIds: number[];
}

export interface ShapeNode {
  type: 'nSHP';
  nodeId: number;
  attributes: Map<string, string>;
  models: { modelId: number; attributes: Map<string, string> }[];
}

export type SceneNode = TransformNode | GroupNode | ShapeNode;

export interface VoxFile {
  models: VoxModel[];
  palette: PaletteColor[];
  nodes: Map<number, SceneNode>;
}

export type Mat3 = [number, number, number, number, number, number, number, number, number];

export interface WorldTransform {
  tx: number;
  ty: number;
  tz: number;
  rotation: Mat3;
}

export interface PlacedModel {
  modelIndex: number;
  transform: WorldTransform;
}

// ---------------------------------------------------------------------------
// Binary reader helper
// ---------------------------------------------------------------------------

export class BinaryReader {
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

export function parseVox(filePath: string): VoxFile {
  console.log(`Reading ${filePath}...`);
  const buffer = fs.readFileSync(filePath);
  console.log(`  File size: ${(buffer.byteLength / 1024 / 1024).toFixed(1)} MB`);

  const reader = new BinaryReader(buffer);

  const magic = reader.readString(4);
  if (magic !== 'VOX ') {
    throw new Error(`Invalid VOX file: magic = "${magic}"`);
  }

  const version = reader.readUint32();
  console.log(`  VOX version: ${version}`);

  const mainId = reader.readString(4);
  if (mainId !== 'MAIN') {
    throw new Error(`Expected MAIN chunk, got "${mainId}"`);
  }
  const mainContentSize = reader.readUint32();
  const mainChildrenSize = reader.readUint32();

  reader.skip(mainContentSize);

  const models: VoxModel[] = [];
  const palette: PaletteColor[] = new Array(256);
  const nodes = new Map<number, SceneNode>();

  let pendingSize: { x: number; y: number; z: number } | null = null;

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
          palette[i + 1] = { r, g, b, a };
        }
        palette[0] = { r: 0, g: 0, b: 0, a: 0 };
        break;
      }

      case 'nTRN': {
        const nodeId = reader.readUint32();
        const attributes = reader.readDict();
        const childNodeId = reader.readInt32();
        const _reservedId = reader.readInt32();
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
        break;
    }

    reader.offset = chunkStart + contentSize + childrenSize;
  }

  console.log(`  Models parsed: ${models.length}`);
  console.log(`  Scene graph nodes: ${nodes.size}`);

  return { models, palette, nodes };
}

// ---------------------------------------------------------------------------
// Rotation decoding
// ---------------------------------------------------------------------------

export function decodeRotation(r: number): Mat3 {
  const row0Idx = r & 0x3;
  const row1Idx = (r >> 2) & 0x3;

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

  const mat: Mat3 = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  mat[0 * 3 + row0Idx] = sign0;
  mat[1 * 3 + row1Idx] = sign1;
  mat[2 * 3 + row2Idx] = sign2;
  return mat;
}

export function identityMat3(): Mat3 {
  return [1, 0, 0, 0, 1, 0, 0, 0, 1];
}

export function multiplyMat3(a: Mat3, b: Mat3): Mat3 {
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

export function applyMat3(mat: Mat3, x: number, y: number, z: number): [number, number, number] {
  return [
    mat[0] * x + mat[1] * y + mat[2] * z,
    mat[3] * x + mat[4] * y + mat[5] * z,
    mat[6] * x + mat[7] * y + mat[8] * z,
  ];
}

// ---------------------------------------------------------------------------
// Scene graph traversal
// ---------------------------------------------------------------------------

export function collectPlacedModels(voxFile: VoxFile): PlacedModel[] {
  const { nodes } = voxFile;
  const placed: PlacedModel[] = [];

  if (nodes.size === 0) {
    for (let i = 0; i < voxFile.models.length; i++) {
      placed.push({
        modelIndex: i,
        transform: { tx: 0, ty: 0, tz: 0, rotation: identityMat3() },
      });
    }
    return placed;
  }

  function walk(nodeId: number, parentTransform: WorldTransform): void {
    const node = nodes.get(nodeId);
    if (!node) {
      console.warn(`  Warning: scene graph references missing node ${nodeId}`);
      return;
    }

    switch (node.type) {
      case 'nTRN': {
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
