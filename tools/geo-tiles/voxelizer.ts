/**
 * voxelizer.ts — Convert merged triangle mesh to a voxel grid.
 *
 * Two-pass approach:
 *   Pass 1: Column raycasting — casts downward rays per (x,z) cell to fill solid volumes.
 *   Pass 2: Surface rasterization — iterates every triangle and rasterizes its surface
 *           into the grid, catching thin walls and tile-boundary seams that rays miss.
 *
 * Color sampling uses decoded textures (via sharp) with barycentric UV interpolation,
 * falling back to vertex colors, then gray.
 */

import sharp from 'sharp';
import type { MergedScene, MaterialGroup, VoxelGrid, RGB, CLIOptions } from './types.js';

const CHUNK_SIZE = 16;

// ---------------------------------------------------------------------------
// Decoded texture cache
// ---------------------------------------------------------------------------

interface DecodedTexture {
  rgba: Buffer;
  width: number;
  height: number;
}

const textureDecodeCache = new Map<Uint8Array, DecodedTexture | null>();

/**
 * Decode a MaterialGroup's compressed texture (JPEG/PNG) into raw RGBA.
 * Caches by raw data reference so each image is decoded once.
 */
async function decodeTextureIfNeeded(
  group: MaterialGroup,
): Promise<DecodedTexture | null> {
  if (!group.texture || group.texture.data.length === 0) return null;

  const cached = textureDecodeCache.get(group.texture.data);
  if (cached !== undefined) return cached;

  try {
    const img = sharp(Buffer.from(group.texture.data));
    const meta = await img.metadata();
    if (!meta.width || !meta.height) {
      textureDecodeCache.set(group.texture.data, null);
      return null;
    }
    const rgba = await img.raw().ensureAlpha().toBuffer();

    const decoded: DecodedTexture = {
      rgba,
      width: meta.width,
      height: meta.height,
    };

    // Write real dimensions back into the MaterialGroup
    group.texture.width = meta.width;
    group.texture.height = meta.height;

    textureDecodeCache.set(group.texture.data, decoded);
    return decoded;
  } catch {
    textureDecodeCache.set(group.texture.data, null);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Barycentric utilities
// ---------------------------------------------------------------------------

/**
 * Compute barycentric coordinates of point (px, pz) with respect to
 * triangle projected onto the XZ plane.
 * Returns [u, v, w] where u + v + w ≈ 1, or null if degenerate.
 */
function barycentricXZ(
  px: number, pz: number,
  x0: number, z0: number,
  x1: number, z1: number,
  x2: number, z2: number,
): [number, number, number] | null {
  const d00 = (x1 - x0) * (x1 - x0) + (z1 - z0) * (z1 - z0);
  const d01 = (x1 - x0) * (x2 - x0) + (z1 - z0) * (z2 - z0);
  const d11 = (x2 - x0) * (x2 - x0) + (z2 - z0) * (z2 - z0);
  const d20 = (px - x0) * (x1 - x0) + (pz - z0) * (z1 - z0);
  const d21 = (px - x0) * (x2 - x0) + (pz - z0) * (z2 - z0);

  const denom = d00 * d11 - d01 * d01;
  if (Math.abs(denom) < 1e-12) return null;

  const v = (d11 * d20 - d01 * d21) / denom;
  const w = (d00 * d21 - d01 * d20) / denom;
  const u = 1.0 - v - w;

  return [u, v, w];
}

/**
 * Sample a decoded texture at UV coordinates. Nearest-neighbor, UV wrapping.
 */
function sampleTextureAt(decoded: DecodedTexture, u: number, v: number): RGB {
  const wu = ((u % 1) + 1) % 1;
  const wv = ((v % 1) + 1) % 1;

  const px = Math.min(Math.floor(wu * decoded.width), decoded.width - 1);
  const py = Math.min(Math.floor(wv * decoded.height), decoded.height - 1);
  const offset = (py * decoded.width + px) * 4;

  return {
    r: decoded.rgba[offset],
    g: decoded.rgba[offset + 1],
    b: decoded.rgba[offset + 2],
  };
}

// ---------------------------------------------------------------------------
// Color sampling
// ---------------------------------------------------------------------------

/**
 * Sample the color at a world-space point (sampleX, sampleZ) on a triangle.
 *
 * Priority:
 * 1. Texture via barycentric UV interpolation
 * 2. Vertex color via barycentric interpolation
 * 3. Flat gray fallback
 */
function sampleTriangleColor(
  scene: MergedScene,
  tri: Triangle,
  sampleX: number,
  sampleZ: number,
  decodedTextures: Map<number, DecodedTexture | null>,
): RGB {
  const bary = barycentricXZ(
    sampleX, sampleZ,
    tri.x0, tri.z0,
    tri.x1, tri.z1,
    tri.x2, tri.z2,
  );

  const idx = scene.indices;
  const i0 = idx[tri.originalIndex * 3];
  const i1 = idx[tri.originalIndex * 3 + 1];
  const i2 = idx[tri.originalIndex * 3 + 2];

  // Try texture sampling
  const decoded = decodedTextures.get(tri.groupIndex);
  if (decoded && scene.uvs && bary) {
    const [u, v, w] = bary;
    const uvs = scene.uvs;
    const texU = u * uvs[i0 * 2] + v * uvs[i1 * 2] + w * uvs[i2 * 2];
    const texV = u * uvs[i0 * 2 + 1] + v * uvs[i1 * 2 + 1] + w * uvs[i2 * 2 + 1];
    return sampleTextureAt(decoded, texU, texV);
  }

  // Fall back to vertex colors with barycentric interpolation
  if (scene.vertexColors) {
    const vc = scene.vertexColors;
    if (bary) {
      const [u, v, w] = bary;
      return {
        r: Math.round(u * vc[i0 * 3] + v * vc[i1 * 3] + w * vc[i2 * 3]),
        g: Math.round(u * vc[i0 * 3 + 1] + v * vc[i1 * 3 + 1] + w * vc[i2 * 3 + 1]),
        b: Math.round(u * vc[i0 * 3 + 2] + v * vc[i1 * 3 + 2] + w * vc[i2 * 3 + 2]),
      };
    }
    // Degenerate XZ projection — average
    return {
      r: Math.round((vc[i0 * 3] + vc[i1 * 3] + vc[i2 * 3]) / 3),
      g: Math.round((vc[i0 * 3 + 1] + vc[i1 * 3 + 1] + vc[i2 * 3 + 1]) / 3),
      b: Math.round((vc[i0 * 3 + 2] + vc[i1 * 3 + 2] + vc[i2 * 3 + 2]) / 3),
    };
  }

  return { r: 180, g: 180, b: 180 };
}

// ---------------------------------------------------------------------------
// Main voxelization
// ---------------------------------------------------------------------------

/**
 * Voxelize a merged scene into a 3D grid.
 * Each voxel = 1 meter (or opts.voxelSize).
 */
export async function voxelize(
  scene: MergedScene,
  opts: CLIOptions,
): Promise<VoxelGrid> {
  console.log('Voxelizing scene...');

  // Compute mesh bounds
  const positions = scene.positions;
  let xMin = Infinity, xMax = -Infinity;
  let yMin = Infinity, yMax = -Infinity;
  let zMin = Infinity, zMax = -Infinity;

  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i], y = positions[i + 1], z = positions[i + 2];
    if (x < xMin) xMin = x; if (x > xMax) xMax = x;
    if (y < yMin) yMin = y; if (y > yMax) yMax = y;
    if (z < zMin) zMin = z; if (z > zMax) zMax = z;
  }

  // Convert to voxel grid coordinates, clipped to requested radius
  const vs = opts.voxelSize;
  const clipR = Math.ceil(opts.radius * 1.5 / vs);
  const gxMin = Math.max(Math.floor(xMin / vs), -clipR);
  const gxMax = Math.min(Math.ceil(xMax / vs), clipR);
  const gyMin = Math.floor(yMin / vs) - 2; // Padding below
  const gyMax = Math.ceil(yMax / vs) + 2;  // Padding above
  const gzMin = Math.max(Math.floor(zMin / vs), -clipR);
  const gzMax = Math.min(Math.ceil(zMax / vs), clipR);

  console.log(`  Mesh bounds: X[${xMin.toFixed(1)}, ${xMax.toFixed(1)}] Y[${yMin.toFixed(1)}, ${yMax.toFixed(1)}] Z[${zMin.toFixed(1)}, ${zMax.toFixed(1)}]`);
  console.log(`  Voxel grid: X[${gxMin}, ${gxMax}] Y[${gyMin}, ${gyMax}] Z[${gzMin}, ${gzMax}]`);
  console.log(`  Grid size: ${gxMax - gxMin} × ${gyMax - gyMin} × ${gzMax - gzMin}`);
  console.log(`  Ray columns: ${(gxMax - gxMin) * (gzMax - gzMin)}`);

  // Build triangle list for ray-triangle intersection
  const triangles = buildTriangleList(scene);

  // Build simple spatial grid acceleration structure
  const grid = buildSpatialGrid(triangles, vs, gxMin, gzMin, gxMax, gzMax);

  // --- Decode textures ---
  console.log('  Decoding textures...');
  const decodedTextures = new Map<number, DecodedTexture | null>();

  // Group material groups by shared texture data to decode each image once
  const groupsByTexRef = new Map<Uint8Array, number[]>();
  for (let gi = 0; gi < scene.materialGroups.length; gi++) {
    const group = scene.materialGroups[gi];
    if (group.texture && group.texture.data.length > 0) {
      const existing = groupsByTexRef.get(group.texture.data);
      if (existing) {
        existing.push(gi);
      } else {
        groupsByTexRef.set(group.texture.data, [gi]);
      }
    }
  }

  let decodedCount = 0;
  for (const [, groupIndices] of groupsByTexRef) {
    const group = scene.materialGroups[groupIndices[0]];
    const decoded = await decodeTextureIfNeeded(group);
    for (const gi of groupIndices) {
      decodedTextures.set(gi, decoded);
    }
    if (decoded) decodedCount++;
  }
  console.log(`  Decoded ${decodedCount} textures (${groupsByTexRef.size} unique images)`);

  // --- Pass 1: Column raycasting ---

  const chunks = new Map<string, Uint8Array>();
  const colorMap = new Map<string, RGB>();

  let columnsProcessed = 0;
  const totalColumns = (gxMax - gxMin) * (gzMax - gzMin);
  const reportInterval = Math.max(1, Math.floor(totalColumns / 20));

  for (let gx = gxMin; gx < gxMax; gx++) {
    for (let gz = gzMin; gz < gzMax; gz++) {
      columnsProcessed++;
      if (columnsProcessed % reportInterval === 0) {
        const pct = ((columnsProcessed / totalColumns) * 100).toFixed(0);
        process.stdout.write(`\r  Pass 1 (raycast): ${pct}% (${columnsProcessed}/${totalColumns} columns)`);
      }

      // Get triangles that might intersect this column
      const cellKey = `${gx},${gz}`;
      const cellTriangles = grid.get(cellKey);
      if (!cellTriangles || cellTriangles.length === 0) continue;

      // Cast downward ray at center of voxel column
      const rayX = (gx + 0.5) * vs;
      const rayZ = (gz + 0.5) * vs;
      const rayOriginY = (gyMax + 10) * vs;

      // Collect all intersection Y values
      const hits: { y: number; entering: boolean; triIdx: number }[] = [];

      for (const triIdx of cellTriangles) {
        const tri = triangles[triIdx];
        const hitY = rayTriangleIntersectY(rayX, rayOriginY, rayZ, tri);
        if (hitY !== null) {
          const entering = tri.normalY <= 0;
          hits.push({ y: hitY, entering, triIdx });
        }
      }

      if (hits.length === 0) continue;

      // Sort hits from top to bottom
      hits.sort((a, b) => b.y - a.y);

      // Process hits: pair enter/exit to fill solid regions
      let inside = false;
      let prevY = gyMax;
      let enterColor: RGB = { r: 160, g: 160, b: 160 };

      for (const hit of hits) {
        const hitVoxelY = Math.floor(hit.y / vs);

        if (!inside) {
          inside = true;

          const color = sampleTriangleColor(scene, triangles[hit.triIdx], rayX, rayZ, decodedTextures);
          enterColor = color;
          const vy = hitVoxelY;
          setVoxel(chunks, gx, vy, gz);
          colorMap.set(`${gx},${vy},${gz}`, color);

          // Fill a few voxels below for ground thickness
          for (let fill = 1; fill <= 2; fill++) {
            setVoxel(chunks, gx, vy - fill, gz);
            colorMap.set(`${gx},${vy - fill},${gz}`, color);
          }

          prevY = hitVoxelY;
        } else {
          // Exiting solid — fill between prevY and this hit
          // Use enter/exit surface colors instead of flat gray
          const bottomY = Math.floor(hit.y / vs);
          const exitColor = sampleTriangleColor(scene, triangles[hit.triIdx], rayX, rayZ, decodedTextures);
          const spanHeight = prevY - bottomY;

          for (let fy = prevY - 1; fy >= bottomY; fy--) {
            setVoxel(chunks, gx, fy, gz);
            const key = `${gx},${fy},${gz}`;
            if (!colorMap.has(key)) {
              // Gradient blend from enter color (top) to exit color (bottom)
              if (spanHeight <= 1) {
                colorMap.set(key, enterColor);
              } else {
                const t = (prevY - fy) / spanHeight; // 0 at top, 1 at bottom
                colorMap.set(key, {
                  r: Math.round(enterColor.r * (1 - t) + exitColor.r * t),
                  g: Math.round(enterColor.g * (1 - t) + exitColor.g * t),
                  b: Math.round(enterColor.b * (1 - t) + exitColor.b * t),
                });
              }
            }
          }

          colorMap.set(`${gx},${bottomY},${gz}`, exitColor);

          inside = false;
        }
      }
    }
  }

  const pass1Voxels = colorMap.size;
  console.log(`\n  Pass 1 complete: ${chunks.size} chunks, ${pass1Voxels} colored voxels`);

  // --- Pass 2: Surface rasterization ---
  // Iterates all triangles and rasterizes their surfaces into the voxel grid.
  // Catches thin walls, tile-boundary seams, and geometry that column rays miss.

  console.log('  Pass 2 (surface rasterization)...');
  let surfaceVoxelsAdded = 0;
  const triReportInterval = Math.max(1, Math.floor(triangles.length / 20));

  for (let ti = 0; ti < triangles.length; ti++) {
    if (ti % triReportInterval === 0 && ti > 0) {
      const pct = ((ti / triangles.length) * 100).toFixed(0);
      process.stdout.write(`\r  Pass 2 (surface): ${pct}% (${ti}/${triangles.length} triangles)`);
    }

    const tri = triangles[ti];

    // Triangle AABB in grid coords
    const txMin = Math.max(Math.floor(Math.min(tri.x0, tri.x1, tri.x2) / vs), gxMin);
    const txMax = Math.min(Math.floor(Math.max(tri.x0, tri.x1, tri.x2) / vs), gxMax - 1);
    const tzMin = Math.max(Math.floor(Math.min(tri.z0, tri.z1, tri.z2) / vs), gzMin);
    const tzMax = Math.min(Math.floor(Math.max(tri.z0, tri.z1, tri.z2) / vs), gzMax - 1);

    for (let gx = txMin; gx <= txMax; gx++) {
      for (let gz = tzMin; gz <= tzMax; gz++) {
        const px = (gx + 0.5) * vs;
        const pz = (gz + 0.5) * vs;

        const bary = barycentricXZ(
          px, pz,
          tri.x0, tri.z0,
          tri.x1, tri.z1,
          tri.x2, tri.z2,
        );

        if (!bary) continue;
        const [bu, bv, bw] = bary;

        // Small negative epsilon for edge coverage at tile boundaries
        const EPS = -0.01;
        if (bu < EPS || bv < EPS || bw < EPS) continue;

        // Interpolate Y
        const hitY = bu * tri.y0 + bv * tri.y1 + bw * tri.y2;
        const gy = Math.floor(hitY / vs);
        if (gy < gyMin || gy > gyMax) continue;

        // Only add — don't overwrite existing raycast voxels
        const voxelKey = `${gx},${gy},${gz}`;
        if (colorMap.has(voxelKey)) continue;

        const color = sampleTriangleColor(scene, tri, px, pz, decodedTextures);
        setVoxel(chunks, gx, gy, gz);
        colorMap.set(voxelKey, color);
        surfaceVoxelsAdded++;
      }
    }
  }

  console.log(`\r  Pass 2 complete: ${surfaceVoxelsAdded} surface voxels added from ${triangles.length} triangles`);
  console.log(`  Total: ${chunks.size} chunks, ${colorMap.size} colored voxels`);

  // Free texture decode cache
  textureDecodeCache.clear();

  return {
    chunks,
    colorMap,
    bounds: { xMin: gxMin, xMax: gxMax, yMin: gyMin, yMax: gyMax, zMin: gzMin, zMax: gzMax },
  };
}

