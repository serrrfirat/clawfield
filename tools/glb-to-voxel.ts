/**
 * glb-to-voxel.ts — Convert any .glb file to Clawfield voxel formats.
 *
 * Outputs:
 *   object mode → .vobj.json (props, buildings, vegetation)
 *   map mode    → .map + .palette.json (CLWF binary map)
 *
 * Usage:
 *   npx tsx tools/glb-to-voxel.ts --input model.glb [options]
 *
 * Options:
 *   --input <path>        Path to .glb file (required)
 *   --output <path>       Output path (default: assets/objects/props/<name>.vobj.json)
 *   --mode <object|map>   Output format (default: object)
 *   --voxel-size <n>      Meters per voxel (default: 0.25 for object, 1.0 for map)
 *   --name <name>         Object name (default: filename stem)
 *   --category <cat>      prop | building | vegetation (default: prop)
 *   --scale <n>           Scale multiplier for mesh (default: 1.0)
 *   --verbose             Extra logging
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import sharp from 'sharp';
import { voxelize } from './geo-tiles/voxelizer.js';
import { classifyColors } from './geo-tiles/color-classifier.js';
import { writeMap } from './geo-tiles/map-writer.js';
import { transformPoint, multiplyMatrices } from './geo-tiles/geo-utils.js';
import type { MergedScene, MaterialGroup, VoxelGrid, RGB, CLIOptions } from './geo-tiles/types.js';

// ---------------------------------------------------------------------------
// GLB Parser (from tile-merger.ts)
// ---------------------------------------------------------------------------

interface GLBParsed {
  json: any;
  binChunk: Buffer;
}

function parseGLB(data: Buffer): GLBParsed | null {
  if (data.length < 12) return null;

  const magic = data.readUInt32LE(0);
  if (magic !== 0x46546C67) return null; // "glTF"

  const version = data.readUInt32LE(4);
  if (version !== 2) return null;

  let offset = 12;
  let json: any = null;
  let binChunk: Buffer = Buffer.alloc(0);

  while (offset < data.length) {
    if (offset + 8 > data.length) break;
    const chunkLength = data.readUInt32LE(offset);
    const chunkType = data.readUInt32LE(offset + 4);
    offset += 8;

    if (chunkType === 0x4E4F534A) {
      json = JSON.parse(data.subarray(offset, offset + chunkLength).toString('utf-8'));
    } else if (chunkType === 0x004E4942) {
      binChunk = data.subarray(offset, offset + chunkLength) as Buffer;
    }

    offset += chunkLength;
  }

  if (!json) return null;
  return { json, binChunk };
}

// ---------------------------------------------------------------------------
// Accessor reader (from tile-merger.ts)
// ---------------------------------------------------------------------------

function readAccessor(
  accessor: any,
  bufferViews: any[],
  bin: Buffer,
): Float32Array | Uint16Array | Uint32Array | Uint8Array | null {
  if (!accessor || accessor.bufferView === undefined) return null;

  const bv = bufferViews[accessor.bufferView];
  if (!bv) return null;

  const byteOffset = (bv.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  const componentType = accessor.componentType;
  const count = accessor.count;
  const type = accessor.type;

  const components = type === 'SCALAR' ? 1 :
                     type === 'VEC2' ? 2 :
                     type === 'VEC3' ? 3 :
                     type === 'VEC4' ? 4 : 1;
  const totalElements = count * components;

  switch (componentType) {
    case 5126: // FLOAT
      return new Float32Array(bin.buffer, bin.byteOffset + byteOffset, totalElements);
    case 5123: // UNSIGNED_SHORT
      return new Uint16Array(bin.buffer, bin.byteOffset + byteOffset, totalElements);
    case 5125: // UNSIGNED_INT
      return new Uint32Array(bin.buffer, bin.byteOffset + byteOffset, totalElements);
    case 5121: // UNSIGNED_BYTE
      return new Uint8Array(bin.buffer, bin.byteOffset + byteOffset, totalElements);
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Texture extraction (from tile-merger.ts)
// ---------------------------------------------------------------------------

function extractTexture(
  gltf: any,
  bin: Buffer,
  materialIndex: number,
): MaterialGroup['texture'] {
  const materials = gltf.materials ?? [];
  const material = materials[materialIndex];
  if (!material) return null;

  const pbr = material.pbrMetallicRoughness;
  if (!pbr?.baseColorTexture) return null;

  const texIndex = pbr.baseColorTexture.index;
  const textures = gltf.textures ?? [];
  const texture = textures[texIndex];
  if (!texture) return null;

  const images = gltf.images ?? [];
  const image = images[texture.source ?? 0];
  if (!image) return null;

  if (image.bufferView === undefined) return null;
  const bufferViews = gltf.bufferViews ?? [];
  const bv = bufferViews[image.bufferView];
  if (!bv) return null;

  const imgOffset = bv.byteOffset ?? 0;
  const imgLength = bv.byteLength;
  const imgData = bin.subarray(imgOffset, imgOffset + imgLength);

  try {
    return {
      data: new Uint8Array(imgData),
      width: 0,
      height: 0,
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Primitive extraction (adapted from tile-merger.ts — uses node world matrix)
// ---------------------------------------------------------------------------

interface ExtractedPrimitive {
  positions: number[];
  indices: number[];
  uvs: number[] | null;
  vertexColors: number[] | null;
}

function extractPrimitive(
  gltf: any,
  bin: Buffer,
  primitive: any,
  worldMatrix: Float64Array,
): ExtractedPrimitive | null {
  const attributes = primitive.attributes;
  if (!attributes) return null;

  if (primitive.extensions?.KHR_draco_mesh_compression) {
    if (attributes.POSITION === undefined) return null;
  }

  const accessors = gltf.accessors ?? [];
  const bufferViews = gltf.bufferViews ?? [];

  // Positions
  const posAccessor = accessors[attributes.POSITION];
  if (!posAccessor) return null;

  const posData = readAccessor(posAccessor, bufferViews, bin);
  if (!posData) return null;

  // Transform positions using the node's world matrix
  const positions: number[] = [];
  for (let i = 0; i < posData.length; i += 3) {
    const [x, y, z] = transformPoint(worldMatrix, posData[i], posData[i + 1], posData[i + 2]);
    positions.push(x, y, z);
  }

  // Indices
  let indices: number[];
  if (primitive.indices !== undefined) {
    const idxAccessor = accessors[primitive.indices];
    const idxData = readAccessor(idxAccessor, bufferViews, bin);
    indices = idxData ? Array.from(idxData) : [];
  } else {
    indices = [];
    for (let i = 0; i < positions.length / 3; i++) {
      indices.push(i);
    }
  }

  // UVs
  let uvs: number[] | null = null;
  if (attributes.TEXCOORD_0 !== undefined) {
    const uvAccessor = accessors[attributes.TEXCOORD_0];
    const uvData = readAccessor(uvAccessor, bufferViews, bin);
    if (uvData) uvs = Array.from(uvData);
  }

  // Vertex colors
  let vertexColors: number[] | null = null;
  if (attributes.COLOR_0 !== undefined) {
    const colorAccessor = accessors[attributes.COLOR_0];
    const colorData = readAccessor(colorAccessor, bufferViews, bin);
    if (colorData) {
      vertexColors = [];
      const isNormalized = colorAccessor.componentType === 5121;
      for (let i = 0; i < colorData.length; i++) {
        const step = colorAccessor.type === 'VEC4' ? 4 : 3;
        if (i % step < 3) {
          vertexColors.push(isNormalized ? colorData[i] : Math.round(colorData[i] * 255));
        }
      }
    }
  }

  // Get baseColorFactor as fallback vertex colors
  if (!vertexColors && primitive.material !== undefined) {
    const materials = gltf.materials ?? [];
    const mat = materials[primitive.material];
    const pbr = mat?.pbrMetallicRoughness;
    const factor = pbr?.baseColorFactor;
    if (factor && factor.length >= 3) {
      const r = Math.round(factor[0] * 255);
      const g = Math.round(factor[1] * 255);
      const b = Math.round(factor[2] * 255);
      const vertCount = positions.length / 3;
      vertexColors = [];
      for (let i = 0; i < vertCount; i++) {
        vertexColors.push(r, g, b);
      }
    }
  }

  return { positions, indices, uvs, vertexColors };
}

// ---------------------------------------------------------------------------
// Scene graph traversal (new)
// ---------------------------------------------------------------------------

/**
 * Compose a 4x4 column-major matrix from TRS decomposition.
 * translation: [x,y,z], rotation: [x,y,z,w] quaternion, scale: [x,y,z]
 */
