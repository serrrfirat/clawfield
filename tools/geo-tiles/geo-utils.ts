/**
 * geo-utils.ts — Coordinate transformations: lat/lon ↔ ECEF ↔ local ENU
 *
 * Uses WGS84 ellipsoid constants for accurate conversion.
 */

// WGS84 ellipsoid parameters
const WGS84_A = 6378137.0;           // Semi-major axis (meters)
const WGS84_F = 1 / 298.257223563;   // Flattening
const WGS84_B = WGS84_A * (1 - WGS84_F); // Semi-minor axis
const WGS84_E2 = 1 - (WGS84_B * WGS84_B) / (WGS84_A * WGS84_A); // First eccentricity squared

/**
 * Convert geodetic coordinates (lat, lon, alt) to ECEF (X, Y, Z).
 * lat/lon in degrees, alt in meters above ellipsoid.
 */
export function geodeticToECEF(
  latDeg: number,
  lonDeg: number,
  alt: number = 0
): [number, number, number] {
  const lat = latDeg * Math.PI / 180;
  const lon = lonDeg * Math.PI / 180;
  const sinLat = Math.sin(lat);
  const cosLat = Math.cos(lat);
  const sinLon = Math.sin(lon);
  const cosLon = Math.cos(lon);

  // Radius of curvature in the prime vertical
  const N = WGS84_A / Math.sqrt(1 - WGS84_E2 * sinLat * sinLat);

  const x = (N + alt) * cosLat * cosLon;
  const y = (N + alt) * cosLat * sinLon;
  const z = (N * (1 - WGS84_E2) + alt) * sinLat;

  return [x, y, z];
}

/**
 * Build a 4×4 rotation matrix (column-major) that transforms
 * ECEF coordinates to local ENU (East-North-Up) at a given origin.
 *
 * In our game coordinate system:
 *   East  → +X
 *   Up    → +Y
 *   North → -Z  (so that looking "forward" / south is +Z in Three.js)
 *
 * Returns a column-major 4×4 matrix [m00, m10, m20, m30, m01, ...]
 */
export function ecefToENUMatrix(
  originLatDeg: number,
  originLonDeg: number,
  originAlt: number = 0
): Float64Array {
  const lat = originLatDeg * Math.PI / 180;
  const lon = originLonDeg * Math.PI / 180;
  const sinLat = Math.sin(lat);
  const cosLat = Math.cos(lat);
  const sinLon = Math.sin(lon);
  const cosLon = Math.cos(lon);

  const [ox, oy, oz] = geodeticToECEF(originLatDeg, originLonDeg, originAlt);

  // ENU rotation matrix rows (standard ENU):
  //   East  = [-sinLon,       cosLon,       0      ]
  //   North = [-sinLat*cosLon, -sinLat*sinLon, cosLat]
  //   Up    = [cosLat*cosLon,  cosLat*sinLon,  sinLat]
  //
  // For game coords (East=X, Up=Y, South=+Z → North=-Z):
  //   X = East
  //   Y = Up
  //   Z = -North = [sinLat*cosLon, sinLat*sinLon, -cosLat]

  // Column-major 4×4
  const m = new Float64Array(16);

  // Column 0: where ECEF-X goes → project onto game axes
  m[0]  = -sinLon;                // East.x
  m[1]  = cosLat * cosLon;        // Up.x
  m[2]  = sinLat * cosLon;        // (-North).x
  m[3]  = 0;

  // Column 1: where ECEF-Y goes
  m[4]  = cosLon;                 // East.y
  m[5]  = cosLat * sinLon;        // Up.y
  m[6]  = sinLat * sinLon;        // (-North).y
  m[7]  = 0;

  // Column 2: where ECEF-Z goes
  m[8]  = 0;                      // East.z
  m[9]  = sinLat;                 // Up.z
  m[10] = -cosLat;                // (-North).z
  m[11] = 0;

  // Column 3: translation (rotate origin then negate)
  m[12] = -(m[0] * ox + m[4] * oy + m[8]  * oz);
  m[13] = -(m[1] * ox + m[5] * oy + m[9]  * oz);
  m[14] = -(m[2] * ox + m[6] * oy + m[10] * oz);
  m[15] = 1;

  return m;
}

/**
 * Transform a point [x,y,z] by a column-major 4×4 matrix.
 */