// ---------------------------------------------------------------------------
// Triangle data structures
// ---------------------------------------------------------------------------

interface Triangle {
  // Vertices
  x0: number; y0: number; z0: number;
  x1: number; y1: number; z1: number;
  x2: number; y2: number; z2: number;
  // Face normal Y component (for enter/exit determination)
  normalY: number;
  // Material group index
  groupIndex: number;
  // Original triangle index in the index buffer
  originalIndex: number;
}

function buildTriangleList(scene: MergedScene): Triangle[] {
  const triangles: Triangle[] = [];
  const pos = scene.positions;
  const idx = scene.indices;

  // Build triangle → group map
  const triGroupMap = new Map<number, number>();
  for (let gi = 0; gi < scene.materialGroups.length; gi++) {
    const g = scene.materialGroups[gi];
    for (let t = g.startTriangle; t < g.startTriangle + g.triangleCount; t++) {
      triGroupMap.set(t, gi);
    }
  }

  for (let ti = 0; ti < idx.length; ti += 3) {
    const i0 = idx[ti] * 3, i1 = idx[ti + 1] * 3, i2 = idx[ti + 2] * 3;
    if (i0 + 2 >= pos.length || i1 + 2 >= pos.length || i2 + 2 >= pos.length) continue;

    const x0 = pos[i0], y0 = pos[i0 + 1], z0 = pos[i0 + 2];
    const x1 = pos[i1], y1 = pos[i1 + 1], z1 = pos[i1 + 2];
    const x2 = pos[i2], y2 = pos[i2 + 1], z2 = pos[i2 + 2];

    // Compute face normal Y
    const e1x = x1 - x0, e1y = y1 - y0, e1z = z1 - z0;
    const e2x = x2 - x0, e2y = y2 - y0, e2z = z2 - z0;
    const ny = e1z * e2x - e1x * e2z; // Y component of cross product

    triangles.push({
      x0, y0, z0, x1, y1, z1, x2, y2, z2,
      normalY: ny,
      groupIndex: triGroupMap.get(ti / 3) ?? 0,
      originalIndex: ti / 3,
    });
  }

  return triangles;
}