function composeFromTRS(
  t: number[] | undefined,
  r: number[] | undefined,
  s: number[] | undefined,
): Float64Array {
  const m = new Float64Array(16);

  // Default TRS
  const tx = t?.[0] ?? 0, ty = t?.[1] ?? 0, tz = t?.[2] ?? 0;
  const qx = r?.[0] ?? 0, qy = r?.[1] ?? 0, qz = r?.[2] ?? 0, qw = r?.[3] ?? 1;
  const sx = s?.[0] ?? 1, sy = s?.[1] ?? 1, sz = s?.[2] ?? 1;

  // Quaternion to rotation matrix, then apply scale and translation
  const x2 = qx + qx, y2 = qy + qy, z2 = qz + qz;
  const xx = qx * x2, xy = qx * y2, xz = qx * z2;
  const yy = qy * y2, yz = qy * z2, zz = qz * z2;
  const wx = qw * x2, wy = qw * y2, wz = qw * z2;

  m[0]  = (1 - yy - zz) * sx;
  m[1]  = (xy + wz) * sx;
  m[2]  = (xz - wy) * sx;
  m[3]  = 0;
  m[4]  = (xy - wz) * sy;
  m[5]  = (1 - xx - zz) * sy;
  m[6]  = (yz + wx) * sy;
  m[7]  = 0;
  m[8]  = (xz + wy) * sz;
  m[9]  = (yz - wx) * sz;
  m[10] = (1 - xx - yy) * sz;
  m[11] = 0;
  m[12] = tx;
  m[13] = ty;
  m[14] = tz;
  m[15] = 1;

  return m;
}

