import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SpawnPoint {
  team: 'alpha' | 'bravo';
  position: { x: number; y: number; z: number };
}

export interface CapturePoint {
  id: string;
  position: { x: number; y: number; z: number };
  initialOwner: number;
}

// ---------------------------------------------------------------------------
// Metadata Editor
// ---------------------------------------------------------------------------

export class MetadataEditor {
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private raycaster = new THREE.Raycaster();

  private spawns: SpawnPoint[] = [];
  private captures: CapturePoint[] = [];

  // Visual markers
  private markers: THREE.Object3D[] = [];

  // Sidebar
  private container: HTMLDivElement | null = null;

  // Callbacks
  private onChange: () => void;
  private onFocus: (pos: THREE.Vector3) => void;

  constructor(
    scene: THREE.Scene,
    camera: THREE.PerspectiveCamera,
    onChange: () => void,
    onFocus: (pos: THREE.Vector3) => void,
  ) {
    this.scene = scene;
    this.camera = camera;
    this.onChange = onChange;
    this.onFocus = onFocus;
  }

  // -----------------------------------------------------------------------
  // Marker creation
  // -----------------------------------------------------------------------

  private createSpawnMarker(spawn: SpawnPoint): THREE.Mesh {
    const color = spawn.team === 'alpha' ? 0x3498db : 0xe74c3c;
    const geo = new THREE.BoxGeometry(0.8, 1.8, 0.8);
    const mat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.6,
      depthTest: true,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(spawn.position.x, spawn.position.y + 0.9, spawn.position.z);
    mesh.name = `spawn_${spawn.team}`;
    mesh.userData = { type: 'spawn', data: spawn };
    return mesh;
  }

