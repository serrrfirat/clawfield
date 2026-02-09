import * as THREE from 'three';
import type { GadgetState, Vec3 } from '@clawfield/shared';

/** Tracked gadget mesh */
interface TrackedGadget {
  group: THREE.Group;
  type: string;
  baseY: number;
}

/** Duration (seconds) before a client-predicted gadget is removed if server hasn't confirmed */
const LOCAL_GADGET_TIMEOUT = 3;

/**
 * Build a multi-box medkit model: white box with red cross on top.
 */
function buildMedkit(): THREE.Group {
  const g = new THREE.Group();
  // Main body
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(0.5, 0.3, 0.4),
    new THREE.MeshStandardMaterial({ color: 0xeeeeee, emissive: 0x115511, emissiveIntensity: 0.3 })
  );
  g.add(body);
  // Cross horizontal
  const crossH = new THREE.Mesh(
    new THREE.BoxGeometry(0.3, 0.06, 0.1),
    new THREE.MeshStandardMaterial({ color: 0xe74c3c })
  );
  crossH.position.y = 0.18;
  g.add(crossH);
  // Cross vertical
  const crossV = new THREE.Mesh(
    new THREE.BoxGeometry(0.1, 0.06, 0.3),
    new THREE.MeshStandardMaterial({ color: 0xe74c3c })
  );
  crossV.position.y = 0.18;
  g.add(crossV);
  return g;
}

/**
 * Build an ammo box model: olive crate with latch detail.
 */
function buildAmmoBox(): THREE.Group {
  const g = new THREE.Group();
  // Main crate
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(0.5, 0.3, 0.35),
    new THREE.MeshStandardMaterial({ color: 0x556b2f, emissive: 0x332200, emissiveIntensity: 0.15 })
  );
  g.add(body);
  // Latch strip
  const latch = new THREE.Mesh(
    new THREE.BoxGeometry(0.4, 0.04, 0.08),
    new THREE.MeshStandardMaterial({ color: 0x8b7355 })
  );
  latch.position.set(0, 0.17, 0);
  g.add(latch);
  // Side handles
  for (const side of [-1, 1]) {
    const handle = new THREE.Mesh(
      new THREE.BoxGeometry(0.06, 0.08, 0.2),
      new THREE.MeshStandardMaterial({ color: 0x444444 })
    );
    handle.position.set(side * 0.28, 0, 0);
    g.add(handle);
  }
  return g;
}

/**
 * Build a bandage model: small white roll.
 */
function buildBandage(): THREE.Group {
  const g = new THREE.Group();
  const roll = new THREE.Mesh(
    new THREE.BoxGeometry(0.2, 0.15, 0.2),
    new THREE.MeshStandardMaterial({ color: 0xf5f5f5, emissive: 0x113311, emissiveIntensity: 0.2 })
  );
  g.add(roll);
  // Stripe
  const stripe = new THREE.Mesh(
    new THREE.BoxGeometry(0.22, 0.04, 0.22),
    new THREE.MeshStandardMaterial({ color: 0xe74c3c })
  );
  stripe.position.y = 0;
  g.add(stripe);
  return g;
}

/**
 * Build a claymore model: flat dark green box with red front strip.
 */
function buildClaymore(): THREE.Group {
  const g = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(0.3, 0.2, 0.15),
    new THREE.MeshStandardMaterial({ color: 0x2d4a2d })
  );
  g.add(body);
  // Front face indicator (red = danger side)
  const front = new THREE.Mesh(
    new THREE.BoxGeometry(0.28, 0.18, 0.02),
    new THREE.MeshStandardMaterial({ color: 0xcc3333, emissive: 0x661111, emissiveIntensity: 0.3 })
  );
  front.position.z = 0.085;
  g.add(front);
  // Legs
  for (const side of [-1, 1]) {
    const leg = new THREE.Mesh(
      new THREE.BoxGeometry(0.03, 0.06, 0.06),
      new THREE.MeshStandardMaterial({ color: 0x333333 })
    );
    leg.position.set(side * 0.1, -0.13, 0);
    g.add(leg);
  }
  return g;
}

const GADGET_BUILDERS: Record<string, () => THREE.Group> = {
  medkit: buildMedkit,
  ammo_box: buildAmmoBox,
  bandage: buildBandage,
  claymore: buildClaymore,
};

/**
 * Renders server-authoritative gadget objects in the world.
 * Multi-box voxel-style models with emissive glow and bob animation.
 */
