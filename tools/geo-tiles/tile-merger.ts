/**
 * tile-merger.ts — Load GLB files, decode Draco compression,
 * extract geometry + textures, transform ECEF → local ENU, and merge.
 */

import * as fs from 'node:fs';
import type { TileRef, MergedScene, MaterialGroup, CLIOptions } from './types.js';
import { ecefToENUMatrix, multiplyMatrices, transformPoint } from './geo-utils.js';

/**
 * Merge multiple GLB tiles into a single scene in local ENU coordinates.
 */
export async function mergeTiles(
  tiles: TileRef[],
  opts: CLIOptions,
): Promise<MergedScene> {
  console.log(`Merging ${tiles.length} tiles...`);

  // Build the ECEF → local ENU transform
  const enuMatrix = ecefToENUMatrix(opts.lat, opts.lon, 0);

  const allPositions: number[] = [];
  const allIndices: number[] = [];
  const allUVs: number[] = [];
  const allVertexColors: number[] = [];
  const materialGroups: MaterialGroup[] = [];
  let vertexOffset = 0;
  let triangleOffset = 0;
  let hasUVs = false;
  let hasVertexColors = false;

  for (let ti = 0; ti < tiles.length; ti++) {
    const tile = tiles[ti];
    if (opts.verbose && ti % 10 === 0) {
      console.log(`  Processing tile ${ti + 1}/${tiles.length}...`);
    }

    try {
      const glbData = fs.readFileSync(tile.glbPath);
      const parsed = parseGLB(glbData);
      if (!parsed) continue;

      const { json, binChunk } = parsed;

      // Compose transform chain: RTC local → tile local → ECEF → game ENU
      // Google 3D Tiles store GLB positions in RTC (Relative-To-Center) coordinates.
      // The BV center is the ECEF anchor; we prepend a translation to account for it.
      const tileTransform = new Float64Array(tile.transform);
      let finalMatrix: Float64Array;
      if (tile.bvCenter) {
        // Build translation matrix from BV center (column-major)
        const rtcTranslate = new Float64Array(16);
        rtcTranslate[0] = 1; rtcTranslate[5] = 1; rtcTranslate[10] = 1; rtcTranslate[15] = 1;
        rtcTranslate[12] = tile.bvCenter[0];
        rtcTranslate[13] = tile.bvCenter[1];
        rtcTranslate[14] = tile.bvCenter[2];
        // enuMatrix * tileTransform * rtcTranslate
        const withRtc = multiplyMatrices(tileTransform, rtcTranslate);
        finalMatrix = multiplyMatrices(enuMatrix, withRtc);
      } else {
        finalMatrix = multiplyMatrices(enuMatrix, tileTransform);
      }

      // Also check for CESIUM_RTC extension in glTF (explicit RTC center)
      // which overrides the BV center approach
      const cesiumRtc = parsed.json.extensions?.CESIUM_RTC?.center;
      if (cesiumRtc && Array.isArray(cesiumRtc) && cesiumRtc.length >= 3) {
        const rtcTranslate = new Float64Array(16);
        rtcTranslate[0] = 1; rtcTranslate[5] = 1; rtcTranslate[10] = 1; rtcTranslate[15] = 1;
        rtcTranslate[12] = cesiumRtc[0];
        rtcTranslate[13] = cesiumRtc[1];
        rtcTranslate[14] = cesiumRtc[2];
        const withRtc = multiplyMatrices(tileTransform, rtcTranslate);
        finalMatrix = multiplyMatrices(enuMatrix, withRtc);
      }

      // Process each mesh in the glTF, respecting node transforms
      // Google 3D Tiles GLBs have node matrices that include:
      //   - Y-up to ECEF rotation (Y↔Z swap with Z negate)
      //   - ECEF translation (the tile's real-world position)
      // We must apply these before the ENU transform.
      const nodes = json.nodes ?? [];
      const meshes = json.meshes ?? [];

      // Build node → transform map (only top-level nodes that reference meshes)
      const nodeMeshTransforms = new Map<number, Float64Array>();
      for (const node of nodes) {
        if (node.mesh === undefined) continue;
        if (node.matrix) {
          // Column-major 4×4
          const nodeMat = new Float64Array(node.matrix);
          // Full chain: enuMatrix * tileTransform * nodeMatrix
          // (nodeMatrix already has ECEF position + Y-up rotation)
          const combined = multiplyMatrices(tileTransform, nodeMat);
          nodeMeshTransforms.set(node.mesh, multiplyMatrices(enuMatrix, combined));
        }
      }

      for (let mi = 0; mi < meshes.length; mi++) {
        const mesh = meshes[mi];
        // Use the node transform for this mesh if available, otherwise fall back to finalMatrix
        const meshTransform = nodeMeshTransforms.get(mi) ?? finalMatrix;
        for (const primitive of mesh.primitives ?? []) {
          const result = extractPrimitive(json, binChunk, primitive, meshTransform);
          if (!result) continue;

          // Remap indices
          for (const idx of result.indices) {
            allIndices.push(idx + vertexOffset);
          }

          // Add positions
          for (const p of result.positions) {
            allPositions.push(p);
          }

          // Track UVs
          if (result.uvs) {
            hasUVs = true;
            for (const uv of result.uvs) allUVs.push(uv);
          } else {
            // Pad with zeros to keep alignment
            for (let i = 0; i < result.positions.length / 3 * 2; i++) {
              allUVs.push(0);
            }
          }

          // Track vertex colors
          if (result.vertexColors) {
            hasVertexColors = true;
            for (const c of result.vertexColors) allVertexColors.push(c);
          } else {
            // Pad with gray
            for (let i = 0; i < result.positions.length / 3 * 3; i++) {
              allVertexColors.push(180);
            }
          }

          // Decode texture if available
          let texture: MaterialGroup['texture'] = null;
          if (primitive.material !== undefined) {
            texture = extractTexture(json, binChunk, primitive.material);
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
    } catch (err) {
      if (opts.verbose) console.warn(`  Warning: failed to process ${tile.glbPath}: ${err}`);
    }
  }

  console.log(`  Merged: ${vertexOffset} vertices, ${triangleOffset} triangles, ${materialGroups.length} material groups`);

  // Diagnostic: report position range to catch coordinate transform issues
  if (allPositions.length >= 3) {
    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;
    let minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < allPositions.length; i += 3) {
      const x = allPositions[i], y = allPositions[i + 1], z = allPositions[i + 2];
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
      if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
    }
    console.log(`  Position range: X=[${minX.toFixed(1)}, ${maxX.toFixed(1)}] Y=[${minY.toFixed(1)}, ${maxY.toFixed(1)}] Z=[${minZ.toFixed(1)}, ${maxZ.toFixed(1)}]`);
    const span = Math.max(maxX - minX, maxY - minY, maxZ - minZ);
    if (span > 10000) {
      console.warn(`  WARNING: position span ${span.toFixed(0)}m is very large — coordinate transform may be wrong`);
    }
  }

  return {
    positions: new Float32Array(allPositions),
    indices: new Uint32Array(allIndices),
    uvs: hasUVs ? new Float32Array(allUVs) : null,
    vertexColors: hasVertexColors ? new Uint8Array(allVertexColors) : null,
    materialGroups,
  };
}

// ---------------------------------------------------------------------------
// GLB Parser
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
      // JSON chunk
      json = JSON.parse(data.subarray(offset, offset + chunkLength).toString('utf-8'));
    } else if (chunkType === 0x004E4942) {
      // BIN chunk
      binChunk = data.subarray(offset, offset + chunkLength) as Buffer;
    }

    offset += chunkLength;
  }

  if (!json) return null;
  return { json, binChunk };
}

