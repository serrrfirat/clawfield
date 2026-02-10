/**
 * detail-props.ts
 *
 * Scatters environmental detail props (grass tufts, small rocks, rubble)
 * on exposed surfaces using THREE.InstancedMesh for efficient rendering.
 *
 * Props are placed procedurally based on surface material and only within
 * a camera-distance LOD radius to keep draw calls minimal.
 */

import * as THREE from 'three';
import {
  CHUNK_SIZE,
  MAT_GRASS, MAT_GRASS_DARK, MAT_DIRT,
  MAT_STONE, MAT_STONE_DARK,
  MAT_CONCRETE, MAT_CONCRETE_DARK,
  MAT_SAND_LIGHT, MAT_SAND_DARK,
  chunkKeyToPosition,
} from '@clawfield/shared';

/** Maximum world-unit distance from camera to place props */
const PROP_RADIUS = 40;
/** Squared distance for quick comparison */
const PROP_RADIUS_SQ = PROP_RADIUS * PROP_RADIUS;

/** Max instances per prop type (shared across all visible chunks) */
const MAX_INSTANCES = 4096;

/** Seeded PRNG for deterministic placement */
function hashSeed(x: number, y: number, z: number): number {
  let h = (x * 374761393 + y * 668265263 + z * 1274126177) | 0;
  h = (h ^ (h >> 13)) * 1103515245;
  h = h ^ (h >> 16);
  return (h >>> 0) / 4294967296;
}

/** Materials that spawn grass tufts */
const GRASS_MATERIALS = new Set([MAT_GRASS, MAT_GRASS_DARK]);
/** Materials that spawn small rocks */
const ROCK_MATERIALS = new Set([MAT_STONE, MAT_STONE_DARK, MAT_DIRT, MAT_SAND_LIGHT, MAT_SAND_DARK]);
/** Materials that spawn rubble */
const RUBBLE_MATERIALS = new Set([MAT_CONCRETE, MAT_CONCRETE_DARK, MAT_STONE, MAT_STONE_DARK]);

interface PropType {
  mesh: THREE.InstancedMesh;
  count: number;
}

/**
 * Create a simple grass tuft geometry: a few crossed quads.
 */
function createGrassTuftGeometry(): THREE.BufferGeometry {
  const h = 0.4;
  const w = 0.2;
  // Two crossed quads (X shape when viewed from above)
  const positions = new Float32Array([
    // Quad 1 (along X axis)
    -w, 0, 0,  w, 0, 0,  w, h, 0, -w, h, 0,
    // Quad 2 (along Z axis)
    0, 0, -w,  0, 0, w,  0, h, w,  0, h, -w,
  ]);
  const normals = new Float32Array([
    0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1,
    1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0,
  ]);
  const uvs = new Float32Array([
    0, 0, 1, 0, 1, 1, 0, 1,
    0, 0, 1, 0, 1, 1, 0, 1,
  ]);
  const indices = new Uint16Array([
    0, 1, 2, 0, 2, 3,  // front
    0, 2, 1, 0, 3, 2,  // back
    4, 5, 6, 4, 6, 7,  // front
    4, 6, 5, 4, 7, 6,  // back
  ]);

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geom.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geom.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geom.setIndex(new THREE.BufferAttribute(indices, 1));
  return geom;
}

/**
 * Create a simple rock geometry: a small irregular icosahedron-like shape.
 */
function createRockGeometry(): THREE.BufferGeometry {
  const geom = new THREE.IcosahedronGeometry(0.12, 0);
  // Slightly squash vertically for a rock-like shape
  const pos = geom.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    pos.setY(i, pos.getY(i) * 0.6);
  }
  pos.needsUpdate = true;
  geom.computeVertexNormals();
  return geom;
}

/**
 * Create rubble geometry: a flatter angular shape.
 */
function createRubbleGeometry(): THREE.BufferGeometry {
  const geom = new THREE.TetrahedronGeometry(0.15, 0);
  const pos = geom.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    pos.setY(i, pos.getY(i) * 0.4);
  }
  pos.needsUpdate = true;
  geom.computeVertexNormals();
  return geom;
}

