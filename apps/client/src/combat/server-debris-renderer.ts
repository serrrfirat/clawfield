/**
 * Server-authoritative debris renderer.
 * Renders debris bodies at positions sent from the server.
 * No local physics simulation - just visual rendering.
 */
import * as THREE from 'three';
import type { DebrisState } from '@clawfield/shared';

const _matrix = new THREE.Matrix4();
const _pos = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _scale = new THREE.Vector3();
const _color = new THREE.Color();

/** Max debris instances to render */
const MAX_DEBRIS_INSTANCES = 2000;
const INTERP_DELAY_MS = 100;
const MAX_EXTRAP_MS = 120;
const MAX_EXTRAP_DIST = 1.5;
const SPAWN_BLEND_MS = 100;
const DESPAWN_BLEND_MS = 150;

interface DebrisSnapshot {
  timeMs: number;
  position: THREE.Vector3;
  rotation: THREE.Quaternion;
}

interface DebrisTrack {
  id: number;
  instanceIndex: number;
  scale: number;
  snapshots: DebrisSnapshot[];
  velocity: THREE.Vector3;
  spawnTimeMs: number;
  despawnStartMs: number | null;
}

export class ServerDebrisRenderer {
  private scene: THREE.Scene;
  private mesh: THREE.InstancedMesh;
  private debrisMap = new Map<number, DebrisState>();
  private tracks = new Map<number, DebrisTrack>();
  private nextInstanceIndex = 0;
  private freeInstanceIndices: number[] = [];
  private colorArray: Float32Array;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    
    // Create instanced mesh for all debris
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const material = new THREE.MeshStandardMaterial({
      roughness: 0.85,
      metalness: 0.0,
    });
    