export function transformPoint(
  m: Float64Array | number[],
  x: number, y: number, z: number
): [number, number, number] {
  const w = m[3] * x + m[7] * y + m[11] * z + m[15];
  return [
    (m[0] * x + m[4] * y + m[8]  * z + m[12]) / w,
    (m[1] * x + m[5] * y + m[9]  * z + m[13]) / w,
    (m[2] * x + m[6] * y + m[10] * z + m[14]) / w,
  ];
}

/**
 * Multiply two column-major 4×4 matrices: result = A * B
 */
export function multiplyMatrices(
  a: Float64Array | number[],
  b: Float64Array | number[]
): Float64Array {
  const out = new Float64Array(16);
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 4; row++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) {
        sum += a[row + k * 4] * b[k + col * 4];
      }
      out[row + col * 4] = sum;
    }
  }
  return out;
}

/**
 * Compute bounding box corners in lat/lon for a radius (meters) around a center point.
 * Returns [south, west, north, east] in degrees.
 */
export function latLonBounds(
  latDeg: number,
  lonDeg: number,
  radiusMeters: number
): { south: number; west: number; north: number; east: number } {
  // Approximate degrees per meter
  const latPerMeter = 1 / 111_320;
  const lonPerMeter = 1 / (111_320 * Math.cos(latDeg * Math.PI / 180));

  return {
    south: latDeg - radiusMeters * latPerMeter,
    west: lonDeg - radiusMeters * lonPerMeter,
    north: latDeg + radiusMeters * latPerMeter,
    east: lonDeg + radiusMeters * lonPerMeter,
  };
}

/**
 * Check if a bounding sphere (center ECEF + radius) intersects with
 * a bounding box defined in lat/lon degrees.
 */
export function sphereIntersectsLatLonBox(
  centerECEF: [number, number, number],
  radiusMeters: number,
  box: { south: number; west: number; north: number; east: number }
): boolean {
  // Convert box corners to ECEF and check distance
  const corners = [
    geodeticToECEF(box.south, box.west),
    geodeticToECEF(box.south, box.east),
    geodeticToECEF(box.north, box.west),
    geodeticToECEF(box.north, box.east),
    geodeticToECEF((box.south + box.north) / 2, (box.west + box.east) / 2),
  ];

  // Check if any corner is within the sphere
  for (const [cx, cy, cz] of corners) {
    const dx = cx - centerECEF[0];
    const dy = cy - centerECEF[1];
    const dz = cz - centerECEF[2];
    if (dx * dx + dy * dy + dz * dz <= radiusMeters * radiusMeters) {
      return true;
    }
  }

  return false;
}

/**
 * Parse a 3D Tiles bounding volume and return ECEF center + radius.
 * Supports: boundingVolume.sphere, boundingVolume.region, boundingVolume.box
 */
export function parseBoundingVolume(
  bv: Record<string, unknown>
): { center: [number, number, number]; radius: number } | null {
  if (bv.sphere) {
    const s = bv.sphere as number[];
    return { center: [s[0], s[1], s[2]], radius: s[3] };
  }
  if (bv.region) {
    // [west, south, east, north, minHeight, maxHeight] in radians
    const r = bv.region as number[];
    const centerLat = ((r[1] + r[3]) / 2) * 180 / Math.PI;
    const centerLon = ((r[0] + r[2]) / 2) * 180 / Math.PI;
    const centerAlt = (r[4] + r[5]) / 2;
    const center = geodeticToECEF(centerLat, centerLon, centerAlt);
    // Approximate radius from region extent
    const dLat = Math.abs(r[3] - r[1]) * WGS84_A;
    const dLon = Math.abs(r[2] - r[0]) * WGS84_A * Math.cos((r[1] + r[3]) / 2);
    const dAlt = Math.abs(r[5] - r[4]);
    const radius = Math.sqrt(dLat * dLat + dLon * dLon + dAlt * dAlt) / 2;
    return { center, radius };
  }
  if (bv.box) {
    // [cx,cy,cz, xx,xy,xz, yx,yy,yz, zx,zy,zz] - center + 3 half-axis vectors
    const b = bv.box as number[];
    const center: [number, number, number] = [b[0], b[1], b[2]];
    // Radius = max half-axis length
    const hx = Math.sqrt(b[3] * b[3] + b[4] * b[4] + b[5] * b[5]);
    const hy = Math.sqrt(b[6] * b[6] + b[7] * b[7] + b[8] * b[8]);
    const hz = Math.sqrt(b[9] * b[9] + b[10] * b[10] + b[11] * b[11]);
    const radius = Math.sqrt(hx * hx + hy * hy + hz * hz);
    return { center, radius };
  }
  return null;
}