export class GadgetRenderer {
  private scene: THREE.Scene;
  private gadgets = new Map<number, TrackedGadget>();

  /** Counter for client-predicted gadget IDs (negative to avoid server ID conflicts) */
  private localNextId = -1;

  /** Track local predicted gadgets and their remaining timeout */
  private localTimeouts = new Map<number, number>();

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  /**
   * Spawn a client-predicted gadget for instant visual feedback.
   * Uses negative IDs to avoid conflicts with server-assigned IDs.
   */
  spawnLocal(position: Vec3, type: string): void {
    const id = this.localNextId--;

    const builder = GADGET_BUILDERS[type];
    const group = builder ? builder() : this.buildFallback(type);
    group.position.set(position.x, position.y + 0.15, position.z);
    this.scene.add(group);
    this.gadgets.set(id, { group, type, baseY: position.y + 0.15 });
    this.localTimeouts.set(id, LOCAL_GADGET_TIMEOUT);
  }

  /** Update from server gadget states */
  updateFromServer(gadgets: GadgetState[]): void {
    const serverIds = new Set<number>();

    for (const sg of gadgets) {
      // Deploy cover renders as actual voxels — skip gadget icon
      if (sg.type === 'repair_tool') continue;
      // Spotting scope is instant — no persistent render
      if (sg.type === 'spotting_scope') continue;

      serverIds.add(sg.id);

      const existing = this.gadgets.get(sg.id);
      if (existing) {
        // Update position (keep base Y for bob)
        existing.group.position.set(sg.position.x, sg.position.y + 0.15, sg.position.z);
        existing.baseY = sg.position.y + 0.15;
      } else {
        // Create new gadget model
        const builder = GADGET_BUILDERS[sg.type];
        const group = builder ? builder() : this.buildFallback(sg.type);
        group.position.set(sg.position.x, sg.position.y + 0.15, sg.position.z);
        this.scene.add(group);
        this.gadgets.set(sg.id, { group, type: sg.type, baseY: sg.position.y + 0.15 });
      }
    }

    // Remove stale server gadgets (don't touch local predicted ones with negative IDs)
    for (const [id, tracked] of this.gadgets) {
      if (id > 0 && !serverIds.has(id)) {
        this.disposeGroup(tracked.group);
        this.scene.remove(tracked.group);
        this.gadgets.delete(id);
      }
    }

    // When server confirms a gadget, clear all local predictions of that type
    // (since the player can only have one active gadget per deployment)
    if (serverIds.size > 0) {
      for (const [id] of this.localTimeouts) {
        const tracked = this.gadgets.get(id);
        if (tracked) {
          this.disposeGroup(tracked.group);
          this.scene.remove(tracked.group);
          this.gadgets.delete(id);
        }
        this.localTimeouts.delete(id);
      }
    }
  }

  /** Animate gadgets (gentle bob + rotation) and expire local predictions */
  update(dt: number): void {
    const time = performance.now() / 1000;
    for (const [id, tracked] of this.gadgets) {
      tracked.group.position.y = tracked.baseY + Math.sin(time * 2) * 0.05;
      tracked.group.rotation.y += dt * 0.5;
    }

    // Count down and remove expired local predicted gadgets
    for (const [id, remaining] of this.localTimeouts) {
      const newRemaining = remaining - dt;
      if (newRemaining <= 0) {
        const tracked = this.gadgets.get(id);
        if (tracked) {
          this.disposeGroup(tracked.group);
          this.scene.remove(tracked.group);
          this.gadgets.delete(id);
        }
        this.localTimeouts.delete(id);
      } else {
        this.localTimeouts.set(id, newRemaining);
      }
    }
  }

  /** Get IDs of currently tracked gadgets */
  getTrackedIds(): Set<number> {
    return new Set(this.gadgets.keys());
  }

  dispose(): void {
    for (const [, tracked] of this.gadgets) {
      this.disposeGroup(tracked.group);
      this.scene.remove(tracked.group);
    }
    this.gadgets.clear();
  }

  private buildFallback(type: string): THREE.Group {
    const g = new THREE.Group();
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.4, 0.24, 0.4),
      new THREE.MeshStandardMaterial({ color: 0xcccccc })
    );
    g.add(mesh);
    return g;
  }

  private disposeGroup(group: THREE.Group): void {
    group.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
        (child.material as THREE.Material).dispose();
      }
    });
  }
}