/**
 * Build a 2D spatial grid mapping (gx, gz) cells to triangle indices.
 * Each cell is 1 voxel wide.
 */
function buildSpatialGrid(
  triangles: Triangle[],
  vs: number,
  gxMin: number, gzMin: number,
  gxMax: number, gzMax: number,
): Map<string, number[]> {
  console.log(`  Building spatial acceleration grid...`);
  const grid = new Map<string, number[]>();

  for (let ti = 0; ti < triangles.length; ti++) {
    const t = triangles[ti];

    // Triangle AABB in grid coords
    const txMin = Math.floor(Math.min(t.x0, t.x1, t.x2) / vs);
    const txMax = Math.floor(Math.max(t.x0, t.x1, t.x2) / vs);
    const tzMin = Math.floor(Math.min(t.z0, t.z1, t.z2) / vs);
    const tzMax = Math.floor(Math.max(t.z0, t.z1, t.z2) / vs);

    for (let gx = Math.max(txMin, gxMin); gx <= Math.min(txMax, gxMax); gx++) {
      for (let gz = Math.max(tzMin, gzMin); gz <= Math.min(tzMax, gzMax); gz++) {
        const key = `${gx},${gz}`;
        let list = grid.get(key);
        if (!list) {
          list = [];
          grid.set(key, list);
        }
        list.push(ti);
      }
    }
  }

  console.log(`  Spatial grid: ${grid.size} cells`);
  return grid;
}