/**
 * Walk the glTF scene graph, accumulate geometry into MergedScene arrays.
 */
function walkNodes(
  json: any,
  bin: Buffer,
  verbose: boolean,
): { positions: number[]; indices: number[]; uvs: number[]; vertexColors: number[]; materialGroups: MaterialGroup[]; hasUVs: boolean; hasVertexColors: boolean } {
  const nodes = json.nodes ?? [];
  const meshes = json.meshes ?? [];
  const scenes = json.scenes ?? [];
  const defaultScene = json.scene ?? 0;
  const rootNodes: number[] = scenes[defaultScene]?.nodes ?? [];

  const allPositions: number[] = [];
  const allIndices: number[] = [];
  const allUVs: number[] = [];
  const allVertexColors: number[] = [];
  const materialGroups: MaterialGroup[] = [];
  let vertexOffset = 0;
  let triangleOffset = 0;
  let hasUVs = false;
  let hasVertexColors = false;

  // Identity matrix
  const identity = new Float64Array(16);
  identity[0] = 1; identity[5] = 1; identity[10] = 1; identity[15] = 1;

  function visitNode(nodeIdx: number, parentMatrix: Float64Array): void {
    const node = nodes[nodeIdx];
    if (!node) return;

    // Compose local transform
    let localMatrix: Float64Array;
    if (node.matrix) {
      localMatrix = new Float64Array(node.matrix);
    } else {
      localMatrix = composeFromTRS(node.translation, node.rotation, node.scale);
    }

    // World matrix = parent * local
    const worldMatrix = multiplyMatrices(parentMatrix, localMatrix);

    // Process mesh if this node has one
    if (node.mesh !== undefined) {
      const mesh = meshes[node.mesh];
      if (mesh) {
        for (const primitive of mesh.primitives ?? []) {
          const result = extractPrimitive(json, bin, primitive, worldMatrix);
          if (!result) continue;

          for (const idx of result.indices) {
            allIndices.push(idx + vertexOffset);
          }

          for (const p of result.positions) {
            allPositions.push(p);
          }

          if (result.uvs) {
            hasUVs = true;
            for (const uv of result.uvs) allUVs.push(uv);
          } else {
            for (let i = 0; i < result.positions.length / 3 * 2; i++) {
              allUVs.push(0);
            }
          }

          if (result.vertexColors) {
            hasVertexColors = true;
            for (const c of result.vertexColors) allVertexColors.push(c);
          } else {
            for (let i = 0; i < result.positions.length / 3 * 3; i++) {
              allVertexColors.push(180);
            }
          }

          let texture: MaterialGroup['texture'] = null;
          if (primitive.material !== undefined) {
            texture = extractTexture(json, bin, primitive.material);
          }

          materialGroups.push({
            startTriangle: triangleOffset,
            triangleCount: result.indices.length / 3,
            texture,
          });

          triangleOffset += result.indices.length / 3;
          vertexOffset += result.positions.length / 3;
        }
      }
    }

    // Recurse into children
    for (const childIdx of node.children ?? []) {
      visitNode(childIdx, worldMatrix);
    }
  }

  for (const rootIdx of rootNodes) {
    visitNode(rootIdx, identity);
  }

  if (verbose) {
    console.log(`  Scene: ${vertexOffset} vertices, ${triangleOffset} triangles, ${materialGroups.length} material groups`);
  }

  return { positions: allPositions, indices: allIndices, uvs: allUVs, vertexColors: allVertexColors, materialGroups, hasUVs, hasVertexColors };
}

