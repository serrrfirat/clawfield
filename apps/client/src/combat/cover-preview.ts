import * as THREE from 'three';
import {
  GADGET_COVER_DISTANCE,
  GADGET_COVER_WIDTH,
  GADGET_COVER_HEIGHT,
  getVoxel,
  aimDirection,
} from '@clawfield/shared';

const PREVIEW_OPACITY = 0.35;

/**
 * Ghost preview for deploy cover placement.
 * Shows a semi-transparent wall at the computed placement position.
 * Green = valid (all air), red = blocked (some voxels occupied).
 *
 * Coordinates use 1:1 voxel space (1 voxel = 1 Three.js unit).
 */
export class CoverPreview {
  private scene: THREE.Scene;
  private group: THREE.Group;
  private meshes: THREE.Mesh[] = [];
  private validMat: THREE.MeshStandardMaterial;
  private blockedMat: THREE.MeshStandardMaterial;
  private visible = false;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.visible = false;
    scene.add(this.group);

    this.validMat = new THREE.MeshStandardMaterial({
      color: 0x2ecc71,
      transparent: true,
      opacity: PREVIEW_OPACITY,
      depthWrite: false,
    });
    this.blockedMat = new THREE.MeshStandardMaterial({
      color: 0xe74c3c,
      transparent: true,
      opacity: PREVIEW_OPACITY,
      depthWrite: false,
    });

    // Pre-create voxel meshes for the wall (1 unit = 1 voxel)
    const geom = new THREE.BoxGeometry(1, 1, 1);
    for (let h = 0; h < GADGET_COVER_HEIGHT; h++) {
      const halfW = Math.floor(GADGET_COVER_WIDTH / 2);
      for (let w = -halfW; w <= halfW; w++) {
        const mesh = new THREE.Mesh(geom, this.validMat);
        this.group.add(mesh);
        this.meshes.push(mesh);
      }
    }
  }

  /**
   * Update the preview position and validity.
   * @param playerPos Player feet position (in voxel/world space)
   * @param yaw Player yaw angle
   * @param chunks Voxel chunk map
   * @param gadgetReady Whether the gadget is off cooldown
   */
  update(
    playerPos: { x: number; y: number; z: number },
    yaw: number,
    chunks: Map<string, Uint8Array>,
    gadgetReady: boolean,
  ): void {
    if (!this.visible) {
      this.group.visible = true;
      this.visible = true;
    }

    const dir = aimDirection(yaw, 0);
    const centerX = Math.floor(playerPos.x + dir.x * GADGET_COVER_DISTANCE);
    const baseY = Math.floor(playerPos.y);
    const centerZ = Math.floor(playerPos.z + dir.z * GADGET_COVER_DISTANCE);

    const isXAligned = Math.abs(dir.x) > Math.abs(dir.z);
    const halfW = Math.floor(GADGET_COVER_WIDTH / 2);

    let allValid = gadgetReady;
    let idx = 0;

    for (let h = 0; h < GADGET_COVER_HEIGHT; h++) {
      for (let w = -halfW; w <= halfW; w++) {
        const wx = isXAligned ? centerX : centerX + w;
        const wy = baseY + h;
        const wz = isXAligned ? centerZ + w : centerZ;

        const mesh = this.meshes[idx];
        if (mesh) {
          // Position at voxel center (1:1 voxel-to-world scale)
          mesh.position.set(wx + 0.5, wy + 0.5, wz + 0.5);

          const isAir = getVoxel(chunks, wx, wy, wz) === 0;
          if (!isAir) allValid = false;
        }
        idx++;
      }
    }

    // Set material based on validity
    const mat = allValid ? this.validMat : this.blockedMat;
    for (const mesh of this.meshes) {
      mesh.material = mat;
    }
  }

  hide(): void {
    if (!this.visible) return;
    this.group.visible = false;
    this.visible = false;
  }

  dispose(): void {
    for (const mesh of this.meshes) {
      mesh.geometry.dispose();
    }
    this.validMat.dispose();
    this.blockedMat.dispose();
    this.scene.remove(this.group);
  }
}