// ---------------------------------------------------------------------------
// Ray-triangle intersection (Möller–Trumbore, vertical ray)
// ---------------------------------------------------------------------------

/**
 * Intersect a vertical (Y-axis) ray at (rayX, ∞, rayZ) going downward
 * with a triangle. Returns the Y coordinate of intersection or null.
 */
function rayTriangleIntersectY(
  rayX: number, rayOriginY: number, rayZ: number,
  tri: Triangle,
): number | null {
  // Ray direction: (0, -1, 0)
  const e1x = tri.x1 - tri.x0;
  const e1y = tri.y1 - tri.y0;
  const e1z = tri.z1 - tri.z0;
  const e2x = tri.x2 - tri.x0;
  const e2y = tri.y2 - tri.y0;
  const e2z = tri.z2 - tri.z0;

  // h = cross(dir, e2) where dir = (0, -1, 0)
  const hx = -e2z;
  const hy = 0;
  const hz = e2x;

  const a = e1x * hx + e1y * hy + e1z * hz;
  if (a > -1e-8 && a < 1e-8) return null; // Parallel

  const f = 1.0 / a;
  const sx = rayX - tri.x0;
  const sy = rayOriginY - tri.y0;
  const sz = rayZ - tri.z0;

  const u = f * (sx * hx + sy * hy + sz * hz);
  if (u < 0 || u > 1) return null;

  // q = cross(s, e1)
  const qx = sy * e1z - sz * e1y;
  const qy = sz * e1x - sx * e1z;
  const qz = sx * e1y - sy * e1x;

  // dir = (0, -1, 0)
  const v = f * (0 * qx + (-1) * qy + 0 * qz);
  if (v < 0 || u + v > 1) return null;

  const t = f * (e2x * qx + e2y * qy + e2z * qz);
  if (t < 0) return null; // Behind ray origin

  return rayOriginY - t; // Intersection Y = origin - t (ray goes down)
}

// ---------------------------------------------------------------------------
// Chunk helpers
// ---------------------------------------------------------------------------

function setVoxel(chunks: Map<string, Uint8Array>, wx: number, wy: number, wz: number): void {
  const cx = Math.floor(wx / CHUNK_SIZE);
  const cy = Math.floor(wy / CHUNK_SIZE);
  const cz = Math.floor(wz / CHUNK_SIZE);
  const key = `${cx},${cy},${cz}`;

  let chunk = chunks.get(key);
  if (!chunk) {
    chunk = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE * CHUNK_SIZE);
    chunks.set(key, chunk);
  }

  const lx = ((wx % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
  const ly = ((wy % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
  const lz = ((wz % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;

  // Store a placeholder value (1 = solid, will be replaced by material ID later)
  chunk[lx + ly * CHUNK_SIZE + lz * CHUNK_SIZE * CHUNK_SIZE] = 1;
}
