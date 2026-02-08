import { CHUNK_SIZE, MATERIAL_COLORS } from '@clawfield/shared';

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
const FACE_INFO: [number, number, number, number][] = [
  [0, 2, 1, 1],  // +X: sweep along X, U=Z, V=Y
  [0, 2, 1, -1], // -X
  [1, 0, 2, 1],  // +Y: sweep along Y, U=X, V=Z
  [1, 0, 2, -1], // -Y
  [2, 0, 1, 1],  // +Z: sweep along Z, U=X, V=Y
  [2, 0, 1, -1], // -Z
];

/** Get voxel from flat array, returns 0 for out-of-bounds */
function getLocal(voxels: Uint8Array, x: number, y: number, z: number): number {
  if (x < 0 || x >= CHUNK_SIZE || y < 0 || y >= CHUNK_SIZE || z < 0 || z >= CHUNK_SIZE) {
    return 0;
  }
  return voxels[x + y * CHUNK_SIZE + z * CHUNK_SIZE * CHUNK_SIZE];
}

/**
 * Greedy meshing: produces merged quads for a chunk.
 * For each of 6 face directions, sweeps through slices and merges
 * adjacent same-material faces into larger quads.
 */
export function greedyMesh(voxels: Uint8Array): MeshQuad[] {
  const quads: MeshQuad[] = [];

  for (let faceIdx = 0; faceIdx < 6; faceIdx++) {
    const [normalAxis, uAxis, vAxis, normalDir] = FACE_INFO[faceIdx];

    // Sweep through slices along the normal axis
    for (let d = 0; d < CHUNK_SIZE; d++) {
      // Build a 2D mask of faces that need rendering
      const mask = new Int32Array(CHUNK_SIZE * CHUNK_SIZE); // 0 = no face, >0 = material

      for (let v = 0; v < CHUNK_SIZE; v++) {
        for (let u = 0; u < CHUNK_SIZE; u++) {
          const pos = [0, 0, 0];
          pos[normalAxis] = d;
          pos[uAxis] = u;
          pos[vAxis] = v;

          const voxel = getLocal(voxels, pos[0], pos[1], pos[2]);

          // Check neighbor in normal direction
          const nPos = [pos[0], pos[1], pos[2]];
          nPos[normalAxis] += normalDir > 0 ? 1 : -1;
          const neighbor = getLocal(voxels, nPos[0], nPos[1], nPos[2]);

          // Face exists when current voxel is solid and neighbor is air
          if (voxel !== 0 && neighbor === 0) {
            mask[u + v * CHUNK_SIZE] = voxel;
          }
        }
      }

      // Greedy merge the mask into quads
      for (let v = 0; v < CHUNK_SIZE; v++) {
        for (let u = 0; u < CHUNK_SIZE;) {
          const mat = mask[u + v * CHUNK_SIZE];
          if (mat === 0) {
            u++;
            continue;
          }

          // Find width: extend u while same material
          let w = 1;
          while (u + w < CHUNK_SIZE && mask[(u + w) + v * CHUNK_SIZE] === mat) {
            w++;
          }

          // Find height: extend v while entire row matches
          let h = 1;
          let done = false;
          while (v + h < CHUNK_SIZE && !done) {
            for (let k = 0; k < w; k++) {
              if (mask[(u + k) + (v + h) * CHUNK_SIZE] !== mat) {
                done = true;
                break;
              }
            }
            if (!done) h++;
          }

          // Build the quad position
          const pos = [0, 0, 0];
          pos[normalAxis] = normalDir > 0 ? d + 1 : d;
          pos[uAxis] = u;
          pos[vAxis] = v;

          const quad: MeshQuad = {
            x: pos[0],
            y: pos[1],
            z: pos[2],
            w,
            h,
            face: faceIdx,
            material: mat,
          };
          quads.push(quad);

          // Clear the mask
          for (let dv = 0; dv < h; dv++) {
            for (let du = 0; du < w; du++) {
              mask[(u + du) + (v + dv) * CHUNK_SIZE] = 0;
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
  indices: Uint32Array;
} {
  const vertexCount = quads.length * 4; // 4 unique vertices per quad
  const indexCount = quads.length * 6;   // 6 indices (2 triangles) per quad
  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  const colors = new Float32Array(vertexCount * 3);
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

    // Color from material
    const colorHex = MATERIAL_COLORS[quad.material] ?? 0xff00ff;
    const r = ((colorHex >> 16) & 0xff) / 255;
    const g = ((colorHex >> 8) & 0xff) / 255;
    const b = (colorHex & 0xff) / 255;

    // Apply face shading for depth perception
    let shade = 1.0;
    if (normalAxis === 1) {
      shade = normalDir > 0 ? 1.0 : 0.5; // top bright, bottom dark
    } else if (normalAxis === 0) {
      shade = 0.8; // sides slightly darker
    } else {
      shade = 0.7;
    }

    const sr = r * shade;
    const sg = g * shade;
    const sb = b * shade;

    // Emit 4 unique vertices: v0, v1, v2, v3
    const verts = [v0, v1, v2, v3];
    for (const vertex of verts) {
      positions[vi * 3] = vertex[0];
      positions[vi * 3 + 1] = vertex[1];
      positions[vi * 3 + 2] = vertex[2];
      normals[vi * 3] = normal[0];
      normals[vi * 3 + 1] = normal[1];
      normals[vi * 3 + 2] = normal[2];
      colors[vi * 3] = sr;
      colors[vi * 3 + 1] = sg;
      colors[vi * 3 + 2] = sb;
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

  return { positions, normals, colors, indices };
}