  private createCaptureMarker(cp: CapturePoint): THREE.Group {
    const group = new THREE.Group();
    group.name = `capture_${cp.id}`;
    group.userData = { type: 'capture', data: cp };

    // Cylinder
    const geo = new THREE.CylinderGeometry(3, 3, 0.5, 16);
    const color = cp.initialOwner === 0 ? 0x3498db : cp.initialOwner === 1 ? 0xe74c3c : 0xf1c40f;
    const mat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.4,
      depthTest: true,
    });
    const cyl = new THREE.Mesh(geo, mat);
    cyl.position.set(cp.position.x, cp.position.y + 0.25, cp.position.z);
    group.add(cyl);

    // Label sprite
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 48px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(cp.id, 32, 32);

    const tex = new THREE.CanvasTexture(canvas);
    const spriteMat = new THREE.SpriteMaterial({ map: tex, depthTest: false });
    const sprite = new THREE.Sprite(spriteMat);
    sprite.position.set(cp.position.x, cp.position.y + 4, cp.position.z);
    sprite.scale.set(3, 3, 1);
    group.add(sprite);

    return group;
  }

  // -----------------------------------------------------------------------
  // Rebuild all markers
  // -----------------------------------------------------------------------

  private clearMarkers(): void {
    for (const m of this.markers) {
      this.scene.remove(m);
      m.traverse((obj) => {
        if ((obj as THREE.Mesh).geometry) (obj as THREE.Mesh).geometry.dispose();
        if ((obj as THREE.Mesh).material) {
          const mat = (obj as THREE.Mesh).material;
          if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
          else (mat as THREE.Material).dispose();
        }
      });
    }
    this.markers = [];
  }

  rebuildMarkers(): void {
    this.clearMarkers();

    for (const spawn of this.spawns) {
      const marker = this.createSpawnMarker(spawn);
      this.scene.add(marker);
      this.markers.push(marker);
    }

    for (const cp of this.captures) {
      const marker = this.createCaptureMarker(cp);
      this.scene.add(marker);
      this.markers.push(marker);
    }
  }

  // -----------------------------------------------------------------------
  // Placement via raycast
  // -----------------------------------------------------------------------

  placeSpawn(team: 'alpha' | 'bravo', mouseNDC: THREE.Vector2): SpawnPoint | null {
    const pos = this.raycastTerrain(mouseNDC);
    if (!pos) return null;

    const spawn: SpawnPoint = {
      team,
      position: { x: Math.round(pos.x), y: Math.round(pos.y), z: Math.round(pos.z) },
    };
    this.spawns.push(spawn);
    this.rebuildMarkers();
    this.onChange();
    this.updateSidebar();
    return spawn;
  }

  placeCapture(id: string, mouseNDC: THREE.Vector2): CapturePoint | null {
    const pos = this.raycastTerrain(mouseNDC);
    if (!pos) return null;

    const cp: CapturePoint = {
      id,
      position: { x: Math.round(pos.x), y: Math.round(pos.y), z: Math.round(pos.z) },
      initialOwner: -1,
    };
    this.captures.push(cp);
    this.rebuildMarkers();
    this.onChange();
    this.updateSidebar();
    return cp;
  }

  deleteNearest(mouseNDC: THREE.Vector2): boolean {
    const pos = this.raycastTerrain(mouseNDC);
    if (!pos) return false;

    // Check spawns
    let bestDist = 8;
    let bestType: 'spawn' | 'capture' | null = null;
    let bestIdx = -1;

    for (let i = 0; i < this.spawns.length; i++) {
      const s = this.spawns[i];
      const dist = Math.sqrt(
        (pos.x - s.position.x) ** 2 + (pos.y - s.position.y) ** 2 + (pos.z - s.position.z) ** 2
      );
      if (dist < bestDist) { bestDist = dist; bestType = 'spawn'; bestIdx = i; }
    }

    for (let i = 0; i < this.captures.length; i++) {
      const c = this.captures[i];
      const dist = Math.sqrt(
        (pos.x - c.position.x) ** 2 + (pos.y - c.position.y) ** 2 + (pos.z - c.position.z) ** 2
      );
      if (dist < bestDist) { bestDist = dist; bestType = 'capture'; bestIdx = i; }
    }

    if (bestType === 'spawn' && bestIdx >= 0) {
      this.spawns.splice(bestIdx, 1);
    } else if (bestType === 'capture' && bestIdx >= 0) {
      this.captures.splice(bestIdx, 1);
    } else {
      return false;
    }

    this.rebuildMarkers();
    this.onChange();
    this.updateSidebar();
    return true;
  }

  private raycastTerrain(mouseNDC: THREE.Vector2): THREE.Vector3 | null {
    this.raycaster.setFromCamera(mouseNDC, this.camera);
    const chunkMeshes = this.scene.children.filter((c) => c.name.startsWith('chunk_'));
    const intersects = this.raycaster.intersectObjects(chunkMeshes, false);
    if (intersects.length === 0) return null;
    return intersects[0].point;
  }

  // -----------------------------------------------------------------------
  // Sidebar UI
  // -----------------------------------------------------------------------

  buildSidebar(container: HTMLDivElement): void {
    this.container = container;
    this.updateSidebar();
  }

  private updateSidebar(): void {
    if (!this.container) return;
    this.container.innerHTML = '';

    const panel = document.createElement('div');
    panel.className = 'editor-panel';

    // Instructions
    const help = document.createElement('div');
    help.style.cssText = 'font-size:11px;color:#888;margin-bottom:12px;line-height:1.4';
    help.textContent = '1 = Alpha spawn, 2 = Bravo spawn, 3 = Capture point, X = Delete nearest';
    panel.appendChild(help);

    // Spawns section
    const spawnTitle = document.createElement('div');
    spawnTitle.className = 'editor-sidebar-section-title';
    spawnTitle.textContent = `Spawn Points (${this.spawns.length})`;
    panel.appendChild(spawnTitle);

    for (const spawn of this.spawns) {
      const item = document.createElement('div');
      item.className = 'editor-meta-item';
      item.innerHTML = `
        <span class="editor-meta-item-label" style="color:${spawn.team === 'alpha' ? '#3498db' : '#e74c3c'}">${spawn.team}</span>
        <span class="editor-meta-item-coords">${spawn.position.x}, ${spawn.position.y}, ${spawn.position.z}</span>
      `;
      item.addEventListener('click', () => {
        this.onFocus(new THREE.Vector3(spawn.position.x, spawn.position.y, spawn.position.z));
      });
      panel.appendChild(item);
    }

    // Capture section
    const capTitle = document.createElement('div');
    capTitle.className = 'editor-sidebar-section-title';
    capTitle.style.marginTop = '12px';
    capTitle.textContent = `Capture Points (${this.captures.length})`;
    panel.appendChild(capTitle);

    for (const cp of this.captures) {
      const item = document.createElement('div');
      item.className = 'editor-meta-item';
      item.innerHTML = `
        <span class="editor-meta-item-label">${cp.id}</span>
        <span class="editor-meta-item-coords">${cp.position.x}, ${cp.position.y}, ${cp.position.z}</span>
      `;
      item.addEventListener('click', () => {
        this.onFocus(new THREE.Vector3(cp.position.x, cp.position.y, cp.position.z));
      });
      panel.appendChild(item);
    }

    this.container.appendChild(panel);
  }

  // -----------------------------------------------------------------------
  // Data access
  // -----------------------------------------------------------------------

  getSpawns(): SpawnPoint[] {
    return this.spawns;
  }

  getCaptures(): CapturePoint[] {
    return this.captures;
  }

  setSpawns(spawns: SpawnPoint[]): void {
    this.spawns = spawns;
    this.rebuildMarkers();
    this.updateSidebar();
  }

  setCaptures(captures: CapturePoint[]): void {
    this.captures = captures;
    this.rebuildMarkers();
    this.updateSidebar();
  }

  getSpawnCount(): number {
    return this.spawns.length;
  }

  dispose(): void {
    this.clearMarkers();
  }
}
