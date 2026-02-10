import { CHUNK_SIZE, MATERIAL_COLORS, isWater } from '@clawfield/shared';
import { FALLBACK_TILE, getTileForFace, MATERIAL_TILES } from './texture-atlas';

/** A quad produced by the greedy mesher */
export interface MeshQuad {
  // Position of the quad's corner in local chunk coordinates
  x: number;
  y: number;
  z: number;
  // Width and height of the quad (in the two axes of the face)
  w: number;
  h: number;
  // Which face direction (0-5: +x, -x, +y, -y, +z, -z)
  face: number;
  // Material ID
  material: number;
  // Per-vertex AO: [corner00, corner10, corner11, corner01] (0=dark, 3=bright)
  ao: [number, number, number, number];
}

// Face normals and axis mappings
// For each face: [normalAxis, uAxis, vAxis, normalDir]
// uAxis × vAxis must equal +normalAxis for correct front-face winding
const FACE_INFO: [number, number, number, number][] = [
  [0, 1, 2, 1],  // +X: normal=X, U=Y, V=Z  (Y×Z = +X)
  [0, 1, 2, -1], // -X
  [1, 2, 0, 1],  // +Y: normal=Y, U=Z, V=X  (Z×X = +Y)
  [1, 2, 0, -1], // -Y
  [2, 0, 1, 1],  // +Z: normal=Z, U=X, V=Y  (X×Y = +Z)
  [2, 0, 1, -1], // -Z
];

/** Get voxel from flat array, returns 0 for out-of-bounds */
function getLocal(voxels: Uint8Array, x: number, y: number, z: number, gridSize: number = CHUNK_SIZE): number {
  if (x < 0 || x >= gridSize || y < 0 || y >= gridSize || z < 0 || z >= gridSize) {
    return 0;
  }
  return voxels[x + y * gridSize + z * gridSize * gridSize];
}

/**
 * Compute ambient occlusion for one vertex of a voxel face.
 *
 * For a vertex at a corner of a face, we sample the 3 diagonal neighbor voxels:
 * - side1: neighbor along the U axis of the face
 * - side2: neighbor along the V axis of the face
 * - corner: diagonal neighbor (both U and V offset)
 *
 * AO = 3 (fully lit) when all 3 are air.
 * AO = 0 (fully dark) when both sides are solid (corner is irrelevant).
 *
 * @param cornerU - -1 or +1 offset in U axis direction for this corner
 * @param cornerV - -1 or +1 offset in V axis direction for this corner
 */
function computeVertexAO(
  voxels: Uint8Array,
  x: number, y: number, z: number,
  normalAxis: number, normalDir: number,
  uAxis: number, vAxis: number,
  cornerU: number, cornerV: number,
  gridSize: number,
): number {
  // Base position: the face sits on the voxel at (x,y,z), offset by normalDir
  const base = [x, y, z];
  base[normalAxis] += normalDir > 0 ? 1 : -1;

  // side1: offset in U direction
  const s1 = [base[0], base[1], base[2]];
  s1[uAxis] += cornerU;
  const side1 = getLocal(voxels, s1[0], s1[1], s1[2], gridSize) !== 0 ? 1 : 0;

  // side2: offset in V direction
  const s2 = [base[0], base[1], base[2]];
  s2[vAxis] += cornerV;
  const side2 = getLocal(voxels, s2[0], s2[1], s2[2], gridSize) !== 0 ? 1 : 0;

  // corner: offset in both U and V
  let corner: number;
  if (side1 && side2) {
    // Both sides solid → corner is fully occluded (optimization + correct AO)
    corner = 1;
  } else {
    const c = [base[0], base[1], base[2]];
    c[uAxis] += cornerU;
    c[vAxis] += cornerV;
    corner = getLocal(voxels, c[0], c[1], c[2], gridSize) !== 0 ? 1 : 0;
  }

  return 3 - (side1 + side2 + corner);
}

/**
 * Compute all 4 corner AO values for a single voxel face.
 * Corners ordered as: [v0(u=0,v=0), v1(u=1,v=0), v2(u=1,v=1), v3(u=0,v=1)]
 * where u,v are the face-local axes.
 */