/**
 * Detail prop system: scatters environmental props around the camera.
 */
export class DetailPropSystem {
  private scene: THREE.Scene;
  private grass: PropType;
  private rock: PropType;
  private rubble: PropType;
  private lastUpdatePos = new THREE.Vector3(Infinity, Infinity, Infinity);
  /** Minimum camera movement before re-computing prop placement */
  private static readonly UPDATE_THRESHOLD_SQ = 4 * 4; // 4 world units

  constructor(scene: THREE.Scene) {
    this.scene = scene;

    // Grass material: green, double-sided, no shadows
    const grassMat = new THREE.MeshStandardMaterial({
      color: 0x3a7a2a,
      roughness: 0.9,
      side: THREE.DoubleSide,
      alphaTest: 0.5,
    });

    // Rock material: grey
    const rockMat = new THREE.MeshStandardMaterial({
      color: 0x777777,
      roughness: 0.95,
    });

    // Rubble material: light grey
    const rubbleMat = new THREE.MeshStandardMaterial({
      color: 0x999999,
      roughness: 0.9,
    });

    this.grass = {
      mesh: new THREE.InstancedMesh(createGrassTuftGeometry(), grassMat, MAX_INSTANCES),
      count: 0,
    };
    this.rock = {
      mesh: new THREE.InstancedMesh(createRockGeometry(), rockMat, MAX_INSTANCES),
      count: 0,
    };
    this.rubble = {
      mesh: new THREE.InstancedMesh(createRubbleGeometry(), rubbleMat, MAX_INSTANCES),
      count: 0,
    };

    // Configure instanced meshes
    for (const prop of [this.grass, this.rock, this.rubble]) {
      prop.mesh.castShadow = false;
      prop.mesh.receiveShadow = true;
      prop.mesh.frustumCulled = false; // managed manually
      prop.mesh.count = 0;
      this.scene.add(prop.mesh);
    }
  }

