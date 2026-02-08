import * as THREE from 'three';
import type { GadgetState } from '@clawfield/shared';

/** Tracked gadget mesh */
interface TrackedGadget {
  mesh: THREE.Mesh;
  type: string;
}

// Gadget visual colors
const GADGET_COLORS: Record<string, number> = {
  medkit: 0x2ecc71,      // green
  ammo_box: 0x8b6914,    // brown
  bandage: 0x2ecc71,     // green
  repair_tool: 0xf39c12, // orange
};

const GADGET_SIZE = 0.4;

/**
 * Renders server-authoritative gadget objects in the world.
 * Simple colored cubes at gadget positions with a gentle bob animation.
 */
export class GadgetRenderer {
  private scene: THREE.Scene;
  private gadgets = new Map<number, TrackedGadget>();
  private geometry = new THREE.BoxGeometry(GADGET_SIZE, GADGET_SIZE * 0.6, GADGET_SIZE);

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  /** Update from server gadget states */
  updateFromServer(gadgets: GadgetState[]): void {
    const serverIds = new Set<number>();

    for (const sg of gadgets) {
      // Deploy cover renders as actual voxels — skip gadget icon
      if (sg.type === 'repair_tool') continue;

      serverIds.add(sg.id);

      const existing = this.gadgets.get(sg.id);
      if (existing) {
        // Update position
        existing.mesh.position.set(sg.position.x, sg.position.y + GADGET_SIZE * 0.3, sg.position.z);
      } else {
        // Create new gadget mesh
        const color = GADGET_COLORS[sg.type] ?? 0xcccccc;
        const material = new THREE.MeshStandardMaterial({ color });
        const mesh = new THREE.Mesh(this.geometry, material);
        mesh.position.set(sg.position.x, sg.position.y + GADGET_SIZE * 0.3, sg.position.z);
        this.scene.add(mesh);
        this.gadgets.set(sg.id, { mesh, type: sg.type });
      }
    }

    // Remove stale gadgets
    for (const [id, tracked] of this.gadgets) {
      if (!serverIds.has(id)) {
        this.scene.remove(tracked.mesh);
        (tracked.mesh.material as THREE.Material).dispose();
        this.gadgets.delete(id);
      }
    }
  }

  /** Animate gadgets (gentle bob) */
  update(dt: number): void {
    const time = performance.now() / 1000;
    for (const [, tracked] of this.gadgets) {
      // Gentle floating bob
      tracked.mesh.position.y += Math.sin(time * 2) * 0.002;
      tracked.mesh.rotation.y += dt * 0.5;
    }
  }

  dispose(): void {
    for (const [, tracked] of this.gadgets) {
      this.scene.remove(tracked.mesh);
      (tracked.mesh.material as THREE.Material).dispose();
    }
    this.gadgets.clear();
    this.geometry.dispose();
  }
}