function computeFaceAO(
  voxels: Uint8Array,
  x: number, y: number, z: number,
  normalAxis: number, normalDir: number,
  uAxis: number, vAxis: number,
  gridSize: number,
): [number, number, number, number] {
  return [
    computeVertexAO(voxels, x, y, z, normalAxis, normalDir, uAxis, vAxis, -1, -1, gridSize), // u=0, v=0
    computeVertexAO(voxels, x, y, z, normalAxis, normalDir, uAxis, vAxis, +1, -1, gridSize), // u=1, v=0
    computeVertexAO(voxels, x, y, z, normalAxis, normalDir, uAxis, vAxis, +1, +1, gridSize), // u=1, v=1
    computeVertexAO(voxels, x, y, z, normalAxis, normalDir, uAxis, vAxis, -1, +1, gridSize), // u=0, v=1
  ];
}

/**
 * Encode AO values for greedy merge mask.
 * Pack 4 AO values (0-3 each) into a single int alongside material:
 * bits 0-7: material, bits 8-9: ao0, bits 10-11: ao1, bits 12-13: ao2, bits 14-15: ao3
 * Returns 0 when material is 0 (no face).
 */
function encodeAOMask(material: number, ao: [number, number, number, number]): number {
  if (material === 0) return 0;
  return material | (ao[0] << 8) | (ao[1] << 10) | (ao[2] << 12) | (ao[3] << 14);
}

/** Decode material from AO-encoded mask */
function decodeMaterial(encoded: number): number {
  return encoded & 0xff;
}

/** Decode AO values from AO-encoded mask */
function decodeAO(encoded: number): [number, number, number, number] {
  return [
    (encoded >> 8) & 3,
    (encoded >> 10) & 3,
    (encoded >> 12) & 3,
    (encoded >> 14) & 3,
  ];
}

/**
 * Greedy meshing: produces merged quads for a chunk.
 * For each of 6 face directions, sweeps through slices and merges
 * adjacent same-material faces into larger quads.
 *
 * When waterPass is true, only meshes water voxels.
 * When waterPass is false (default), only meshes solid (non-water) voxels.
 * Face culling: solid faces show when neighbor is air OR water.
 * Water faces show when neighbor is air (not solid, not water).
 *
 * @param voxels - Flat voxel array (gridSize^3 elements)
 * @param waterPass - If true, mesh only water; if false, mesh only solid
 * @param gridSize - Dimension of the grid (default CHUNK_SIZE=16, or 8/4 for LOD)
 * @param scale - Multiplier for output quad positions/sizes (default 1, or 2/4 for LOD)
 * @param skipWaterFilter - If true, treat all non-zero voxels as solid (for voxel objects
 *   whose palette indices have no relation to terrain water material IDs)
 */
export function greedyMesh(voxels: Uint8Array, waterPass: boolean = false, gridSize: number = CHUNK_SIZE, scale: number = 1, skipWaterFilter: boolean = false): MeshQuad[] {
  const quads: MeshQuad[] = [];

  for (let faceIdx = 0; faceIdx < 6; faceIdx++) {
    const [normalAxis, uAxis, vAxis, normalDir] = FACE_INFO[faceIdx];

    // Sweep through slices along the normal axis
    for (let d = 0; d < gridSize; d++) {
      // Build a 2D mask encoding material + AO (0 = no face)
      const mask = new Int32Array(gridSize * gridSize);

      for (let v = 0; v < gridSize; v++) {
        for (let u = 0; u < gridSize; u++) {
          const pos = [0, 0, 0];
          pos[normalAxis] = d;
          pos[uAxis] = u;
          pos[vAxis] = v;

          const voxel = getLocal(voxels, pos[0], pos[1], pos[2], gridSize);

          // Skip voxels not in the current pass
          if (skipWaterFilter) {
            if (voxel === 0) continue;
          } else if (waterPass) {
            if (!isWater(voxel)) continue;
          } else {
            if (voxel === 0 || isWater(voxel)) continue;
          }

          // Check neighbor in normal direction
          const nPos = [pos[0], pos[1], pos[2]];
          nPos[normalAxis] += normalDir > 0 ? 1 : -1;
          const neighbor = getLocal(voxels, nPos[0], nPos[1], nPos[2], gridSize);

          let showFace = false;
          if (skipWaterFilter) {
            showFace = neighbor === 0;
          } else if (waterPass) {
            showFace = neighbor === 0;
          } else {
            showFace = neighbor === 0 || isWater(neighbor);
          }

          if (showFace) {
            const ao = computeFaceAO(
              voxels, pos[0], pos[1], pos[2],
              normalAxis, normalDir, uAxis, vAxis, gridSize,
            );
            mask[u + v * gridSize] = encodeAOMask(voxel, ao);
          }
        }
      }

      // Greedy merge the mask into quads (AO encoded in mask ensures AO-matching)
      for (let v = 0; v < gridSize; v++) {
        for (let u = 0; u < gridSize;) {
          const encoded = mask[u + v * gridSize];
          if (encoded === 0) {
            u++;
            continue;
          }

          // Find width: extend u while encoded value matches
          let w = 1;
          while (u + w < gridSize && mask[(u + w) + v * gridSize] === encoded) {
            w++;
          }

          // Find height: extend v while entire row matches
          let h = 1;
          let done = false;
          while (v + h < gridSize && !done) {
            for (let k = 0; k < w; k++) {
              if (mask[(u + k) + (v + h) * gridSize] !== encoded) {
                done = true;
                break;
              }
            }
            if (!done) h++;
          }

          // Build the quad position (scaled to world space for LOD)
          const pos = [0, 0, 0];
          pos[normalAxis] = (normalDir > 0 ? d + 1 : d) * scale;
          pos[uAxis] = u * scale;
          pos[vAxis] = v * scale;

          const quad: MeshQuad = {
            x: pos[0],
            y: pos[1],
            z: pos[2],
            w: w * scale,
            h: h * scale,
            face: faceIdx,
            material: decodeMaterial(encoded),
            ao: decodeAO(encoded),
          };
          quads.push(quad);

          // Clear the mask
          for (let dv = 0; dv < h; dv++) {
            for (let du = 0; du < w; du++) {
              mask[(u + du) + (v + dv) * gridSize] = 0;
            }
          }

          u += w;
        }
      }
    }
  }

  return quads;
}

