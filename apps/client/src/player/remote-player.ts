import * as THREE from 'three';
import { PLAYER_WIDTH, PLAYER_HEIGHT, INTERPOLATION_DELAY, TEAM_COLORS, Team } from '@clawfield/shared';
import type { PlayerState } from '@clawfield/shared';

/**
 * Renders a remote player as a colored box with interpolation.
 * Color is based on team. Hidden when dead.
 */
export class RemotePlayer {
  readonly id: string;
  readonly name: string;
  readonly mesh: THREE.Mesh;
  team: number;
  alive: boolean = true;

  private states: { time: number; state: PlayerState }[] = [];
  private labelEl: HTMLDivElement;

  constructor(id: string, name: string, scene: THREE.Scene, team: number) {
    this.id = id;
    this.name = name;
    this.team = team;

    // Use team color; fall back to grey if team is unknown
    const color = TEAM_COLORS[team as Team] ?? 0x888888;

    // Simple box mesh for the player body
    const geometry = new THREE.BoxGeometry(PLAYER_WIDTH, PLAYER_HEIGHT, PLAYER_WIDTH);
    const material = new THREE.MeshLambertMaterial({ color });
    this.mesh = new THREE.Mesh(geometry, material);
    // Offset geometry so position represents feet
    geometry.translate(0, PLAYER_HEIGHT / 2, 0);
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
  update(camera: THREE.PerspectiveCamera): void {
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
    scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.MeshLambertMaterial).dispose();
    this.labelEl.remove();
  }
}
