import type { SpawnPointOption, CapturePointState, WeaponLoadout, Vec3 } from '@clawfield/shared';
import { ClassId, GadgetId, CLASSES, WEAPONS, type WeaponId, type ClassDef, AttachmentSlot, WEAPON_ATTACHMENTS, ATTACHMENTS, type AttachmentId, applyAttachments, getVoxel, CHUNK_SIZE, MATERIAL_COLORS } from '@clawfield/shared';

export interface DeployChoice {
  classId: string;
  weaponId: string;
  spawnPointId: string;
  loadout: WeaponLoadout;
}

/**
 * BattleBit-style deploy screen.
 * Top: terrain heightmap with player dots and capture points.
 * Bottom: class tabs + 5-slot loadout bar.
 */
export class DeployScreen {
  private root: HTMLDivElement;
  private mapCanvas: HTMLCanvasElement;
  private mapCtx: CanvasRenderingContext2D;
  private classTabsContainer: HTMLDivElement;
  private slotBarContainer: HTMLDivElement;
  private slotDetailContainer: HTMLDivElement;
  private deployBtn: HTMLButtonElement;
  private selectedClass: ClassId = ClassId.Assault;
  private selectedWeapon: WeaponId;
  private selectedSpawn: string = 'base';
  private spawns: SpawnPointOption[] = [];
  private capturePoints: CapturePointState[] = [];
  private team: number = 0;
  private onDeploy: ((choice: DeployChoice) => void) | null = null;
  private visible = false;
  /** Per-weapon loadout selections (persisted across deploys within a session) */
  private loadouts: Map<WeaponId, WeaponLoadout> = new Map();
  /** Selected grenade type index: 0 = frag, 1 = smoke */
  private selectedGrenadeIdx = 0;
  /** Selected gadget index (0 or 1) */
  private selectedGadgetIdx = 0;
  /** Currently open slot detail (-1 = none) */
  private openSlotIdx = -1;

  // Heightmap cache
  private cachedHeightmap: ImageData | null = null;
  private cachedChunkKeys: string = '';

  // Map coordinate mapping (set during renderMap)
  private mapMinX = 0;
  private mapMaxX = 1;
  private mapMinZ = 0;
  private mapMaxZ = 1;
  private mapMargin = 30;

