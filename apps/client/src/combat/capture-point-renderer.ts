import * as THREE from 'three';
import type { CapturePointState } from '@clawfield/shared';
import { CAPTURE_RADIUS } from '@clawfield/shared';

/** Team colors matching shared/combat.ts */
const TEAM_ALPHA_COLOR = 0x3498db; // blue
const TEAM_BRAVO_COLOR = 0xe74c3c; // red
const NEUTRAL_COLOR = 0xcccccc; // gray

/** Pole height in world units */
const POLE_HEIGHT = 6;

/** Flag dimensions (voxel-style flat box) */
const FLAG_WIDTH = 1.6;
const FLAG_HEIGHT = 1.0;
const FLAG_DEPTH = 0.15;

/** Flag vertical range on the pole */
const FLAG_BASE_Y = 1.2;
const FLAG_MAX_Y = 4.8;

/** Lerp speed for smooth flag movement (units per second factor) */
const FLAG_LERP_SPEED = 4;

/** Capture zone ring settings */
const ZONE_RING_SEGMENTS = 48;
const ZONE_RING_OPACITY = 0.18;
const ZONE_RING_HEIGHT = 0.05;

/** Internal tracked capture point with meshes */
interface TrackedCapturePoint {
  /** Root group containing all meshes for this point */
  group: THREE.Group;
  /** The flag mesh (moves vertically) */
  flagMesh: THREE.Mesh;
  /** Current flag Y offset (lerps toward target) */
  currentFlagY: number;
  /** Target flag Y offset from server state */
  targetFlagY: number;
  /** The translucent zone ring on the ground */
  zoneMesh: THREE.Mesh;
  /** Material for the flag (color changes with owner) */
  flagMaterial: THREE.MeshStandardMaterial;
  /** Material for the zone ring (color changes with owner) */
  zoneMaterial: THREE.MeshStandardMaterial;
}

/**
 * Renders 3D capture point flags in the scene.
 *
 * Each capture point shows:
 * - A voxel-style pole
 * - A flag that moves vertically based on control value
 * - A translucent ring on the ground showing the capture radius
 */
export class CapturePointRenderer {
  private scene: THREE.Scene;
  private points = new Map<string, TrackedCapturePoint>();

  /** Shared geometries (reused across all capture points) */
  private readonly poleGeometry: THREE.BoxGeometry;
  private readonly flagGeometry: THREE.BoxGeometry;
  private readonly zoneGeometry: THREE.CylinderGeometry;

  /** Shared pole material (dark gray, doesn't change color) */
  private readonly poleMaterial: THREE.MeshStandardMaterial;

  constructor(scene: THREE.Scene) {
    this.scene = scene;

    // Pole: tall thin box (voxel-style)
    this.poleGeometry = new THREE.BoxGeometry(0.15, POLE_HEIGHT, 0.15);
    this.poleMaterial = new THREE.MeshStandardMaterial({ color: 0x444444 });

    // Flag: flat box
    this.flagGeometry = new THREE.BoxGeometry(FLAG_WIDTH, FLAG_HEIGHT, FLAG_DEPTH);

    // Zone ring: hollow cylinder (ring on the ground)
    this.zoneGeometry = new THREE.CylinderGeometry(
      CAPTURE_RADIUS,
      CAPTURE_RADIUS,
      ZONE_RING_HEIGHT,
      ZONE_RING_SEGMENTS,
      1,
      true, // open-ended for ring appearance
    );
  }

  /**
   * Update from server state.
   * Creates new points, updates existing ones, removes stale ones.
   */
  updateFromServer(points: CapturePointState[]): void {
    const serverIds = new Set<string>();

    for (const sp of points) {
      serverIds.add(sp.id);

      const existing = this.points.get(sp.id);
      if (existing) {
        // Update target flag position and colors
        existing.targetFlagY = FLAG_BASE_Y + FLAG_MAX_Y * sp.control;

        const color = this.teamColor(sp.owner);
        existing.flagMaterial.color.setHex(color);
        existing.zoneMaterial.color.setHex(color);
      } else {
        // Create new capture point
        this.createCapturePoint(sp);
      }
    }

    // Remove capture points no longer present on server
    for (const [id, tracked] of this.points) {
      if (!serverIds.has(id)) {
        this.removeCapturePoint(id, tracked);
      }
    }
  }

  /**
   * Per-frame update: smoothly lerp flag positions toward targets.
   */
  update(dt: number): void {
    for (const tracked of this.points.values()) {
      // Lerp current flag Y toward target
      const diff = tracked.targetFlagY - tracked.currentFlagY;
      if (Math.abs(diff) > 0.001) {
        tracked.currentFlagY += diff * Math.min(1, FLAG_LERP_SPEED * dt);
        tracked.flagMesh.position.y = tracked.currentFlagY;
      }
    }
  }

  /** Clean up all capture points and shared resources. */
  dispose(): void {
    for (const [id, tracked] of this.points) {
      this.removeCapturePoint(id, tracked);
    }
    this.poleGeometry.dispose();
    this.poleMaterial.dispose();
    this.flagGeometry.dispose();
    this.zoneGeometry.dispose();
  }

  // ── Private helpers ─────────────────────────────────────────────

  /** Create meshes for a new capture point and add to scene. */
  private createCapturePoint(sp: CapturePointState): void {
    const group = new THREE.Group();
    group.position.set(sp.position.x, sp.position.y, sp.position.z);

    // Pole — centered vertically at half pole height
    const poleMesh = new THREE.Mesh(this.poleGeometry, this.poleMaterial);
    poleMesh.position.y = POLE_HEIGHT / 2;
    group.add(poleMesh);

    // Flag — offset to the right of the pole so it hangs off the side
    const color = this.teamColor(sp.owner);
    const flagMaterial = new THREE.MeshStandardMaterial({ color });
    const flagMesh = new THREE.Mesh(this.flagGeometry, flagMaterial);
    const initialFlagY = FLAG_BASE_Y + FLAG_MAX_Y * sp.control;
    flagMesh.position.set(FLAG_WIDTH / 2 + 0.1, initialFlagY, 0);
    group.add(flagMesh);

    // Zone ring — flat on the ground
    const zoneMaterial = new THREE.MeshStandardMaterial({
      color,
      transparent: true,
      opacity: ZONE_RING_OPACITY,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const zoneMesh = new THREE.Mesh(this.zoneGeometry, zoneMaterial);
    zoneMesh.position.y = ZONE_RING_HEIGHT / 2;
    group.add(zoneMesh);

    this.scene.add(group);

    this.points.set(sp.id, {
      group,
      flagMesh,
      currentFlagY: initialFlagY,
      targetFlagY: initialFlagY,
      zoneMesh,
      flagMaterial,
      zoneMaterial,
    });
  }

  /** Remove a capture point from the scene and clean up. */
  private removeCapturePoint(id: string, tracked: TrackedCapturePoint): void {
    this.scene.remove(tracked.group);
    tracked.flagMaterial.dispose();
    tracked.zoneMaterial.dispose();
    this.points.delete(id);
  }

  /** Map owner team index to a hex color. */
  private teamColor(owner: number): number {
    if (owner === 0) return TEAM_ALPHA_COLOR;
    if (owner === 1) return TEAM_BRAVO_COLOR;
    return NEUTRAL_COLOR;
  }
}
