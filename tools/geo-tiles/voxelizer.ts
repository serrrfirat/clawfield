/**
 * voxelizer.ts — Convert merged triangle mesh to a voxel grid via raycasting.
 *
 * Uses three-mesh-bvh for accelerated ray-mesh intersection.
 * For each (x,z) column, casts a downward ray and fills solid volumes.
 */

import type { MergedScene, VoxelGrid, RGB, CLIOptions } from './types.js';

const CHUNK_SIZE = 16;

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

  const chunks = new Map<string, Uint8Array>();
  const colorMap = new Map<string, RGB>();

  let columnsProcessed = 0;
  const totalColumns = (gxMax - gxMin) * (gzMax - gzMin);
  const reportInterval = Math.max(1, Math.floor(totalColumns / 20));

  // Cast rays column by column
  for (let gx = gxMin; gx < gxMax; gx++) {
    for (let gz = gzMin; gz < gzMax; gz++) {
      columnsProcessed++;
      if (columnsProcessed % reportInterval === 0) {
        const pct = ((columnsProcessed / totalColumns) * 100).toFixed(0);
        process.stdout.write(`\r  Voxelizing: ${pct}% (${columnsProcessed}/${totalColumns} columns)`);
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
          // Determine if ray is entering or exiting based on face normal Y
          const entering = tri.normalY <= 0; // Downward-facing normal = entering solid
          hits.push({ y: hitY, entering, triIdx });
        }
      }

      if (hits.length === 0) continue;

      // Sort hits from top to bottom
      hits.sort((a, b) => b.y - a.y);

      // Process hits: pair enter/exit to fill solid regions
      // Use a simple approach: every odd-numbered surface flip starts/stops solid
      let inside = false;
      let prevY = gyMax;

      for (const hit of hits) {
        const hitVoxelY = Math.floor(hit.y / vs);

        if (!inside) {
          // First surface hit from above → mark the surface and start filling
          inside = true;

          // Sample color at this surface point
          const color = sampleTriangleColor(scene, triangles[hit.triIdx], rayX, rayZ);
          const vy = hitVoxelY;
          setVoxel(chunks, gx, vy, gz);
          if (color) colorMap.set(`${gx},${vy},${gz}`, color);

          // Fill a few voxels below for ground thickness
          for (let fill = 1; fill <= 2; fill++) {
            setVoxel(chunks, gx, vy - fill, gz);
            if (color) colorMap.set(`${gx},${vy - fill},${gz}`, color);
          }

          prevY = hitVoxelY;
        } else {
          // Second surface = exiting solid
          // Fill between prevY and this hit
          const bottomY = Math.floor(hit.y / vs);
          for (let fy = prevY - 1; fy >= bottomY; fy--) {
            setVoxel(chunks, gx, fy, gz);
            // Interior voxels get the surface color
            const key = `${gx},${fy},${gz}`;
            if (!colorMap.has(key)) {
              colorMap.set(key, { r: 160, g: 160, b: 160 }); // Default gray for interior
            }
          }

          // Sample color for bottom surface
          const exitColor = sampleTriangleColor(scene, triangles[hit.triIdx], rayX, rayZ);
          if (exitColor) colorMap.set(`${gx},${bottomY},${gz}`, exitColor);

          inside = false;
        }
      }

      // If we're still "inside" after all hits, fill down a bit (single surface)
      if (inside && hits.length === 1) {
        // Single surface: already filled above
      }
    }
  }

  console.log(`\n  Voxelization complete: ${chunks.size} chunks, ${colorMap.size} colored voxels`);

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
  const hx = -e2z; // (-1) * e2z - 0 * e2y ... simplified for dir = (0,-1,0)
  const hy = 0;     // 0 * e2x - 0 * e2z
  const hz = e2x;   // 0 * e2y - (-1) * e2x

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
// Color sampling
// ---------------------------------------------------------------------------

function sampleTriangleColor(
  scene: MergedScene,
  tri: Triangle,
  sampleX: number,
  sampleZ: number,
): RGB | null {
  // Try vertex colors first (most common in Google 3D Tiles)
  if (scene.vertexColors) {
    const idx = scene.indices;
    const i0 = idx[tri.originalIndex * 3];
    const i1 = idx[tri.originalIndex * 3 + 1];
    const i2 = idx[tri.originalIndex * 3 + 2];

    const vc = scene.vertexColors;
    // Average vertex colors for simplicity
    const r = Math.round((vc[i0 * 3] + vc[i1 * 3] + vc[i2 * 3]) / 3);
    const g = Math.round((vc[i0 * 3 + 1] + vc[i1 * 3 + 1] + vc[i2 * 3 + 1]) / 3);
    const b = Math.round((vc[i0 * 3 + 2] + vc[i1 * 3 + 2] + vc[i2 * 3 + 2]) / 3);

    return { r, g, b };
  }

  // Fallback to gray
  return { r: 180, g: 180, b: 180 };
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