// ---------------------------------------------------------------------------
// Texture baking (new)
// ---------------------------------------------------------------------------

/**
 * Pre-bake texture colors into vertex colors so the voxelizer's
 * vertex-color interpolation works for textured meshes.
 */
async function bakeTextureToVertexColors(
  scene: MergedScene,
  verbose: boolean,
): Promise<MergedScene> {
  if (!scene.uvs || scene.materialGroups.length === 0) return scene;

  // Decode all unique textures
  const textureCache = new Map<MaterialGroup['texture'], { data: Buffer; width: number; height: number } | null>();

  for (const group of scene.materialGroups) {
    if (!group.texture || textureCache.has(group.texture)) continue;
    try {
      const img = sharp(Buffer.from(group.texture.data));
      const meta = await img.metadata();
      const rawData = await img.raw().ensureAlpha().toBuffer();
      textureCache.set(group.texture, {
        data: rawData,
        width: meta.width!,
        height: meta.height!,
      });
      if (verbose) {
        console.log(`  Decoded texture: ${meta.width}x${meta.height}`);
      }
    } catch {
      textureCache.set(group.texture, null);
    }
  }

  // If no textures decoded, return as-is
  let anyDecoded = false;
  for (const v of textureCache.values()) {
    if (v) { anyDecoded = true; break; }
  }
  if (!anyDecoded) return scene;

  // Ensure we have a mutable vertex color array
  const vertexCount = scene.positions.length / 3;
  const vertexColors = scene.vertexColors
    ? new Uint8Array(scene.vertexColors)
    : new Uint8Array(vertexCount * 3).fill(180);

  const uvs = scene.uvs;

  for (const group of scene.materialGroups) {
    if (!group.texture) continue;
    const decoded = textureCache.get(group.texture);
    if (!decoded) continue;

    const { data: texData, width: tw, height: th } = decoded;

    // For each triangle in this group, sample texture at each vertex UV
    for (let ti = 0; ti < group.triangleCount; ti++) {
      const triIdx = (group.startTriangle + ti) * 3;
      for (let vi = 0; vi < 3; vi++) {
        const vertIdx = scene.indices[triIdx + vi];
        const u = uvs[vertIdx * 2];
        const v = uvs[vertIdx * 2 + 1];

        // Wrap UVs to [0,1]
        const wu = ((u % 1) + 1) % 1;
        const wv = ((v % 1) + 1) % 1;

        // Sample texture (flip V since glTF has 0 at top)
        const px = Math.min(Math.floor(wu * tw), tw - 1);
        const py = Math.min(Math.floor(wv * th), th - 1);
        const texOffset = (py * tw + px) * 4; // RGBA

        vertexColors[vertIdx * 3]     = texData[texOffset];
        vertexColors[vertIdx * 3 + 1] = texData[texOffset + 1];
        vertexColors[vertIdx * 3 + 2] = texData[texOffset + 2];
      }
    }
  }

  if (verbose) {
    console.log(`  Baked textures into ${vertexCount} vertex colors`);
  }

  return {
    ...scene,
    vertexColors,
  };
}

