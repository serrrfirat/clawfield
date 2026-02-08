import * as THREE from 'three';

/**
 * First-person weapon viewmodel.
 * Renders a simple gun shape attached to the camera
 * so it follows the player's view.
 */
export class Viewmodel {
  readonly group: THREE.Group;

  /** Rest position relative to camera */
  private readonly restPosition = new THREE.Vector3(0.3, -0.25, -0.5);
  /** Rest rotation (euler) */
  private readonly restRotation = new THREE.Euler(0, 0, 0);

  /** Recoil state */
  private recoilTime = 0;
  /** Duration of recoil animation in seconds */
  private readonly recoilDuration = 0.1;
  /** Whether currently in recoil */
  private inRecoil = false;

  /** Gun body mesh (for potential color changes per weapon type) */
  private bodyMesh: THREE.Mesh;
  private barrelMesh: THREE.Mesh;

  constructor(camera: THREE.PerspectiveCamera) {
    this.group = new THREE.Group();

    // Gun body: rectangular box
    const bodyGeo = new THREE.BoxGeometry(0.15, 0.1, 0.5);
    const gunMat = new THREE.MeshLambertMaterial({ color: 0x444444 });
    this.bodyMesh = new THREE.Mesh(bodyGeo, gunMat);
    this.bodyMesh.position.set(0, 0, 0);
    this.group.add(this.bodyMesh);

    // Barrel: smaller box extending forward
    const barrelGeo = new THREE.BoxGeometry(0.05, 0.05, 0.3);
    const barrelMat = new THREE.MeshLambertMaterial({ color: 0x333333 });
    this.barrelMesh = new THREE.Mesh(barrelGeo, barrelMat);
    // Position barrel at the front of the body, extending forward (-z in camera space)
    this.barrelMesh.position.set(0, 0.01, -0.35);
    this.group.add(this.barrelMesh);

    // Position group at bottom-right of view
    this.group.position.copy(this.restPosition);

    // Attach to camera so it moves with it
    camera.add(this.group);
  }

  /** Trigger recoil animation on fire */
  onFire(): void {
    this.inRecoil = true;
    this.recoilTime = 0;
  }

  /** Animate recoil recovery each frame */
  update(dt: number): void {
    if (!this.inRecoil) return;

    this.recoilTime += dt;
    const t = Math.min(this.recoilTime / this.recoilDuration, 1);

    // Recoil curve: kick back then return
    // Use a sine curve: peaks at t=0.5 then returns
    const kickAmount = Math.sin(t * Math.PI);

    // Kick backward (positive z in camera local space) and slightly upward
    this.group.position.set(
      this.restPosition.x,
      this.restPosition.y + kickAmount * 0.02,
      this.restPosition.z + kickAmount * 0.1
    );

    // Slight upward rotation for recoil
    this.group.rotation.set(
      -kickAmount * 0.08,
      this.restRotation.y,
      this.restRotation.z
    );

    if (t >= 1) {
      this.inRecoil = false;
      this.group.position.copy(this.restPosition);
      this.group.rotation.set(0, 0, 0);
    }
  }

  /** Optionally adjust appearance per weapon type */
  setWeaponType(name: string): void {
    // Adjust barrel length based on weapon type keyword
    const lowerName = name.toLowerCase();
    let barrelScale = 1;
    let bodyColor = 0x444444;

    if (lowerName.includes('sniper') || lowerName.includes('dmr')) {
      barrelScale = 1.5;
      bodyColor = 0x3a3a3a;
    } else if (lowerName.includes('shotgun')) {
      barrelScale = 0.8;
      bodyColor = 0x554433;
    } else if (lowerName.includes('smg') || lowerName.includes('pdw')) {
      barrelScale = 0.7;
      bodyColor = 0x4a4a4a;
    }

    this.barrelMesh.scale.z = barrelScale;
    (this.bodyMesh.material as THREE.MeshLambertMaterial).color.setHex(bodyColor);
  }

  /** Clean up */
  dispose(): void {
    this.bodyMesh.geometry.dispose();
    (this.bodyMesh.material as THREE.Material).dispose();
    this.barrelMesh.geometry.dispose();
    (this.barrelMesh.material as THREE.Material).dispose();
    // Remove from parent (camera)
    if (this.group.parent) {
      this.group.parent.remove(this.group);
    }
  }
}
