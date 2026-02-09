import * as THREE from 'three';
import { PLAYER_WIDTH, PLAYER_HEIGHT, INTERPOLATION_DELAY, TEAM_COLORS, Team } from '@clawfield/shared';
import type { PlayerState } from '@clawfield/shared';
import { createSoldierInstance, getSoldierAnimations } from './model-loader';

/**
 * Renders a remote player as a 3D soldier model (or colored box fallback).
 * Color is based on team. Hidden when dead.
 */
export class RemotePlayer {
  readonly id: string;
  readonly name: string;
  /** Root container — position/rotation applied here */
  readonly mesh: THREE.Object3D;
  team: number;
  alive: boolean = true;
  downed: boolean = false;

  private states: { time: number; state: PlayerState }[] = [];
  private labelEl: HTMLDivElement;
  /** Whether we're still using the fallback box (model not loaded yet) */
  private usingFallback: boolean = false;
  /** Animation mixer for skeletal animations */
  private mixer: THREE.AnimationMixer | null = null;

  constructor(id: string, name: string, scene: THREE.Scene, team: number) {
    this.id = id;
    this.name = name;
    this.team = team;

    const color = TEAM_COLORS[team as Team] ?? 0x888888;

    // Try to use the 3D soldier model
    const modelInstance = createSoldierInstance(color, PLAYER_HEIGHT);

    if (modelInstance) {
      // Wrap in a Group so `.mesh.position` / `.mesh.rotation` work the same
      this.mesh = new THREE.Group();
      this.mesh.add(modelInstance);

      // Set up animation mixer and play the idle animation
      const clips = getSoldierAnimations();
      if (clips.length > 0) {
        this.mixer = new THREE.AnimationMixer(modelInstance);
        const idleClip = clips.find(c => c.name.includes('Standing')) ?? clips[0];
        const action = this.mixer.clipAction(idleClip);
        action.play();
      }
    } else {
      // Fallback: simple box mesh (identical to old behavior)
      this.usingFallback = true;
      const geometry = new THREE.BoxGeometry(PLAYER_WIDTH, PLAYER_HEIGHT, PLAYER_WIDTH);
      const material = new THREE.MeshLambertMaterial({ color });
      const box = new THREE.Mesh(geometry, material);
      geometry.translate(0, PLAYER_HEIGHT / 2, 0);
      this.mesh = box;
    }

    scene.add(this.mesh);

    // Name label
    this.labelEl = document.createElement('div');
    this.labelEl.className = 'name-label';
    this.labelEl.textContent = name;
    document.getElementById('name-labels')!.appendChild(this.labelEl);
  }

  /** Get current interpolated position */
  getPosition(): { x: number; y: number; z: number } {
    return { x: this.mesh.position.x, y: this.mesh.position.y, z: this.mesh.position.z };
  }

  /** Push a new state snapshot from the server */
  pushState(state: PlayerState): void {
    // Update visibility based on alive status
    this.alive = state.alive;
    this.downed = state.downed;
    this.mesh.visible = state.alive;
    this.labelEl.style.display = state.alive ? 'block' : 'none';

    this.states.push({ time: performance.now(), state });
    // Keep only last 1 second of states
    const cutoff = performance.now() - 1000;
    while (this.states.length > 2 && this.states[0].time < cutoff) {
      this.states.shift();
    }
  }

  /** Interpolate position between buffered server states */
  update(dt: number, camera: THREE.PerspectiveCamera): void {
    // Advance skeletal animation
    this.mixer?.update(dt);
    const now = performance.now() - INTERPOLATION_DELAY;

    if (this.states.length < 2) {
      // Not enough data to interpolate, snap to latest
      if (this.states.length === 1) {
        const s = this.states[0].state;
        this.mesh.position.set(s.position.x, s.position.y, s.position.z);
        this.mesh.rotation.y = -s.yaw;
      }
    } else {
      // Find two states to interpolate between
      let from = this.states[0];
      let to = this.states[1];

      for (let i = 1; i < this.states.length; i++) {
        if (this.states[i].time >= now) {
          to = this.states[i];
          from = this.states[i - 1];
          break;
        }
        from = this.states[i];
        to = this.states[Math.min(i + 1, this.states.length - 1)];
      }

      const range = to.time - from.time;
      const t = range > 0 ? Math.max(0, Math.min(1, (now - from.time) / range)) : 1;

      this.mesh.position.set(
        from.state.position.x + (to.state.position.x - from.state.position.x) * t,
        from.state.position.y + (to.state.position.y - from.state.position.y) * t,
        from.state.position.z + (to.state.position.z - from.state.position.z) * t,
      );
      this.mesh.rotation.y = -(from.state.yaw + (to.state.yaw - from.state.yaw) * t);
    }

    // Update name label position (project 3D → 2D)
    const labelPos = this.mesh.position.clone();
    labelPos.y += PLAYER_HEIGHT + 0.3;
    labelPos.project(camera);

    if (labelPos.z > 1) {
      this.labelEl.style.display = 'none';
    } else {
      this.labelEl.style.display = 'block';
      const x = (labelPos.x * 0.5 + 0.5) * window.innerWidth;
      const y = (-labelPos.y * 0.5 + 0.5) * window.innerHeight;
      this.labelEl.style.left = `${x}px`;
      this.labelEl.style.top = `${y}px`;
    }
  }

  /** Clean up mesh and label */
  dispose(scene: THREE.Scene): void {
    if (this.mixer) {
      this.mixer.stopAllAction();
      this.mixer.uncacheRoot(this.mesh);
      this.mixer = null;
    }
    scene.remove(this.mesh);
    // Dispose geometry/materials recursively
    this.mesh.traverse((child: THREE.Object3D) => {
      if ((child as THREE.Mesh).isMesh) {
        const m = child as THREE.Mesh;
        m.geometry.dispose();
        const materials = Array.isArray(m.material) ? m.material : [m.material];
        materials.forEach((mat: THREE.Material) => mat.dispose());
      }
    });
    this.labelEl.remove();
  }
}