// ---------------------------------------------------------------------------
// Color quantization — median-cut (from image-to-vobj.ts)
// ---------------------------------------------------------------------------

interface ColorEntry {
  r: number;
  g: number;
  b: number;
  count: number;
}

function quantizeColors(
  colors: Map<number, number>,
  maxColors: number,
): { palette: number[]; colorMap: Map<number, number> } {
  const entries: ColorEntry[] = [];
  for (const [key, count] of colors) {
    entries.push({
      r: (key >> 16) & 0xff,
      g: (key >> 8) & 0xff,
      b: key & 0xff,
      count,
    });
  }

  if (entries.length <= maxColors) {
    const palette: number[] = [0];
    const colorMap = new Map<number, number>();
    for (const e of entries) {
      const key = (e.r << 16) | (e.g << 8) | e.b;
      const idx = palette.length;
      palette.push(key);
      colorMap.set(key, idx);
    }
    while (palette.length < 256) palette.push(0);
    return { palette, colorMap };
  }

  type Bucket = ColorEntry[];

  function splitBucket(bucket: Bucket): [Bucket, Bucket] {
    let minR = 255, maxR = 0, minG = 255, maxG = 0, minB = 255, maxB = 0;
    for (const c of bucket) {
      if (c.r < minR) minR = c.r;
      if (c.r > maxR) maxR = c.r;
      if (c.g < minG) minG = c.g;
      if (c.g > maxG) maxG = c.g;
      if (c.b < minB) minB = c.b;
      if (c.b > maxB) maxB = c.b;
    }

    const rangeR = maxR - minR;
    const rangeG = maxG - minG;
    const rangeB = maxB - minB;

    let sortKey: (c: ColorEntry) => number;
    if (rangeR >= rangeG && rangeR >= rangeB) {
      sortKey = (c) => c.r;
    } else if (rangeG >= rangeB) {
      sortKey = (c) => c.g;
    } else {
      sortKey = (c) => c.b;
    }

    bucket.sort((a, b) => sortKey(a) - sortKey(b));
    const mid = Math.floor(bucket.length / 2);
    return [bucket.slice(0, mid), bucket.slice(mid)];
  }

  let buckets: Bucket[] = [entries];
  while (buckets.length < maxColors) {
    let maxIdx = 0;
    let maxSize = 0;
    for (let i = 0; i < buckets.length; i++) {
      if (buckets[i].length > maxSize) {
        maxSize = buckets[i].length;
        maxIdx = i;
      }
    }
    if (maxSize <= 1) break;

    const [a, b] = splitBucket(buckets[maxIdx]);
    buckets.splice(maxIdx, 1, a, b);
  }

  const palette: number[] = [0];
  const colorMap = new Map<number, number>();

  for (const bucket of buckets) {
    if (bucket.length === 0) continue;
    let totalR = 0, totalG = 0, totalB = 0, totalCount = 0;
    for (const c of bucket) {
      totalR += c.r * c.count;
      totalG += c.g * c.count;
      totalB += c.b * c.count;
      totalCount += c.count;
    }
    const avgR = Math.round(totalR / totalCount);
    const avgG = Math.round(totalG / totalCount);
    const avgB = Math.round(totalB / totalCount);
    const paletteIdx = palette.length;
    palette.push((avgR << 16) | (avgG << 8) | avgB);

    for (const c of bucket) {
      const key = (c.r << 16) | (c.g << 8) | c.b;
      colorMap.set(key, paletteIdx);
    }
  }

  while (palette.length < 256) palette.push(0);
  return { palette, colorMap };
}

// ---------------------------------------------------------------------------
// .vobj.json writer (new)
// ---------------------------------------------------------------------------

const CHUNK_SIZE = 16;

