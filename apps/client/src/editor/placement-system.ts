import * as THREE from 'three';
import { CHUNK_SIZE, setVoxel, worldToChunk } from '@clawfield/shared';
import type { ComponentFile } from './component-browser';
import type { MapdefBounds, TerrainPaletteEntry } from './terrain-generator';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Placement {
  componentId: string;
  position: { x: number; y: number; z: number };
  rotation: number; // 0, 90, 180, 270
  terrainCarve: boolean;
}

interface RGB { r: number; g: number; b: number }

// ---------------------------------------------------------------------------
// Rotation helpers — ported from tools/map-compose.ts
// ---------------------------------------------------------------------------

export function rotateVoxel90Y(
  x: number, y: number, z: number,
  sizeX: number, sizeZ: number,
  degrees: number,
): { x: number; y: number; z: number } {
  const steps = ((degrees % 360) + 360) % 360 / 90;
  let rx = x, rz = z;
  let curSizeX = sizeX, curSizeZ = sizeZ;

  for (let s = 0; s < steps; s++) {
    const newX = curSizeZ - 1 - rz;
    const newZ = rx;
    rx = newX;
    rz = newZ;
    const tmp = curSizeX;
    curSizeX = curSizeZ;
    curSizeZ = tmp;
  }

  return { x: rx, y, z: rz };
}

export function rotatedSize(sizeX: number, sizeZ: number, degrees: number): { sizeX: number; sizeZ: number } {
  const steps = ((degrees % 360) + 360) % 360 / 90;
  return steps % 2 === 0 ? { sizeX, sizeZ } : { sizeX: sizeZ, sizeZ: sizeX };
}

function rotatedOrigin(
  origin: { x: number; y: number; z: number },
  sizeX: number, sizeZ: number,
  degrees: number,
): { x: number; y: number; z: number } {
  return rotateVoxel90Y(origin.x, origin.y, origin.z, sizeX, sizeZ, degrees);
}

// ---------------------------------------------------------------------------
// Palette merging — ported from tools/map-compose.ts
// ---------------------------------------------------------------------------

const TERRAIN_PALETTE_MAX = 32;
const COMPONENT_PALETTE_START = 33;
const PALETTE_SIZE = 256;

