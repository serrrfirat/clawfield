import { CHUNK_SIZE, MATERIAL_COLORS, isWater, MAT_GRASS, MAT_DIRT, MAT_STONE, MAT_WALL, MAT_ROOF, MAT_WATER } from '@clawfield/shared';
import { FALLBACK_TILE, getTileForFace, MATERIAL_TILES } from './texture-atlas';

/**
 * Original hardcoded colors for the 6 known materials. When a map loads a custom
 * palette that overrides these indices, the atlas tile textures would be wrong
 * (e.g. sand showing grass texture). We only use atlas tiles when the current
 * palette color matches the expected color.
 */
const EXPECTED_COLORS: Record<number, number> = {
  [MAT_GRASS]: 0x4a8c3f,
  [MAT_DIRT]: 0x7a5c3a,
  [MAT_STONE]: 0x888888,
  [MAT_WALL]: 0xa0a0a0,
  [MAT_ROOF]: 0x555555,
  [MAT_WATER]: 0x2389da,
};

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
 */
export function greedyMesh(voxels: Uint8Array, waterPass: boolean = false, gridSize: number = CHUNK_SIZE, scale: number = 1): MeshQuad[] {
  const quads: MeshQuad[] = [];

  for (let faceIdx = 0; faceIdx < 6; faceIdx++) {
    const [normalAxis, uAxis, vAxis, normalDir] = FACE_INFO[faceIdx];

    // Sweep through slices along the normal axis
    for (let d = 0; d < gridSize; d++) {
      // Build a 2D mask of faces that need rendering
      const mask = new Int32Array(gridSize * gridSize); // 0 = no face, >0 = material

      for (let v = 0; v < gridSize; v++) {
        for (let u = 0; u < gridSize; u++) {
          const pos = [0, 0, 0];
          pos[normalAxis] = d;
          pos[uAxis] = u;
          pos[vAxis] = v;

          const voxel = getLocal(voxels, pos[0], pos[1], pos[2], gridSize);

          // Skip voxels not in the current pass
          if (waterPass) {
            if (!isWater(voxel)) continue;
          } else {
            if (voxel === 0 || isWater(voxel)) continue;
          }

          // Check neighbor in normal direction
          const nPos = [pos[0], pos[1], pos[2]];
          nPos[normalAxis] += normalDir > 0 ? 1 : -1;
          const neighbor = getLocal(voxels, nPos[0], nPos[1], nPos[2], gridSize);

          if (waterPass) {
            // Water faces: show when neighbor is air (0) or out-of-chunk (0)
            if (neighbor === 0) {
              mask[u + v * gridSize] = voxel;
            }
          } else {
            // Solid faces: show when neighbor is air or water
            if (neighbor === 0 || isWater(neighbor)) {
              mask[u + v * gridSize] = voxel;
            }
          }
        }
      }

      // Greedy merge the mask into quads
      for (let v = 0; v < gridSize; v++) {
        for (let u = 0; u < gridSize;) {
          const mat = mask[u + v * gridSize];
          if (mat === 0) {
            u++;
            continue;
          }

          // Find width: extend u while same material
          let w = 1;
          while (u + w < gridSize && mask[(u + w) + v * gridSize] === mat) {
            w++;
          }

          // Find height: extend v while entire row matches
          let h = 1;
          let done = false;
          while (v + h < gridSize && !done) {
            for (let k = 0; k < w; k++) {
              if (mask[(u + k) + (v + h) * gridSize] !== mat) {
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
            material: mat,
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

/** Convert greedy mesh quads to indexed geometry data (4 verts + 6 indices per quad) */
export function quadsToGeometryData(quads: MeshQuad[]): {
  positions: Float32Array;
  normals: Float32Array;
  colors: Float32Array;
  uvs: Float32Array;
  indices: Uint32Array;
} {
  const vertexCount = quads.length * 4; // 4 unique vertices per quad
  const indexCount = quads.length * 6;   // 6 indices (2 triangles) per quad
  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  const colors = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);
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

    // 4 corners of the quad
    const v0 = [corner[0], corner[1], corner[2]];
    const v1 = [corner[0] + du[0], corner[1] + du[1], corner[2] + du[2]];
    const v2 = [corner[0] + du[0] + dv[0], corner[1] + du[1] + dv[1], corner[2] + du[2] + dv[2]];
    const v3 = [corner[0] + dv[0], corner[1] + dv[1], corner[2] + dv[2]];

    // Per-face directional shade factor
    let shade = 1.0;
    if (normalAxis === 1) {
      shade = normalDir > 0 ? 1.0 : 0.75; // top full, bottom slightly darker
    } else if (normalAxis === 0) {
      shade = 0.92; // X-facing sides
    } else {
      shade = 0.88; // Z-facing sides
    }

    // Determine tile and vertex color based on whether the material has matching atlas tiles.
    // Only use atlas tiles when the palette color matches the expected hardcoded color —
    // custom maps (e.g. Shoreline) override palette indices 1-6 with different colors,
    // so the grass/dirt/stone textures would be wrong.
    const hasAtlasTile = MATERIAL_TILES[quad.material] !== undefined
      && MATERIAL_COLORS[quad.material] === EXPECTED_COLORS[quad.material];
    const tile = hasAtlasTile ? getTileForFace(quad.material, quad.face) : FALLBACK_TILE;

    let sr: number, sg: number, sb: number;
    if (hasAtlasTile) {
      // Atlas texture provides color; vertex color is shade-only
      sr = shade;
      sg = shade;
      sb = shade;
    } else {
      // Fallback: palette RGB * shade (atlas samples white tile = neutral)
      const hex = MATERIAL_COLORS[quad.material] ?? 0xff00ff;
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
      vi++;
    }

    // 6 indices forming 2 triangles, winding order depends on normal direction
    const base = vi - 4;
    if (normalDir > 0) {
      // v0, v1, v2,  v0, v2, v3
      indices[ii++] = base;
      indices[ii++] = base + 1;
      indices[ii++] = base + 2;
      indices[ii++] = base;
      indices[ii++] = base + 2;
      indices[ii++] = base + 3;
    } else {
      // v0, v3, v2,  v0, v2, v1
      indices[ii++] = base;
      indices[ii++] = base + 3;
      indices[ii++] = base + 2;
      indices[ii++] = base;
      indices[ii++] = base + 2;
      indices[ii++] = base + 1;
    }
  }

  return { positions, normals, colors, uvs, indices };
}