  /**
   * Update prop placement based on camera position and chunk data.
   * Only re-computes when camera has moved enough.
   *
   * @param cameraPos - Camera world position
   * @param chunks - Map of chunk key → voxel data (from WorldRenderer)
   */
  update(
    cameraPos: { x: number; y: number; z: number },
    chunks: Map<string, { voxels: Uint8Array }>,
  ): void {
    const dx = cameraPos.x - this.lastUpdatePos.x;
    const dy = cameraPos.y - this.lastUpdatePos.y;
    const dz = cameraPos.z - this.lastUpdatePos.z;
    if (dx * dx + dy * dy + dz * dz < DetailPropSystem.UPDATE_THRESHOLD_SQ) return;

    this.lastUpdatePos.set(cameraPos.x, cameraPos.y, cameraPos.z);

    // Reset counts
    this.grass.count = 0;
    this.rock.count = 0;
    this.rubble.count = 0;

    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const rotation = new THREE.Euler();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3();

    // Iterate visible chunks near camera
    for (const [key, entry] of chunks) {
      const origin = chunkKeyToPosition(key);
      // Quick chunk-level distance check (center of chunk)
      const chunkCenterX = origin.x + CHUNK_SIZE / 2;
      const chunkCenterY = origin.y + CHUNK_SIZE / 2;
      const chunkCenterZ = origin.z + CHUNK_SIZE / 2;
      const cdx = chunkCenterX - cameraPos.x;
      const cdy = chunkCenterY - cameraPos.y;
      const cdz = chunkCenterZ - cameraPos.z;
      const chunkDistSq = cdx * cdx + cdy * cdy + cdz * cdz;
      // Skip chunks that are definitely too far (chunk diagonal ~27.7 units)
      if (chunkDistSq > (PROP_RADIUS + 28) * (PROP_RADIUS + 28)) continue;

      const voxels = entry.voxels;

      // Scan for top-facing exposed surfaces
      for (let z = 0; z < CHUNK_SIZE; z++) {
        for (let x = 0; x < CHUNK_SIZE; x++) {
          for (let y = CHUNK_SIZE - 1; y >= 0; y--) {
            const mat = voxels[x + y * CHUNK_SIZE + z * CHUNK_SIZE * CHUNK_SIZE];
            if (mat === 0) continue;

            // Check if top face is exposed
            const above = y + 1 < CHUNK_SIZE
              ? voxels[x + (y + 1) * CHUNK_SIZE + z * CHUNK_SIZE * CHUNK_SIZE]
              : 0;
            if (above !== 0) break; // covered, skip rest of column

            const wx = origin.x + x + 0.5;
            const wy = origin.y + y + 1.0;
            const wz = origin.z + z + 0.5;

            // Distance check
            const pdx = wx - cameraPos.x;
            const pdy = wy - cameraPos.y;
            const pdz = wz - cameraPos.z;
            if (pdx * pdx + pdy * pdy + pdz * pdz > PROP_RADIUS_SQ) break;

            // Deterministic random for this position
            const rng = hashSeed(origin.x + x, origin.y + y, origin.z + z);

            // Spawn props based on material
            if (GRASS_MATERIALS.has(mat) && rng < 0.15 && this.grass.count < MAX_INSTANCES) {
              const yRot = rng * Math.PI * 2;
              const s = 0.7 + rng * 0.6; // scale variation
              rotation.set(0, yRot, 0);
              quaternion.setFromEuler(rotation);
              scale.set(s, s, s);
              position.set(wx + (rng - 0.5) * 0.3, wy, wz + (rng * 0.7 - 0.35) * 0.3);
              matrix.compose(position, quaternion, scale);
              this.grass.mesh.setMatrixAt(this.grass.count++, matrix);
            }

            if (ROCK_MATERIALS.has(mat) && rng > 0.92 && this.rock.count < MAX_INSTANCES) {
              const yRot = rng * Math.PI * 2;
              const s = 0.6 + rng * 0.8;
              rotation.set(rng * 0.3, yRot, rng * 0.3);
              quaternion.setFromEuler(rotation);
              scale.set(s, s, s);
              position.set(wx + (rng - 0.5) * 0.4, wy, wz + (rng * 0.8 - 0.4) * 0.4);
              matrix.compose(position, quaternion, scale);
              this.rock.mesh.setMatrixAt(this.rock.count++, matrix);
            }

            if (RUBBLE_MATERIALS.has(mat) && rng > 0.85 && rng <= 0.92 && this.rubble.count < MAX_INSTANCES) {
              const yRot = rng * Math.PI * 2;
              const s = 0.5 + rng * 0.7;
              rotation.set(rng * 0.5, yRot, rng * 0.5);
              quaternion.setFromEuler(rotation);
              scale.set(s, s * 0.5, s);
              position.set(wx + (rng - 0.5) * 0.3, wy, wz + (rng * 0.6 - 0.3) * 0.3);
              matrix.compose(position, quaternion, scale);
              this.rubble.mesh.setMatrixAt(this.rubble.count++, matrix);
            }

            break; // found top surface for this column, move on
          }
        }
      }
    }

    // Update instance counts and flag for GPU upload
    this.grass.mesh.count = this.grass.count;
    this.rock.mesh.count = this.rock.count;
    this.rubble.mesh.count = this.rubble.count;

    if (this.grass.count > 0) this.grass.mesh.instanceMatrix.needsUpdate = true;
    if (this.rock.count > 0) this.rock.mesh.instanceMatrix.needsUpdate = true;
    if (this.rubble.count > 0) this.rubble.mesh.instanceMatrix.needsUpdate = true;
  }

  /** Remove all prop meshes from scene */
  dispose(): void {
    for (const prop of [this.grass, this.rock, this.rubble]) {
      this.scene.remove(prop.mesh);
      prop.mesh.geometry.dispose();
      (prop.mesh.material as THREE.Material).dispose();
    }
  }
}