function writeVobjJson(
  grid: VoxelGrid,
  outputPath: string,
  name: string,
  category: string,
  voxelSize: number,
): void {
  const { bounds, colorMap, chunks } = grid;

  // Compute dimensions
  const sizeX = bounds.xMax - bounds.xMin;
  const sizeY = bounds.yMax - bounds.yMin;
  const sizeZ = bounds.zMax - bounds.zMin;

  if (sizeX <= 0 || sizeY <= 0 || sizeZ <= 0) {
    console.error('Error: empty voxel grid, nothing to write');
    process.exit(1);
  }

  console.log(`  Grid dimensions: ${sizeX} x ${sizeY} x ${sizeZ}`);

  // Collect all unique colors and their counts
  const colorCounts = new Map<number, number>();
  for (const [, color] of colorMap) {
    const key = (color.r << 16) | (color.g << 8) | color.b;
    colorCounts.set(key, (colorCounts.get(key) ?? 0) + 1);
  }

  // Quantize to 255 colors (index 0 = air)
  const { palette, colorMap: paletteMap } = quantizeColors(colorCounts, 255);

  // Build flat voxel array
  const voxels = new Array(sizeX * sizeY * sizeZ).fill(0);
  let solidCount = 0;

  for (const [chunkKey, chunkData] of chunks) {
    const [cx, cy, cz] = chunkKey.split(',').map(Number);

    for (let lz = 0; lz < CHUNK_SIZE; lz++) {
      for (let ly = 0; ly < CHUNK_SIZE; ly++) {
        for (let lx = 0; lx < CHUNK_SIZE; lx++) {
          const val = chunkData[lx + ly * CHUNK_SIZE + lz * CHUNK_SIZE * CHUNK_SIZE];
          if (val === 0) continue;

          const wx = cx * CHUNK_SIZE + lx;
          const wy = cy * CHUNK_SIZE + ly;
          const wz = cz * CHUNK_SIZE + lz;

          // Map to local grid coords
          const gx = wx - bounds.xMin;
          const gy = wy - bounds.yMin;
          const gz = wz - bounds.zMin;

          if (gx < 0 || gx >= sizeX || gy < 0 || gy >= sizeY || gz < 0 || gz >= sizeZ) continue;

          // Look up color
          const colorKey = `${wx},${wy},${wz}`;
          const color = colorMap.get(colorKey);
          let paletteIdx = 1; // default solid

          if (color) {
            const rgbKey = (color.r << 16) | (color.g << 8) | color.b;
            paletteIdx = paletteMap.get(rgbKey) ?? 1;
          }

          const idx = gx + gy * sizeX + gz * sizeX * sizeY;
          voxels[idx] = paletteIdx;
          solidCount++;
        }
      }
    }
  }

  console.log(`  Solid voxels: ${solidCount}`);
  console.log(`  Palette entries: ${palette.filter(c => c !== 0).length}`);

  const origin = {
    x: Math.floor(sizeX / 2),
    y: 0,
    z: Math.floor(sizeZ / 2),
  };

  const objDef = {
    name,
    version: 1,
    category,
    sizeX,
    sizeY,
    sizeZ,
    voxelSize,
    origin,
    palette,
    voxels,
  };

  const outDir = path.dirname(outputPath);
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  fs.writeFileSync(outputPath, JSON.stringify(objDef));

  const fileSizeKB = (Buffer.byteLength(JSON.stringify(objDef)) / 1024).toFixed(1);
  console.log(`  Output: ${outputPath} (${fileSizeKB} KB)`);
  console.log(`  Dimensions: ${sizeX}x${sizeY}x${sizeZ} voxels`);
  console.log(`  World size: ${(sizeX * voxelSize).toFixed(2)}x${(sizeY * voxelSize).toFixed(2)}x${(sizeZ * voxelSize).toFixed(2)} meters`);
}

// ---------------------------------------------------------------------------
// CLI + Main
// ---------------------------------------------------------------------------