/**
 * Convert greedy mesh quads to indexed geometry data (4 verts + 6 indices per quad).
 *
 * @param quads - Output from greedyMesh()
 * @param paletteOverride - Optional per-object palette (hex colors indexed by material).
 *   When provided, all quads use the fallback tile and vertex colors come from this
 *   palette instead of the global MATERIAL_COLORS. Used for voxel objects with their
 *   own color palettes.
 */
export function quadsToGeometryData(quads: MeshQuad[], paletteOverride?: number[]): {
  positions: Float32Array;
  normals: Float32Array;
  colors: Float32Array;
  uvs: Float32Array;
  ao: Float32Array;
  indices: Uint32Array;
} {
  const vertexCount = quads.length * 4; // 4 unique vertices per quad
  const indexCount = quads.length * 6;   // 6 indices (2 triangles) per quad
  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  const colors = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);
  const ao = new Float32Array(vertexCount);
  const indices = new Uint32Array(indexCount);

  let vi = 0; // vertex index
  let ii = 0; // index index

  for (const quad of quads) {
    const [normalAxis, uAxis, vAxis, normalDir] = FACE_INFO[quad.face];

    // Normal vector
    const normal = [0, 0, 0];
    normal[normalAxis] = normalDir;

    // Quad corners
    const corner = [quad.x, quad.y, quad.z];
    const du = [0, 0, 0];
    const dv = [0, 0, 0];
    du[uAxis] = quad.w;
    dv[vAxis] = quad.h;

    // 4 corners of the quad: v0(0,0), v1(u,0), v2(u,v), v3(0,v)
    const v0 = [corner[0], corner[1], corner[2]];
    const v1 = [corner[0] + du[0], corner[1] + du[1], corner[2] + du[2]];
    const v2 = [corner[0] + du[0] + dv[0], corner[1] + du[1] + dv[1], corner[2] + du[2] + dv[2]];
    const v3 = [corner[0] + dv[0], corner[1] + dv[1], corner[2] + dv[2]];

    // Per-vertex AO normalized to [0,1]: 0=fully dark, 1=fully lit
    const ao0 = quad.ao[0] / 3;
    const ao1 = quad.ao[1] / 3;
    const ao2 = quad.ao[2] / 3;
    const ao3 = quad.ao[3] / 3;

    // Per-face directional shade factor
    let shade = 1.0;
    if (normalAxis === 1) {
      shade = normalDir > 0 ? 1.0 : 0.75; // top full, bottom slightly darker
    } else if (normalAxis === 0) {
      shade = 0.92; // X-facing sides
    } else {
      shade = 0.88; // Z-facing sides
    }

    // Use atlas tile texture if the material has one, otherwise fall back to white tile
    // (which passes palette RGB through via vertex colors).
    // When paletteOverride is provided (voxel objects), always use fallback tile + object palette.
    const hasAtlasTile = !paletteOverride && MATERIAL_TILES[quad.material] !== undefined;
    const tile = hasAtlasTile ? getTileForFace(quad.material, quad.face) : FALLBACK_TILE;

    let sr: number, sg: number, sb: number;
    if (hasAtlasTile) {
      // Atlas texture provides color; vertex color is shade-only
      sr = shade;
      sg = shade;
      sb = shade;
    } else {
      // Fallback: palette RGB * shade (atlas samples white tile = neutral)
      const hex = (paletteOverride ? paletteOverride[quad.material] : MATERIAL_COLORS[quad.material]) ?? 0xff00ff;
      sr = ((hex >> 16) & 0xff) / 255 * shade;
      sg = ((hex >> 8) & 0xff) / 255 * shade;
      sb = (hex & 0xff) / 255 * shade;
    }

    // UV: tile base index. The shader uses fract(vWorldPosition) for local UV,
    // so all 4 vertices share the same tile base (floor(vUv) = tileBase).
    // Add 0.5 so floor() is stable across the quad.
    const tileU = tile[0] + 0.5;
    const tileV = tile[1] + 0.5;
    const uv0: [number, number] = [tileU, tileV];
    const uv1: [number, number] = [tileU, tileV];
    const uv2: [number, number] = [tileU, tileV];
    const uv3: [number, number] = [tileU, tileV];

    // Emit 4 unique vertices: v0, v1, v2, v3
    const verts = [v0, v1, v2, v3];
    const vertUvs = [uv0, uv1, uv2, uv3];
    const vertAO = [ao0, ao1, ao2, ao3];
    for (let i = 0; i < 4; i++) {
      const vertex = verts[i];
      positions[vi * 3] = vertex[0];
      positions[vi * 3 + 1] = vertex[1];
      positions[vi * 3 + 2] = vertex[2];
      normals[vi * 3] = normal[0];
      normals[vi * 3 + 1] = normal[1];
      normals[vi * 3 + 2] = normal[2];
      colors[vi * 3] = sr;
      colors[vi * 3 + 1] = sg;
      colors[vi * 3 + 2] = sb;
      uvs[vi * 2] = vertUvs[i][0];
      uvs[vi * 2 + 1] = vertUvs[i][1];
      ao[vi] = vertAO[i];
      vi++;
    }

    // Anisotropy fix: flip the quad diagonal when AO values create an asymmetry.
    // Without this, the interpolation diagonal can "lean" the wrong way, causing
    // visible AO artifacts. When ao0+ao2 < ao1+ao3, flip to use the other diagonal.
    const base = vi - 4;
    const flipDiag = quad.ao[0] + quad.ao[2] < quad.ao[1] + quad.ao[3];

    if (normalDir > 0) {
      if (flipDiag) {
        // Flipped diagonal: v1, v2, v3,  v1, v3, v0
        indices[ii++] = base + 1;
        indices[ii++] = base + 2;
        indices[ii++] = base + 3;
        indices[ii++] = base + 1;
        indices[ii++] = base + 3;
        indices[ii++] = base;
      } else {
        // Normal diagonal: v0, v1, v2,  v0, v2, v3
        indices[ii++] = base;
        indices[ii++] = base + 1;
        indices[ii++] = base + 2;
        indices[ii++] = base;
        indices[ii++] = base + 2;
        indices[ii++] = base + 3;
      }
    } else {
      if (flipDiag) {
        // Flipped diagonal: v0, v3, v2,  v0, v2, v1 → flip to v1, v0, v3,  v1, v3, v2
        indices[ii++] = base + 1;
        indices[ii++] = base;
        indices[ii++] = base + 3;
        indices[ii++] = base + 1;
        indices[ii++] = base + 3;
        indices[ii++] = base + 2;
      } else {
        // Normal: v0, v3, v2,  v0, v2, v1
        indices[ii++] = base;
        indices[ii++] = base + 3;
        indices[ii++] = base + 2;
        indices[ii++] = base;
        indices[ii++] = base + 2;
        indices[ii++] = base + 1;
      }
    }
  }

  return { positions, normals, colors, uvs, ao, indices };
}