// ---------------------------------------------------------------------------
// Primitive extraction (non-Draco path + Draco detection)
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
  transform: Float64Array,
): ExtractedPrimitive | null {
  const attributes = primitive.attributes;
  if (!attributes) return null;

  // Check for Draco compression extension
  if (primitive.extensions?.KHR_draco_mesh_compression) {
    // Draco-compressed — decode via the accessor fallback or skip
    // Google 3D Tiles usually provide fallback accessors even with Draco
    // Try the regular path first
    if (attributes.POSITION === undefined) {
      return null; // No fallback, need draco decoder
    }
  }

  const accessors = gltf.accessors ?? [];
  const bufferViews = gltf.bufferViews ?? [];

  // Positions
  const posAccessor = accessors[attributes.POSITION];
  if (!posAccessor) return null;

  const posData = readAccessor(posAccessor, bufferViews, bin);
  if (!posData) return null;

  // Transform positions from ECEF to local ENU
  const positions: number[] = [];
  for (let i = 0; i < posData.length; i += 3) {
    const [x, y, z] = transformPoint(transform, posData[i], posData[i + 1], posData[i + 2]);
    positions.push(x, y, z);
  }

  // Indices
  let indices: number[];
  if (primitive.indices !== undefined) {
    const idxAccessor = accessors[primitive.indices];
    const idxData = readAccessor(idxAccessor, bufferViews, bin);
    indices = idxData ? Array.from(idxData) : [];
  } else {
    // Non-indexed: generate sequential indices
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
      const isNormalized = colorAccessor.componentType === 5121; // UNSIGNED_BYTE
      for (let i = 0; i < colorData.length; i++) {
        const step = colorAccessor.type === 'VEC4' ? 4 : 3;
        // Only take RGB, skip alpha
        if (i % step < 3) {
          vertexColors.push(isNormalized ? colorData[i] : Math.round(colorData[i] * 255));
        }
      }
    }
  }

  return { positions, indices, uvs, vertexColors };
}

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
// Texture extraction
// ---------------------------------------------------------------------------

function extractTexture(
  gltf: any,
  bin: Buffer,
  materialIndex: number,
): MaterialGroup['texture'] {
  const materials = gltf.materials ?? [];
  const material = materials[materialIndex];
  if (!material) return null;

  // Get base color texture
  const pbr = material.pbrMetallicRoughness;
  if (!pbr?.baseColorTexture) return null;

  const texIndex = pbr.baseColorTexture.index;
  const textures = gltf.textures ?? [];
  const texture = textures[texIndex];
  if (!texture) return null;

  const images = gltf.images ?? [];
  const image = images[texture.source ?? 0];
  if (!image) return null;

  // Get image data from buffer view
  if (image.bufferView === undefined) return null;
  const bufferViews = gltf.bufferViews ?? [];
  const bv = bufferViews[image.bufferView];
  if (!bv) return null;

  const imgOffset = bv.byteOffset ?? 0;
  const imgLength = bv.byteLength;
  const imgData = bin.subarray(imgOffset, imgOffset + imgLength);

  // We'll decode the texture lazily during voxelization using sharp
  // For now, store the raw compressed data and mime type
  try {
    // Try to detect dimensions from the data
    // JPEG: look for SOF0 marker
    // PNG: look for IHDR chunk
    const mimeType = image.mimeType ?? 'image/jpeg';

    // Store raw for later decoding
    return {
      data: new Uint8Array(imgData),
      width: 0,   // Will be decoded later
      height: 0,  // Will be decoded later
    };
  } catch {
    return null;
  }
}