function colorDistance(a: RGB, b: RGB): number {
  const dr = a.r - b.r;
  const dg = a.g - b.g;
  const db = a.b - b.b;
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

export class PaletteManager {
  readonly palette: RGB[] = [];
  private nextFreeIndex = COMPONENT_PALETTE_START;

  constructor() {
    for (let i = 0; i < PALETTE_SIZE; i++) {
      this.palette.push({ r: 0, g: 0, b: 0 });
    }
  }

  setTerrainPalette(terrainPalette: Record<string, TerrainPaletteEntry>): void {
    for (const entry of Object.values(terrainPalette)) {
      if (entry.index >= 1 && entry.index <= TERRAIN_PALETTE_MAX) {
        this.palette[entry.index] = { r: entry.r, g: entry.g, b: entry.b };
      }
    }
  }

  private findOrAllocateColor(color: RGB): number {
    for (let i = 1; i < this.nextFreeIndex; i++) {
      if (colorDistance(this.palette[i], color) <= 4) return i;
    }
    if (this.nextFreeIndex < PALETTE_SIZE) {
      const idx = this.nextFreeIndex;
      this.palette[idx] = { ...color };
      this.nextFreeIndex++;
      return idx;
    }
    let bestIdx = 1;
    let bestDist = Infinity;
    for (let i = 1; i < PALETTE_SIZE; i++) {
      const d = colorDistance(this.palette[i], color);
      if (d < bestDist) { bestDist = d; bestIdx = i; }
    }
    return bestIdx;
  }

  buildRemapTable(componentPalette: RGB[]): Uint8Array {
    const remap = new Uint8Array(256);
    remap[0] = 0;
    for (let i = 1; i < componentPalette.length && i < 256; i++) {
      const c = componentPalette[i];
      if (c.r === 0 && c.g === 0 && c.b === 0) { remap[i] = 0; continue; }
      remap[i] = this.findOrAllocateColor(c);
    }
    return remap;
  }

  /** Convert palette to hex array for MATERIAL_COLORS */
  toHexArray(): number[] {
    return this.palette.map((c) => (c.r << 16) | (c.g << 8) | c.b);
  }
}

// ---------------------------------------------------------------------------
// Placement System
// ---------------------------------------------------------------------------

export class PlacementSystem {
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private raycaster = new THREE.Raycaster();

  // Ghost preview
  private ghostMesh: THREE.Mesh | null = null;
  private ghostRotation = 0;
  private ghostComponentId: string | null = null;
  private ghostComponent: ComponentFile | null = null;
  private ghostPosition = new THREE.Vector3();
  private ghostVisible = false;

  // Active placements with selection
  private placements: Placement[] = [];
  private selectedPlacementIndex = -1;
  private selectionHelper: THREE.BoxHelper | null = null;

  // Callbacks
  private onPlacementChange: () => void;

  constructor(
    scene: THREE.Scene,
    camera: THREE.PerspectiveCamera,
    onPlacementChange: () => void,
  ) {
    this.scene = scene;
    this.camera = camera;
    this.onPlacementChange = onPlacementChange;
  }

  setGhostComponent(id: string, component: ComponentFile): void {
    this.removeGhost();
    this.ghostComponentId = id;
    this.ghostComponent = component;
    this.ghostRotation = 0;
    this.buildGhostMesh();
  }

  private buildGhostMesh(): void {
    if (!this.ghostComponent) return;
    this.removeGhost();

    const comp = this.ghostComponent;
    const voxelCount = comp.voxels.length;
    if (voxelCount === 0) return;

    // Build instanced mesh from component voxels
    const boxGeo = new THREE.BoxGeometry(1, 1, 1);
    const mat = new THREE.MeshBasicMaterial({
      color: 0x44cc66,
      transparent: true,
      opacity: 0.35,
      depthWrite: false,
    });

    const instancedMesh = new THREE.InstancedMesh(boxGeo, mat, voxelCount);
    const dummy = new THREE.Object3D();

    for (let i = 0; i < comp.voxels.length; i++) {
      const v = comp.voxels[i];
      const rot = rotateVoxel90Y(v.x, v.y, v.z, comp.bounds.sizeX, comp.bounds.sizeZ, this.ghostRotation);
      dummy.position.set(rot.x + 0.5, rot.y + 0.5, rot.z + 0.5);
      dummy.updateMatrix();
      instancedMesh.setMatrixAt(i, dummy.matrix);
    }

    instancedMesh.instanceMatrix.needsUpdate = true;
    instancedMesh.renderOrder = 999;

    // Wrap in a group for easy positioning
    const group = new THREE.Group();
    group.add(instancedMesh);
    group.visible = false;

    this.ghostMesh = instancedMesh as unknown as THREE.Mesh;
    this.scene.add(group);
    this.ghostVisible = false;
  }

  removeGhost(): void {
    if (this.ghostMesh) {
      const parent = this.ghostMesh.parent;
      if (parent) {
        this.scene.remove(parent);
        parent.traverse((obj) => {
          if ((obj as THREE.Mesh).geometry) (obj as THREE.Mesh).geometry.dispose();
          if ((obj as THREE.Mesh).material) {
            const mat = (obj as THREE.Mesh).material;
            if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
            else (mat as THREE.Material).dispose();
          }
        });
      }
      this.ghostMesh = null;
    }
    this.ghostComponentId = null;
    this.ghostComponent = null;
    this.ghostVisible = false;
  }

  updateGhost(mouseNDC: THREE.Vector2): void {
    if (!this.ghostMesh || !this.ghostComponent) return;

    this.raycaster.setFromCamera(mouseNDC, this.camera);
    const chunkMeshes = this.scene.children.filter((c) => c.name.startsWith('chunk_'));
    const intersects = this.raycaster.intersectObjects(chunkMeshes, false);

    const parent = this.ghostMesh.parent;
    if (!parent) return;

    if (intersects.length > 0) {
      const hit = intersects[0];
      const point = hit.point;

      // Snap to integer grid
      const sx = Math.round(point.x);
      const sy = Math.round(point.y);
      const sz = Math.round(point.z);

      // Offset by rotated origin
      const rotOrigin = rotatedOrigin(
        this.ghostComponent.origin,
        this.ghostComponent.bounds.sizeX,
        this.ghostComponent.bounds.sizeZ,
        this.ghostRotation,
      );

      parent.position.set(sx - rotOrigin.x, sy - rotOrigin.y, sz - rotOrigin.z);
      this.ghostPosition.set(sx, sy, sz);
      parent.visible = true;
      this.ghostVisible = true;
    } else {
      parent.visible = false;
      this.ghostVisible = false;
    }
  }

  rotateGhost(): void {
    this.ghostRotation = (this.ghostRotation + 90) % 360;
    if (this.ghostComponent) {
      this.buildGhostMesh();
    }
  }

  /** Place the ghost component at its current position */
  placeGhost(): Placement | null {
    if (!this.ghostVisible || !this.ghostComponentId) return null;

    const placement: Placement = {
      componentId: this.ghostComponentId,
      position: {
        x: this.ghostPosition.x,
        y: this.ghostPosition.y,
        z: this.ghostPosition.z,
      },
      rotation: this.ghostRotation,
      terrainCarve: false,
    };

    this.placements.push(placement);
    this.onPlacementChange();
    return placement;
  }

  /** Render a placed component into the chunk map */
  renderPlacementToChunks(
    placement: Placement,
    component: ComponentFile,
    paletteManager: PaletteManager,
    chunks: Map<string, Uint8Array>,
    bounds: MapdefBounds,
  ): Set<string> {
    const remap = paletteManager.buildRemapTable(component.palette);

    const { sizeX: rotSizeX, sizeZ: rotSizeZ } = rotatedSize(
      component.bounds.sizeX, component.bounds.sizeZ, placement.rotation
    );
    const rotOrigin = rotatedOrigin(
      component.origin, component.bounds.sizeX, component.bounds.sizeZ, placement.rotation
    );

    const offsetX = placement.position.x - rotOrigin.x;
    const offsetY = placement.position.y - rotOrigin.y;
    const offsetZ = placement.position.z - rotOrigin.z;

    const affectedChunks = new Set<string>();

    // Terrain carve
    if (placement.terrainCarve) {
      for (let x = offsetX; x < offsetX + rotSizeX; x++) {
        for (let z = offsetZ; z < offsetZ + rotSizeZ; z++) {
          for (let y = offsetY; y < offsetY + component.bounds.sizeY; y++) {
            const { chunkKey } = worldToChunk(x, y, z);
            const chunk = chunks.get(chunkKey);
            if (chunk) {
              const { localX, localY, localZ } = worldToChunk(x, y, z);
              const idx = localX + localY * CHUNK_SIZE + localZ * CHUNK_SIZE * CHUNK_SIZE;
              const current = chunk[idx];
              if (current > 0 && current <= TERRAIN_PALETTE_MAX) {
                chunk[idx] = 0;
                affectedChunks.add(chunkKey);
              }
            }
          }
        }
      }
    }

    // Place voxels
    for (const v of component.voxels) {
      const rot = rotateVoxel90Y(v.x, v.y, v.z, component.bounds.sizeX, component.bounds.sizeZ, placement.rotation);
      const wx = offsetX + rot.x;
      const wy = offsetY + rot.y;
      const wz = offsetZ + rot.z;

      if (wx < bounds.xMin || wx > bounds.xMax) continue;
      if (wy < bounds.yMin || wy > bounds.yMax) continue;
      if (wz < bounds.zMin || wz > bounds.zMax) continue;

      const remappedColor = remap[v.c];
      if (remappedColor > 0) {
        setVoxel(chunks, wx, wy, wz, remappedColor);
        const { chunkKey } = worldToChunk(wx, wy, wz);
        affectedChunks.add(chunkKey);
      }
    }

    return affectedChunks;
  }

  /** Raycast to find placement under mouse */
  findPlacementAt(mouseNDC: THREE.Vector2): number {
    if (this.placements.length === 0) return -1;

    this.raycaster.setFromCamera(mouseNDC, this.camera);
    const chunkMeshes = this.scene.children.filter((c) => c.name.startsWith('chunk_'));
    const intersects = this.raycaster.intersectObjects(chunkMeshes, false);
    if (intersects.length === 0) return -1;

    const point = intersects[0].point;

    // Find nearest placement
    let bestIdx = -1;
    let bestDist = 10; // max selection distance

    for (let i = 0; i < this.placements.length; i++) {
      const p = this.placements[i];
      const dx = point.x - p.position.x;
      const dy = point.y - p.position.y;
      const dz = point.z - p.position.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (dist < bestDist) {
        bestDist = dist;
        bestIdx = i;
      }
    }

    return bestIdx;
  }

  selectPlacement(index: number): void {
    this.selectedPlacementIndex = index;
    this.updateSelectionHelper();
  }

  private updateSelectionHelper(): void {
    if (this.selectionHelper) {
      this.scene.remove(this.selectionHelper);
      this.selectionHelper.dispose();
      this.selectionHelper = null;
    }

    if (this.selectedPlacementIndex < 0 || this.selectedPlacementIndex >= this.placements.length) return;

    const p = this.placements[this.selectedPlacementIndex];
    const box = new THREE.Box3(
      new THREE.Vector3(p.position.x - 5, p.position.y, p.position.z - 5),
      new THREE.Vector3(p.position.x + 5, p.position.y + 10, p.position.z + 5),
    );

    const helper = new THREE.Box3Helper(box, new THREE.Color(0xffff00));
    this.scene.add(helper);
    this.selectionHelper = helper as unknown as THREE.BoxHelper;
  }

  deletePlacement(index: number): Placement | null {
    if (index < 0 || index >= this.placements.length) return null;
    const removed = this.placements.splice(index, 1)[0];
    if (this.selectedPlacementIndex === index) {
      this.selectedPlacementIndex = -1;
      this.updateSelectionHelper();
    }
    this.onPlacementChange();
    return removed;
  }

  toggleTerrainCarve(index: number): void {
    if (index < 0 || index >= this.placements.length) return;
    this.placements[index].terrainCarve = !this.placements[index].terrainCarve;
    this.onPlacementChange();
  }

  getPlacements(): Placement[] {
    return this.placements;
  }

  setPlacements(placements: Placement[]): void {
    this.placements = placements;
    this.selectedPlacementIndex = -1;
    this.onPlacementChange();
  }

  getGhostPosition(): THREE.Vector3 | null {
    return this.ghostVisible ? this.ghostPosition.clone() : null;
  }

  hasGhost(): boolean {
    return this.ghostMesh !== null;
  }

  getSelectedIndex(): number {
    return this.selectedPlacementIndex;
  }

  dispose(): void {
    this.removeGhost();
    if (this.selectionHelper) {
      this.scene.remove(this.selectionHelper);
      this.selectionHelper.dispose();
    }
  }
}