  constructor() {
    this.selectedWeapon = CLASSES[ClassId.Assault].defaultPrimary;
    this.root = document.createElement('div');
    this.root.className = 'deploy-root';
    this.root.innerHTML = `
      <div class="deploy-overlay">
        <div class="deploy-panel">
          <canvas class="deploy-map" width="512" height="512"></canvas>
          <div class="deploy-bottom">
            <div class="deploy-class-tabs"></div>
            <div class="deploy-slot-bar"></div>
            <div class="deploy-slot-detail"></div>
            <button class="deploy-btn">DEPLOY</button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(this.root);

    this.mapCanvas = this.root.querySelector('.deploy-map')!;
    this.mapCtx = this.mapCanvas.getContext('2d')!;
    this.classTabsContainer = this.root.querySelector('.deploy-class-tabs')!;
    this.slotBarContainer = this.root.querySelector('.deploy-slot-bar')!;
    this.slotDetailContainer = this.root.querySelector('.deploy-slot-detail')!;
    this.deployBtn = this.root.querySelector('.deploy-btn')!;

    this.deployBtn.addEventListener('click', () => {
      if (this.onDeploy) {
        this.onDeploy({
          classId: this.selectedClass,
          weaponId: this.selectedWeapon,
          spawnPointId: this.selectedSpawn,
          loadout: this.getLoadout(),
        });
      }
    });

    // Click-to-spawn on map canvas
    this.mapCanvas.addEventListener('click', (e) => {
      this.handleMapClick(e);
    });

    this.injectStyles();
    this.hide();
  }

  show(
    spawns: SpawnPointOption[],
    team: number,
    capturePoints: CapturePointState[],
    chunks: Map<string, Uint8Array>,
    playerDots: Array<{ position: Vec3; team: number; alive: boolean }>,
    onDeploy: (choice: DeployChoice) => void,
  ): void {
    this.spawns = spawns;
    this.team = team;
    this.capturePoints = capturePoints;
    this.onDeploy = onDeploy;
    this.selectedSpawn = spawns.length > 0 ? spawns[0].id : 'base';
    this.visible = true;
    this.root.style.display = '';
    this.openSlotIdx = -1;
    this.buildClassTabs();
    this.updateSlotBar();
    this.updateSlotDetail();
    this.renderMap(chunks, playerDots);
  }

  hide(): void {
    this.visible = false;
    this.root.style.display = 'none';
    this.onDeploy = null;
  }

  isVisible(): boolean {
    return this.visible;
  }

  // ── Class Tabs ──────────────────────────────────────────────────

  private buildClassTabs(): void {
    this.classTabsContainer.innerHTML = '';
    const classes = Object.values(CLASSES);
    for (const cls of classes) {
      const tab = document.createElement('div');
      tab.className = 'deploy-tab' + (cls.id === this.selectedClass ? ' selected' : '');
      tab.dataset.classId = cls.id;

      const icon = document.createElement('span');
      icon.className = 'deploy-tab-icon';
      icon.textContent = cls.name[0];
      tab.appendChild(icon);

      const name = document.createElement('span');
      name.textContent = cls.name;
      tab.appendChild(name);

      tab.addEventListener('click', () => {
        this.selectedClass = cls.id;
        this.selectedWeapon = cls.defaultPrimary;
        this.openSlotIdx = -1;
        this.buildClassTabs();
        this.updateSlotBar();
        this.updateSlotDetail();
      });

      this.classTabsContainer.appendChild(tab);
    }
  }

  // ── 5-Slot Loadout Bar ─────────────────────────────────────────

  private updateSlotBar(): void {
    this.slotBarContainer.innerHTML = '';
    const cls = CLASSES[this.selectedClass];

    const slots = this.getSlotData(cls);

    for (let i = 0; i < slots.length; i++) {
      const slot = slots[i];
      const cell = document.createElement('div');
      cell.className = 'deploy-slot' + (this.openSlotIdx === i ? ' selected' : '');
      cell.innerHTML = `
        <div class="deploy-slot-label">${slot.label}</div>
        <div class="deploy-slot-value">${slot.value}</div>
      `;
      if (slot.clickable) {
        cell.style.cursor = 'pointer';
        cell.addEventListener('click', () => {
          this.openSlotIdx = this.openSlotIdx === i ? -1 : i;
          this.updateSlotBar();
          this.updateSlotDetail();
        });
      } else {
        cell.style.opacity = '0.6';
      }
      this.slotBarContainer.appendChild(cell);
    }
  }

  private getSlotData(cls: ClassDef): Array<{ label: string; value: string; clickable: boolean }> {
    const primaryWpn = WEAPONS[this.selectedWeapon];
    const secondaryWpn = WEAPONS[cls.secondary];
    const specialWpn = cls.specialWeapon ? WEAPONS[cls.specialWeapon] : null;
    const grenadeNames = ['Frag', 'Smoke'];
    const gadgetNames = cls.gadgets.map(g => this.gadgetDisplayName(g));

    return [
      { label: 'PRIMARY', value: primaryWpn.name, clickable: true },
      { label: 'SECONDARY', value: secondaryWpn.name, clickable: false },
      { label: 'SPECIAL', value: specialWpn ? specialWpn.name : '---', clickable: false },
      { label: 'GRENADE', value: grenadeNames[this.selectedGrenadeIdx], clickable: true },
      { label: 'GADGET', value: gadgetNames[this.selectedGadgetIdx] ?? '---', clickable: true },
    ];
  }

  private gadgetDisplayName(id: GadgetId): string {
    const names: Record<string, string> = {
      frag_grenade: 'Frag Grenade',
      smoke_grenade: 'Smoke',
      medkit: 'Medkit',
      bandage: 'Bandage',
      ammo_box: 'Ammo Box',
      repair_tool: 'Deploy Cover',
      spotting_scope: 'Spotting Scope',
      claymore: 'Claymore',
    };
    return names[id] ?? id;
  }

  // ── Slot Detail Panel ──────────────────────────────────────────

  private updateSlotDetail(): void {
    this.slotDetailContainer.innerHTML = '';
    const cls = CLASSES[this.selectedClass];

    if (this.openSlotIdx === 0) {
      // Primary weapon picker + attachments
      this.buildPrimaryDetail(cls);
    } else if (this.openSlotIdx === 3) {
      // Grenade picker
      this.buildGrenadeDetail();
    } else if (this.openSlotIdx === 4) {
      // Gadget picker
      this.buildGadgetDetail(cls);
    }
  }

  private buildPrimaryDetail(cls: ClassDef): void {
    const container = document.createElement('div');
    container.className = 'deploy-detail-inner';

    // Weapon toggle
    const weaponRow = document.createElement('div');
    weaponRow.className = 'deploy-detail-row';

    const makeWpnBtn = (weaponId: WeaponId) => {
      const wpn = WEAPONS[weaponId];
      const btn = document.createElement('div');
      btn.className = 'deploy-detail-btn' + (this.selectedWeapon === weaponId ? ' selected' : '');
      btn.innerHTML = `<strong>${wpn.name}</strong><br><small>DMG ${wpn.damage} &middot; RPM ${wpn.rpm} &middot; MAG ${wpn.magSize}</small>`;
      btn.addEventListener('click', () => {
        this.selectedWeapon = weaponId;
        this.updateSlotBar();
        this.updateSlotDetail();
      });
      return btn;
    };

    weaponRow.appendChild(makeWpnBtn(cls.defaultPrimary));
    weaponRow.appendChild(makeWpnBtn(cls.altPrimary));
    container.appendChild(weaponRow);

    // Attachment picker
    const available = WEAPON_ATTACHMENTS[this.selectedWeapon] ?? {};
    const loadout = this.getLoadout();
    const slots = Object.values(AttachmentSlot);

    for (const slot of slots) {
      const attachIds = available[slot];
      if (!attachIds || attachIds.length === 0) continue;

      const row = document.createElement('div');
      row.className = 'deploy-detail-attach-row';

      const label = document.createElement('div');
      label.className = 'deploy-detail-attach-label';
      label.textContent = slot.toUpperCase();
      row.appendChild(label);

      for (const attachId of attachIds) {
        const def = ATTACHMENTS[attachId];
        if (!def) continue;
        const btn = document.createElement('div');
        const isSelected = loadout[slot] === attachId;
        btn.className = 'deploy-detail-attach-btn' + (isSelected ? ' selected' : '');
        btn.textContent = def.name;
        btn.title = def.description;
        btn.addEventListener('click', () => {
          this.toggleAttachment(slot, attachId);
          this.updateSlotDetail();
        });
        row.appendChild(btn);
      }

      container.appendChild(row);
    }

    // Stats preview
    const base = WEAPONS[this.selectedWeapon];
    const hasAttachments = Object.keys(loadout).length > 0;
    if (hasAttachments) {
      const modded = applyAttachments(base, loadout);
      const statsDiv = document.createElement('div');
      statsDiv.className = 'deploy-detail-stats';

      const stat = (label: string, baseVal: number, modVal: number, unit = '', lower = false) => {
        const changed = Math.abs(modVal - baseVal) > 0.001;
        if (!changed) return `<span style="color:#666">${label}: ${modVal.toFixed(1)}${unit}</span>`;
        const better = lower ? modVal < baseVal : modVal > baseVal;
        const color = better ? '#4caf50' : '#ef5350';
        return `<span style="color:${color}">${label}: ${baseVal.toFixed(1)} → ${modVal.toFixed(1)}${unit}</span>`;
      };

      statsDiv.innerHTML = [
        stat('DMG', base.damage, modded.damage),
        stat('MAG', base.magSize, modded.magSize),
        stat('SPREAD', base.spread, modded.spread, '', true),
        stat('RECOIL', base.recoilKick, modded.recoilKick, '', true),
        stat('RELOAD', base.reloadTime, modded.reloadTime, 's', true),
      ].join(' ');
      container.appendChild(statsDiv);
    }

    this.slotDetailContainer.appendChild(container);
  }

  private buildGrenadeDetail(): void {
    const container = document.createElement('div');
    container.className = 'deploy-detail-inner';

    const row = document.createElement('div');
    row.className = 'deploy-detail-row';

    const grenades = ['Frag Grenade', 'Smoke Grenade'];
    for (let i = 0; i < grenades.length; i++) {
      const btn = document.createElement('div');
      btn.className = 'deploy-detail-btn' + (this.selectedGrenadeIdx === i ? ' selected' : '');
      btn.textContent = grenades[i];
      btn.addEventListener('click', () => {
        this.selectedGrenadeIdx = i;
        this.updateSlotBar();
        this.updateSlotDetail();
      });
      row.appendChild(btn);
    }

    container.appendChild(row);
    this.slotDetailContainer.appendChild(container);
  }

  private buildGadgetDetail(cls: ClassDef): void {
    const container = document.createElement('div');
    container.className = 'deploy-detail-inner';

    const row = document.createElement('div');
    row.className = 'deploy-detail-row';

    for (let i = 0; i < cls.gadgets.length; i++) {
      const btn = document.createElement('div');
      btn.className = 'deploy-detail-btn' + (this.selectedGadgetIdx === i ? ' selected' : '');
      btn.textContent = this.gadgetDisplayName(cls.gadgets[i]);
      btn.addEventListener('click', () => {
        this.selectedGadgetIdx = i;
        this.updateSlotBar();
        this.updateSlotDetail();
      });
      row.appendChild(btn);
    }

    container.appendChild(row);
    this.slotDetailContainer.appendChild(container);
  }

  // ── Loadout helpers ────────────────────────────────────────────

  private getLoadout(): WeaponLoadout {
    return this.loadouts.get(this.selectedWeapon) ?? {};
  }

  private toggleAttachment(slot: AttachmentSlot, attachId: AttachmentId): void {
    const loadout = { ...this.getLoadout() };
    if (loadout[slot] === attachId) {
      delete loadout[slot];
    } else {
      loadout[slot] = attachId;
    }
    this.loadouts.set(this.selectedWeapon, loadout);
  }

  // ── Map Rendering ──────────────────────────────────────────────

  private renderMap(
    chunks: Map<string, Uint8Array>,
    playerDots: Array<{ position: Vec3; team: number; alive: boolean }>,
  ): void {
    const ctx = this.mapCtx;
    const w = this.mapCanvas.width;
    const h = this.mapCanvas.height;

    // Compute world bounds from chunk keys
    const chunkKeysStr = [...chunks.keys()].sort().join('|');
    const hasChunks = chunks.size > 0;

    if (hasChunks) {
      this.renderHeightmap(ctx, w, h, chunks, chunkKeysStr);
    } else {
      // Fallback: dark green + grid
      ctx.fillStyle = '#1a2a1a';
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = 'rgba(255,255,255,0.06)';
      ctx.lineWidth = 1;
      for (let i = 0; i <= 10; i++) {
        const x = (i / 10) * w;
        const y = (i / 10) * h;
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
      }
    }

    // Calculate bounds from all relevant points
    if (hasChunks) {
      // Bounds from chunk keys (world extents)
      let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
      for (const key of chunks.keys()) {
        const [cx, , cz] = key.split(',').map(Number);
        const wx = cx * CHUNK_SIZE;
        const wz = cz * CHUNK_SIZE;
        if (wx < minX) minX = wx;
        if (wx + CHUNK_SIZE > maxX) maxX = wx + CHUNK_SIZE;
        if (wz < minZ) minZ = wz;
        if (wz + CHUNK_SIZE > maxZ) maxZ = wz + CHUNK_SIZE;
      }
      this.mapMinX = minX;
      this.mapMaxX = maxX;
      this.mapMinZ = minZ;
      this.mapMaxZ = maxZ;
    } else {
      // Bounds from spawn/capture points
      const allPoints = [
        ...this.spawns.map(s => s.position),
        ...this.capturePoints.map(cp => cp.position),
      ];
      if (allPoints.length === 0) return;
      let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
      for (const p of allPoints) {
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.z < minZ) minZ = p.z;
        if (p.z > maxZ) maxZ = p.z;
      }
      const pad = 20;
      this.mapMinX = minX - pad;
      this.mapMaxX = maxX + pad;
      this.mapMinZ = minZ - pad;
      this.mapMaxZ = maxZ + pad;
    }

    const margin = this.mapMargin;

    // Draw capture points
    for (const cp of this.capturePoints) {
      const [sx, sy] = this.worldToScreen(cp.position.x, cp.position.z, w, h);
      ctx.beginPath();
      ctx.arc(sx, sy, 14, 0, Math.PI * 2);
      ctx.fillStyle = cp.owner === 0 ? 'rgba(66,133,244,0.35)' : cp.owner === 1 ? 'rgba(234,67,53,0.35)' : 'rgba(128,128,128,0.3)';
      ctx.fill();
      ctx.strokeStyle = cp.owner === 0 ? '#4285f4' : cp.owner === 1 ? '#ea4335' : '#888';
      ctx.lineWidth = 2;
      ctx.stroke();

      ctx.fillStyle = '#fff';
      ctx.font = 'bold 11px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(cp.id.toUpperCase(), sx, sy + 4);
    }

    // Draw player dots
    for (const dot of playerDots) {
      const [sx, sy] = this.worldToScreen(dot.position.x, dot.position.z, w, h);
      ctx.beginPath();
      ctx.arc(sx, sy, dot.alive ? 3 : 2, 0, Math.PI * 2);
      if (!dot.alive) {
        ctx.fillStyle = 'rgba(128,128,128,0.5)';
      } else if (dot.team === this.team) {
        ctx.fillStyle = '#4285f4';
      } else {
        ctx.fillStyle = '#ea4335';
      }
      ctx.fill();
    }

    // Draw spawn markers
    for (const spawn of this.spawns) {
      const [sx, sy] = this.worldToScreen(spawn.position.x, spawn.position.z, w, h);
      const isSelected = spawn.id === this.selectedSpawn;
      const size = isSelected ? 10 : 7;

      // Glow for selected
      if (isSelected) {
        ctx.beginPath();
        ctx.arc(sx, sy, 18, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(76,175,80,0.3)';
        ctx.fill();
      }

      // Marker shape
      ctx.beginPath();
      if (spawn.type === 'base') {
        ctx.rect(sx - size, sy - size, size * 2, size * 2);
      } else {
        ctx.moveTo(sx, sy - size);
        ctx.lineTo(sx + size, sy);
        ctx.lineTo(sx, sy + size);
        ctx.lineTo(sx - size, sy);
        ctx.closePath();
      }
      ctx.fillStyle = isSelected ? '#4caf50' : (this.team === 0 ? '#4285f4' : '#ea4335');
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = isSelected ? 2 : 1;
      ctx.stroke();

      // Label
      ctx.fillStyle = isSelected ? '#4caf50' : '#ccc';
      ctx.font = `${isSelected ? 'bold ' : ''}11px monospace`;
      ctx.textAlign = 'center';
      ctx.fillText(spawn.name, sx, sy - size - 6);
    }
  }

  private renderHeightmap(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    chunks: Map<string, Uint8Array>,
    chunkKeysStr: string,
  ): void {
    // Use cached heightmap if chunks haven't changed
    if (this.cachedHeightmap && this.cachedChunkKeys === chunkKeysStr) {
      ctx.putImageData(this.cachedHeightmap, 0, 0);
      return;
    }

    // Compute world bounds from chunk keys
    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;
    let minZ = Infinity, maxZ = -Infinity;
    for (const key of chunks.keys()) {
      const [cx, cy, cz] = key.split(',').map(Number);
      const wx = cx * CHUNK_SIZE;
      const wy = cy * CHUNK_SIZE;
      const wz = cz * CHUNK_SIZE;
      if (wx < minX) minX = wx;
      if (wx + CHUNK_SIZE > maxX) maxX = wx + CHUNK_SIZE;
      if (wy < minY) minY = wy;
      if (wy + CHUNK_SIZE > maxY) maxY = wy + CHUNK_SIZE;
      if (wz < minZ) minZ = wz;
      if (wz + CHUNK_SIZE > maxZ) maxZ = wz + CHUNK_SIZE;
    }

    const rangeX = maxX - minX || 1;
    const rangeZ = maxZ - minZ || 1;
    const rangeY = maxY - minY || 1;

    const imgData = ctx.createImageData(w, h);
    const data = imgData.data;

    // Sample step — skip pixels for performance on large maps
    const step = Math.max(1, Math.floor(Math.max(rangeX, rangeZ) / w));

    for (let py = 0; py < h; py++) {
      for (let px = 0; px < w; px++) {
        // Map pixel to world X/Z
        const wx = minX + (px / w) * rangeX;
        const wz = minZ + (py / h) * rangeZ;

        // Scan downward from top to find topmost solid voxel
        let found = false;
        for (let wy = maxY - 1; wy >= minY; wy -= step) {
          const mat = getVoxel(chunks, Math.floor(wx), Math.floor(wy), Math.floor(wz));
          if (mat !== 0) {
            // Get palette color
            const hex = MATERIAL_COLORS[mat] ?? 0x888888;
            let r = (hex >> 16) & 0xff;
            let g = (hex >> 8) & 0xff;
            let b = hex & 0xff;

            // Height-based brightness adjustment
            const heightT = (wy - minY) / rangeY;
            const brightness = 0.5 + heightT * 0.5;
            r = Math.min(255, Math.floor(r * brightness));
            g = Math.min(255, Math.floor(g * brightness));
            b = Math.min(255, Math.floor(b * brightness));

            const idx = (py * w + px) * 4;
            data[idx] = r;
            data[idx + 1] = g;
            data[idx + 2] = b;
            data[idx + 3] = 255;
            found = true;
            break;
          }
        }

        if (!found) {
          // Empty space — dark background
          const idx = (py * w + px) * 4;
          data[idx] = 15;
          data[idx + 1] = 20;
          data[idx + 2] = 15;
          data[idx + 3] = 255;
        }
      }
    }

    ctx.putImageData(imgData, 0, 0);

    // Cache for subsequent renders
    this.cachedHeightmap = imgData;
    this.cachedChunkKeys = chunkKeysStr;
  }

  private worldToScreen(wx: number, wz: number, canvasW: number, canvasH: number): [number, number] {
    const rangeX = this.mapMaxX - this.mapMinX || 1;
    const rangeZ = this.mapMaxZ - this.mapMinZ || 1;
    return [
      (wx - this.mapMinX) / rangeX * canvasW,
      (wz - this.mapMinZ) / rangeZ * canvasH,
    ];
  }

  private handleMapClick(e: MouseEvent): void {
    const rect = this.mapCanvas.getBoundingClientRect();
    const px = (e.clientX - rect.left) / rect.width * this.mapCanvas.width;
    const py = (e.clientY - rect.top) / rect.height * this.mapCanvas.height;

    // Inverse-map pixel to world coords
    const rangeX = this.mapMaxX - this.mapMinX || 1;
    const rangeZ = this.mapMaxZ - this.mapMinZ || 1;
    const worldX = this.mapMinX + (px / this.mapCanvas.width) * rangeX;
    const worldZ = this.mapMinZ + (py / this.mapCanvas.height) * rangeZ;

    // Find nearest spawn point
    let nearest: SpawnPointOption | null = null;
    let nearestDist = Infinity;
    for (const spawn of this.spawns) {
      const dx = spawn.position.x - worldX;
      const dz = spawn.position.z - worldZ;
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist < nearestDist) {
        nearestDist = dist;
        nearest = spawn;
      }
    }

    // Select if within reasonable click distance (20% of map range)
    const clickThreshold = Math.max(rangeX, rangeZ) * 0.15;
    if (nearest && nearestDist < clickThreshold) {
      this.selectedSpawn = nearest.id;
      // Re-render map overlays (need chunks + playerDots which we don't store — re-render without heightmap)
      // Since we cached the heightmap, just re-call renderMap with empty arrays
      // Actually, we need to re-render. Store chunks/playerDots reference.
      this.renderMapOverlays();
    }
  }

  /** Re-render just the overlays (spawn markers, capture points) on top of cached heightmap */
  private renderMapOverlays(): void {
    const ctx = this.mapCtx;
    const w = this.mapCanvas.width;
    const h = this.mapCanvas.height;

    // Restore cached heightmap
    if (this.cachedHeightmap) {
      ctx.putImageData(this.cachedHeightmap, 0, 0);
    } else {
      ctx.fillStyle = '#1a2a1a';
      ctx.fillRect(0, 0, w, h);
    }

    // Redraw capture points
    for (const cp of this.capturePoints) {
      const [sx, sy] = this.worldToScreen(cp.position.x, cp.position.z, w, h);
      ctx.beginPath();
      ctx.arc(sx, sy, 14, 0, Math.PI * 2);
      ctx.fillStyle = cp.owner === 0 ? 'rgba(66,133,244,0.35)' : cp.owner === 1 ? 'rgba(234,67,53,0.35)' : 'rgba(128,128,128,0.3)';
      ctx.fill();
      ctx.strokeStyle = cp.owner === 0 ? '#4285f4' : cp.owner === 1 ? '#ea4335' : '#888';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 11px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(cp.id.toUpperCase(), sx, sy + 4);
    }

    // Redraw spawn markers
    for (const spawn of this.spawns) {
      const [sx, sy] = this.worldToScreen(spawn.position.x, spawn.position.z, w, h);
      const isSelected = spawn.id === this.selectedSpawn;
      const size = isSelected ? 10 : 7;

      if (isSelected) {
        ctx.beginPath();
        ctx.arc(sx, sy, 18, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(76,175,80,0.3)';
        ctx.fill();
      }

      ctx.beginPath();
      if (spawn.type === 'base') {
        ctx.rect(sx - size, sy - size, size * 2, size * 2);
      } else {
        ctx.moveTo(sx, sy - size);
        ctx.lineTo(sx + size, sy);
        ctx.lineTo(sx, sy + size);
        ctx.lineTo(sx - size, sy);
        ctx.closePath();
      }
      ctx.fillStyle = isSelected ? '#4caf50' : (this.team === 0 ? '#4285f4' : '#ea4335');
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = isSelected ? 2 : 1;
      ctx.stroke();

      ctx.fillStyle = isSelected ? '#4caf50' : '#ccc';
      ctx.font = `${isSelected ? 'bold ' : ''}11px monospace`;
      ctx.textAlign = 'center';
      ctx.fillText(spawn.name, sx, sy - size - 6);
    }
  }

  // ── Styles ─────────────────────────────────────────────────────

  private injectStyles(): void {
    if (document.getElementById('deploy-styles')) return;
    const style = document.createElement('style');
    style.id = 'deploy-styles';
    style.textContent = /* css */ `
      .deploy-root {
        position: fixed;
        inset: 0;
        z-index: 200;
        font-family: monospace;
        color: #e0e0e0;
      }
      .deploy-overlay {
        width: 100%;
        height: 100%;
        background: rgba(10, 15, 20, 0.92);
        display: flex;
        align-items: center;
        justify-content: center;
        backdrop-filter: blur(4px);
      }
      .deploy-panel {
        display: flex;
        flex-direction: column;
        max-width: 700px;
        width: 90%;
        max-height: 90vh;
        gap: 12px;
      }
      .deploy-map {
        width: 100%;
        aspect-ratio: 1;
        border: 1px solid rgba(255,255,255,0.15);
        border-radius: 4px;
        cursor: crosshair;
        max-height: 55vh;
        object-fit: contain;
      }
      .deploy-bottom {
        display: flex;
        flex-direction: column;
        gap: 10px;
      }

      /* ── Class Tabs ── */
      .deploy-class-tabs {
        display: flex;
        gap: 6px;
      }
      .deploy-tab {
        flex: 1;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        padding: 8px 10px;
        background: rgba(255,255,255,0.06);
        border: 1px solid rgba(255,255,255,0.12);
        border-radius: 20px;
        cursor: pointer;
        font-size: 12px;
        font-weight: bold;
        letter-spacing: 1px;
        transition: all 0.15s;
        pointer-events: auto;
      }
      .deploy-tab:hover {
        background: rgba(255,255,255,0.1);
        border-color: rgba(255,255,255,0.25);
      }
      .deploy-tab.selected {
        background: rgba(76,175,80,0.2);
        border-color: #4caf50;
        color: #4caf50;
      }
      .deploy-tab-icon {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 22px;
        height: 22px;
        border-radius: 50%;
        background: rgba(255,255,255,0.1);
        font-size: 11px;
        font-weight: bold;
      }
      .deploy-tab.selected .deploy-tab-icon {
        background: rgba(76,175,80,0.3);
        color: #4caf50;
      }

      /* ── 5-Slot Loadout Bar ── */
      .deploy-slot-bar {
        display: flex;
        gap: 4px;
      }
      .deploy-slot {
        flex: 1;
        padding: 8px 6px;
        background: rgba(255,255,255,0.04);
        border: 1px solid rgba(255,255,255,0.1);
        border-radius: 4px;
        text-align: center;
        transition: all 0.15s;
        pointer-events: auto;
      }
      .deploy-slot:hover {
        background: rgba(255,255,255,0.08);
        border-color: rgba(255,255,255,0.2);
      }
      .deploy-slot.selected {
        background: rgba(66,133,244,0.15);
        border-color: #4285f4;
      }
      .deploy-slot-label {
        font-size: 9px;
        font-weight: bold;
        letter-spacing: 1px;
        color: #888;
        margin-bottom: 2px;
      }
      .deploy-slot-value {
        font-size: 12px;
        color: #ddd;
        font-weight: bold;
      }

      /* ── Slot Detail Panel ── */
      .deploy-slot-detail {
        min-height: 0;
      }
      .deploy-detail-inner {
        background: rgba(255,255,255,0.03);
        border: 1px solid rgba(255,255,255,0.08);
        border-radius: 4px;
        padding: 10px;
        display: flex;
        flex-direction: column;
        gap: 8px;
      }
      .deploy-detail-row {
        display: flex;
        gap: 6px;
      }
      .deploy-detail-btn {
        flex: 1;
        padding: 8px 10px;
        background: rgba(255,255,255,0.05);
        border: 1px solid rgba(255,255,255,0.12);
        border-radius: 4px;
        cursor: pointer;
        font-size: 12px;
        color: #ccc;
        text-align: center;
        transition: all 0.15s;
        pointer-events: auto;
      }
      .deploy-detail-btn:hover {
        background: rgba(255,255,255,0.1);
      }
      .deploy-detail-btn.selected {
        background: rgba(66,133,244,0.2);
        border-color: #4285f4;
        color: #fff;
      }
      .deploy-detail-attach-row {
        display: flex;
        align-items: center;
        gap: 6px;
      }
      .deploy-detail-attach-label {
        font-size: 9px;
        font-weight: bold;
        color: #666;
        letter-spacing: 1px;
        width: 55px;
        flex-shrink: 0;
      }
      .deploy-detail-attach-btn {
        padding: 4px 8px;
        background: rgba(255,255,255,0.05);
        border: 1px solid rgba(255,255,255,0.1);
        border-radius: 3px;
        cursor: pointer;
        font-size: 10px;
        color: #aaa;
        transition: all 0.15s;
        pointer-events: auto;
        white-space: nowrap;
      }
      .deploy-detail-attach-btn:hover {
        background: rgba(255,255,255,0.1);
        color: #ddd;
      }
      .deploy-detail-attach-btn.selected {
        background: rgba(255,170,0,0.2);
        border-color: #ffaa00;
        color: #ffaa00;
      }
      .deploy-detail-stats {
        display: flex;
        flex-wrap: wrap;
        gap: 6px 12px;
        font-size: 10px;
      }

      /* ── Deploy Button ── */
      .deploy-btn {
        padding: 14px 0;
        background: #4caf50;
        border: none;
        border-radius: 6px;
        color: #fff;
        font-family: monospace;
        font-size: 18px;
        font-weight: bold;
        letter-spacing: 3px;
        cursor: pointer;
        transition: background 0.15s;
        pointer-events: auto;
        align-self: stretch;
      }
      .deploy-btn:hover {
        background: #66bb6a;
      }
      .deploy-btn:active {
        background: #388e3c;
      }
    `;
    document.head.appendChild(style);
  }

  dispose(): void {
    this.root.remove();
    const style = document.getElementById('deploy-styles');
    if (style) style.remove();
  }
}