    this.mesh = new THREE.InstancedMesh(geometry, material, MAX_DEBRIS_INSTANCES);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    
    // Initialize color buffer
    this.colorArray = new Float32Array(MAX_DEBRIS_INSTANCES * 3);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(this.colorArray, 3);
    this.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    
    scene.add(this.mesh);
  }

  /**
   * Update debris from server states.
   * Creates new instances for new debris, updates positions for existing ones.
   */
  updateFromServer(states: DebrisState[]): void {
    const nowMs = performance.now();
    const currentIds = new Set<number>();

    for (const state of states) {
      currentIds.add(state.id);

      let track = this.tracks.get(state.id);
      if (!track) {
        const instanceIndex = this.allocateInstanceIndex();
        if (instanceIndex < 0) {
          continue;
        }

        _color.setHex(state.color);
        this.colorArray[instanceIndex * 3] = _color.r;
        this.colorArray[instanceIndex * 3 + 1] = _color.g;
        this.colorArray[instanceIndex * 3 + 2] = _color.b;

        track = {
          id: state.id,
          instanceIndex,
          scale: state.scale,
          snapshots: [],
          velocity: new THREE.Vector3(),
          spawnTimeMs: nowMs,
          despawnStartMs: null,
        };
        this.tracks.set(state.id, track);
      }

      track.scale = state.scale;
      track.despawnStartMs = null;
      this.pushSnapshot(track, state, nowMs);

      this.debrisMap.set(state.id, state);
    }

    // Start despawn blend for missing tracks
    for (const [id, track] of this.tracks) {
      if (!currentIds.has(id)) {
        this.debrisMap.delete(id);
        if (track.despawnStartMs === null) {
          track.despawnStartMs = nowMs;
        }
      }
    }

    if (this.mesh.instanceColor) {
      this.mesh.instanceColor.needsUpdate = true;
    }
  }

  /** Advance interpolation/extrapolation and write instance transforms. */
  update(nowMs = performance.now()): void {
    const renderTimeMs = nowMs - INTERP_DELAY_MS;

    for (const [id, track] of this.tracks) {
      if (track.despawnStartMs !== null) {
        const despawnAge = nowMs - track.despawnStartMs;
        if (despawnAge >= DESPAWN_BLEND_MS) {
          this.releaseTrack(id, track);
          continue;
        }
      }

      const sample = this.sampleTrack(track, renderTimeMs);
      if (!sample) {
        continue;
      }

      const spawnAlpha = Math.min(1, (nowMs - track.spawnTimeMs) / SPAWN_BLEND_MS);
      const despawnAlpha = track.despawnStartMs === null
        ? 1
        : Math.max(0, 1 - (nowMs - track.despawnStartMs) / DESPAWN_BLEND_MS);
      const visAlpha = spawnAlpha * despawnAlpha;

      _scale.setScalar(track.scale * visAlpha);
      _matrix.compose(sample.position, sample.rotation, _scale);
      this.mesh.setMatrixAt(track.instanceIndex, _matrix);
    }

    this.mesh.instanceMatrix.needsUpdate = true;
  }

  /**
   * Get all currently active debris states.
   */
  getDebrisStates(): DebrisState[] {
    return Array.from(this.debrisMap.values());
  }

  private allocateInstanceIndex(): number {
    const recycled = this.freeInstanceIndices.pop();
    if (recycled !== undefined) {
      return recycled;
    }
    if (this.nextInstanceIndex >= MAX_DEBRIS_INSTANCES) {
      return -1;
    }
    const idx = this.nextInstanceIndex;
    this.nextInstanceIndex++;
    this.mesh.count = this.nextInstanceIndex;
    return idx;
  }

  private pushSnapshot(track: DebrisTrack, state: DebrisState, timeMs: number): void {
    const next: DebrisSnapshot = {
      timeMs,
      position: new THREE.Vector3(state.position.x, state.position.y, state.position.z),
      rotation: new THREE.Quaternion(state.rotation.x, state.rotation.y, state.rotation.z, state.rotation.w),
    };

    const prev = track.snapshots[track.snapshots.length - 1];
    if (prev) {
      const dt = (next.timeMs - prev.timeMs) / 1000;
      if (dt > 0.0001) {
        track.velocity.copy(next.position).sub(prev.position).divideScalar(dt);
      }
    }

    track.snapshots.push(next);
    if (track.snapshots.length > 2) {
      track.snapshots.shift();
    }
  }

  private sampleTrack(
    track: DebrisTrack,
    renderTimeMs: number,
  ): { position: THREE.Vector3; rotation: THREE.Quaternion } | null {
    if (track.snapshots.length === 0) {
      return null;
    }

    if (track.snapshots.length === 1) {
      const snap = track.snapshots[0];
      const extrapMs = Math.min(MAX_EXTRAP_MS, Math.max(0, renderTimeMs - snap.timeMs));
      const extrapSec = extrapMs / 1000;
      _pos.copy(snap.position).addScaledVector(track.velocity, extrapSec);
      if (_pos.distanceTo(snap.position) > MAX_EXTRAP_DIST) {
        _pos.copy(snap.position);
      }
      _quat.copy(snap.rotation);
      return { position: _pos, rotation: _quat };
    }

    const a = track.snapshots[0];
    const b = track.snapshots[1];

    if (renderTimeMs <= a.timeMs) {
      _pos.copy(a.position);
      _quat.copy(a.rotation);
      return { position: _pos, rotation: _quat };
    }

    if (renderTimeMs >= b.timeMs) {
      const extrapMs = Math.min(MAX_EXTRAP_MS, renderTimeMs - b.timeMs);
      const extrapSec = extrapMs / 1000;
      _pos.copy(b.position).addScaledVector(track.velocity, extrapSec);
      if (_pos.distanceTo(b.position) > MAX_EXTRAP_DIST) {
        _pos.copy(b.position);
      }
      _quat.copy(b.rotation);
      return { position: _pos, rotation: _quat };
    }

    const span = b.timeMs - a.timeMs;
    const alpha = span <= 0 ? 1 : (renderTimeMs - a.timeMs) / span;
    _pos.lerpVectors(a.position, b.position, alpha);
    _quat.slerpQuaternions(a.rotation, b.rotation, alpha);
    return { position: _pos, rotation: _quat };
  }

  private releaseTrack(id: number, track: DebrisTrack): void {
    _matrix.makeScale(0, 0, 0);
    this.mesh.setMatrixAt(track.instanceIndex, _matrix);
    this.freeInstanceIndices.push(track.instanceIndex);
    this.tracks.delete(id);
    this.debrisMap.delete(id);
  }

  /**
   * Clean up and dispose resources.
   */
  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.mesh.parent?.remove(this.mesh);
    this.debrisMap.clear();
    this.tracks.clear();
    this.freeInstanceIndices.length = 0;
  }
}