function getArg(args: string[], name: string, defaultVal: string): string {
  const idx = args.indexOf(name);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : defaultVal;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  const inputPath = path.resolve(getArg(args, '--input', ''));
  const mode = getArg(args, '--mode', 'object') as 'object' | 'map';
  const defaultVoxelSize = mode === 'map' ? '1.0' : '0.25';
  const voxelSize = parseFloat(getArg(args, '--voxel-size', defaultVoxelSize));
  const nameArg = getArg(args, '--name', '');
  const category = getArg(args, '--category', 'prop');
  const scale = parseFloat(getArg(args, '--scale', '1.0'));
  const verbose = args.includes('--verbose');

  const name = nameArg || path.basename(inputPath, path.extname(inputPath));

  const defaultOutput = mode === 'map'
    ? path.resolve(`assets/maps/${name}`)
    : path.resolve(`assets/objects/props/${name}.vobj.json`);
  const outputPath = path.resolve(getArg(args, '--output', defaultOutput));

  if (!inputPath || inputPath === path.resolve('')) {
    console.error('Usage: npx tsx tools/glb-to-voxel.ts --input <path.glb> [options]');
    console.error('');
    console.error('Options:');
    console.error('  --output <path>       Output path');
    console.error('  --mode <object|map>   Output format (default: object)');
    console.error('  --voxel-size <n>      Meters per voxel (default: 0.25 for object, 1.0 for map)');
    console.error('  --name <name>         Object name (default: filename stem)');
    console.error('  --category <cat>      prop | building | vegetation (default: prop)');
    console.error('  --scale <n>           Scale multiplier for mesh (default: 1.0)');
    console.error('  --verbose             Extra logging');
    process.exit(1);
  }

  if (!fs.existsSync(inputPath)) {
    console.error(`Error: input file not found: ${inputPath}`);
    process.exit(1);
  }

  console.log('=== GLB to Voxel Converter ===\n');
  console.log(`  Input:      ${inputPath}`);
  console.log(`  Output:     ${outputPath}`);
  console.log(`  Mode:       ${mode}`);
  console.log(`  Voxel size: ${voxelSize}m`);
  console.log(`  Name:       ${name}`);
  console.log(`  Category:   ${category}`);
  if (scale !== 1.0) console.log(`  Scale:      ${scale}x`);
  console.log('');

  // Step 1: Parse GLB
  console.log('Parsing GLB...');
  const glbData = fs.readFileSync(inputPath);
  const parsed = parseGLB(glbData as Buffer);
  if (!parsed) {
    console.error('Error: failed to parse GLB file (invalid format or not glTF 2.0)');
    process.exit(1);
  }
  const { json, binChunk } = parsed;

  if (verbose) {
    const meshCount = (json.meshes ?? []).length;
    const nodeCount = (json.nodes ?? []).length;
    const matCount = (json.materials ?? []).length;
    console.log(`  glTF: ${nodeCount} nodes, ${meshCount} meshes, ${matCount} materials`);
  }

  // Step 2: Walk scene graph, extract geometry
  console.log('Extracting geometry...');
  const extracted = walkNodes(json, binChunk, verbose);

  if (extracted.positions.length === 0) {
    console.error('Error: no geometry found in GLB');
    process.exit(1);
  }

  // Apply scale to positions if needed
  const positions = new Float32Array(extracted.positions);
  if (scale !== 1.0) {
    for (let i = 0; i < positions.length; i++) {
      positions[i] *= scale;
    }
    if (verbose) console.log(`  Scaled positions by ${scale}x`);
  }

  // Build MergedScene
  let scene: MergedScene = {
    positions,
    indices: new Uint32Array(extracted.indices),
    uvs: extracted.hasUVs ? new Float32Array(extracted.uvs) : null,
    vertexColors: extracted.hasVertexColors ? new Uint8Array(extracted.vertexColors) : null,
    materialGroups: extracted.materialGroups,
  };

  // Step 3: Bake textures into vertex colors
  console.log('Baking textures...');
  scene = await bakeTextureToVertexColors(scene, verbose);

  // Step 4: Voxelize
  // Build stub CLIOptions with huge radius to avoid clipping
  const stubOpts: CLIOptions = {
    lat: 0,
    lon: 0,
    radius: 999999,
    apiKey: '',
    output: outputPath,
    name,
    voxelSize,
    maxGeometricError: 999,
    skipInteriors: true,
    skipMeta: true,
    dryRun: false,
    verbose,
    cacheOnly: false,
  };

  const voxelGrid = await voxelize(scene, stubOpts);

  if (voxelGrid.chunks.size === 0) {
    console.error('Error: voxelization produced no voxels');
    process.exit(1);
  }

  // Step 5: Output
  if (mode === 'map') {
    console.log('Classifying colors for map output...');
    const classified = classifyColors(voxelGrid);
    writeMap(classified, null, outputPath);
  } else {
    console.log('Writing .vobj.json...');
    writeVobjJson(voxelGrid, outputPath, name, category, voxelSize);
  }

  console.log('\nDone!');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
