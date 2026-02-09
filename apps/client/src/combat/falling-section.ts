import * as THREE from 'three';
import { VOXEL_SIZE } from '@clawfield/shared';

type Vec3 = { x: number; y: number; z: number };

const _matrix = new THREE.Matrix4();
const _color = new THREE.Color();

/**
 * A single falling building section — a group of voxels that falls as one rigid body
 * with tilt rotation, like Battlefield building collapses.
 */
class FallingSection {
  readonly group: THREE.Group;
  private mesh: THREE.InstancedMesh;
  private elapsed = 0;
  private duration: number;
  private dropDistance: number;
  private impactDir: Vec3;
  private startY: number;
  done = false;

  constructor(
    voxels: Vec3[],
    colors: number[],
    dropDistance: number,
    impactDir: Vec3,
    duration: number,
  ) {
    this.duration = duration;
    this.dropDistance = dropDistance;
    this.impactDir = impactDir;

    // Compute centroid of the group
    let cx = 0, cy = 0, cz = 0;
    for (const v of voxels) {
      cx += v.x;
      cy += v.y;
      cz += v.z;
    }
    cx /= voxels.length;
    cy /= voxels.length;
    cz /= voxels.length;
    this.startY = cy + 0.5;

    // Create instanced mesh with voxel positions relative to centroid
    const geo = new THREE.BoxGeometry(VOXEL_SIZE, VOXEL_SIZE, VOXEL_SIZE);
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0 });
    this.mesh = new THREE.InstancedMesh(geo, mat, voxels.length);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(
      new Float32Array(voxels.length * 3), 3,
    );
    this.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;

    for (let i = 0; i < voxels.length; i++) {
      const v = voxels[i];
      // Position relative to centroid so rotation is around the group center
      _matrix.makeTranslation(
        v.x + 0.5 - (cx + 0.5),
        v.y + 0.5 - (cy + 0.5),
        v.z + 0.5 - (cz + 0.5),
      );
      this.mesh.setMatrixAt(i, _matrix);

      const c = colors[i] ?? 0x888888;
      _color.set(c);
      this.mesh.instanceColor.setXYZ(i, _color.r, _color.g, _color.b);
    }

    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.instanceColor.needsUpdate = true;
    this.mesh.count = voxels.length;

    // Group positioned at centroid in world space
    this.group = new THREE.Group();
    this.group.position.set(cx + 0.5, cy + 0.5, cz + 0.5);
    this.group.add(this.mesh);
  }

  update(dt: number): void {
    this.elapsed += dt;
    const t = Math.min(this.elapsed / this.duration, 1);

    // Gravity-like ease-in: accelerating fall (quadratic)
    const fallProgress = t * t;
    const currentDrop = this.dropDistance * fallProgress;
    this.group.position.y = this.startY - currentDrop;

    // Tilt toward impact direction, increasing as it falls
    // Max ~12 degrees — enough to look dramatic without being cartoonish
    const maxTilt = 0.21;
    const tiltAmount = maxTilt * Math.min(t * 1.5, 1); // reaches max tilt at ~67% through fall

    const ix = this.impactDir.x;
    const iz = this.impactDir.z;
    const tiltLen = Math.sqrt(ix * ix + iz * iz);
    if (tiltLen > 0.01) {
      // Tilt axis perpendicular to impact direction in XZ plane
      // Building leans toward where the damage was
      this.group.rotation.x = (iz / tiltLen) * tiltAmount;
      this.group.rotation.z = -(ix / tiltLen) * tiltAmount;
    }

    if (t >= 1) {
      this.done = true;
    }
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}

/**
 * Manages falling building sections — temporary rigid body meshes
 * that represent collapsing structure chunks falling to the ground.
 */
export class FallingSectionSystem {
  private scene: THREE.Scene;
  private sections: FallingSection[] = [];

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  /**
   * Spawn a falling section from a collapse event.
   * @param voxels - World positions of the voxels in the section
   * @param colors - Per-voxel hex colors (parallel array)
   * @param dropDistance - How far the section drops (in voxels/world units)
   * @param impactDir - Direction the section tilts toward (normalized XZ)
   * @param duration - Fall animation duration in seconds
   */
  spawn(
    voxels: Vec3[],
    colors: number[],
    dropDistance: number,
    impactDir: Vec3,
    duration: number,
  ): void {
    const section = new FallingSection(voxels, colors, dropDistance, impactDir, duration);
    this.scene.add(section.group);
    this.sections.push(section);
  }

  update(dt: number): void {
    for (let i = this.sections.length - 1; i >= 0; i--) {
      const s = this.sections[i];
      s.update(dt);
      if (s.done) {
        this.scene.remove(s.group);
        s.dispose();
        this.sections.splice(i, 1);
      }
    }
  }

  dispose(): void {
    for (const s of this.sections) {
      this.scene.remove(s.group);
      s.dispose();
    }
    this.sections.length = 0;
  }
}
