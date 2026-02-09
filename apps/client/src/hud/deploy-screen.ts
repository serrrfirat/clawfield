import type { SpawnPointOption, CapturePointState, WeaponLoadout } from '@clawfield/shared';
import { ClassId, CLASSES, WEAPONS, type WeaponId, AttachmentSlot, WEAPON_ATTACHMENTS, ATTACHMENTS, type AttachmentId, applyAttachments } from '@clawfield/shared';

export interface DeployChoice {
  classId: string;
  weaponId: string;
  spawnPointId: string;
  loadout: WeaponLoadout;
}

/**
 * Battlefield-style deploy screen.
 * Left: spawn map with clickable markers.
 * Right: class cards with weapon selection.
 */
export class DeployScreen {
  private root: HTMLDivElement;
  private mapCanvas: HTMLCanvasElement;
  private mapCtx: CanvasRenderingContext2D;
  private classCardsContainer: HTMLDivElement;
  private weaponToggle: HTMLDivElement;
  private attachmentContainer: HTMLDivElement;
  private weaponStatsPreview: HTMLDivElement;
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

  constructor() {
    this.selectedWeapon = CLASSES[ClassId.Assault].defaultPrimary;
    this.root = document.createElement('div');
    this.root.className = 'deploy-root';
    this.root.innerHTML = `
      <div class="deploy-overlay">
        <div class="deploy-container">
          <div class="deploy-left">
            <div class="deploy-section-title">SELECT SPAWN</div>
            <canvas class="deploy-map" width="400" height="400"></canvas>
            <div class="deploy-spawn-list"></div>
          </div>
          <div class="deploy-right">
            <div class="deploy-section-title">SELECT CLASS</div>
            <div class="deploy-class-cards"></div>
            <div class="deploy-section-title deploy-weapon-title">SELECT WEAPON</div>
            <div class="deploy-weapon-toggle"></div>
            <div class="deploy-section-title deploy-attach-title">ATTACHMENTS</div>
            <div class="deploy-attachment-container"></div>
            <div class="deploy-weapon-stats-preview"></div>
            <button class="deploy-btn">DEPLOY</button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(this.root);

    this.mapCanvas = this.root.querySelector('.deploy-map')!;
    this.mapCtx = this.mapCanvas.getContext('2d')!;
    this.classCardsContainer = this.root.querySelector('.deploy-class-cards')!;
    this.weaponToggle = this.root.querySelector('.deploy-weapon-toggle')!;
    this.attachmentContainer = this.root.querySelector('.deploy-attachment-container')!;
    this.weaponStatsPreview = this.root.querySelector('.deploy-weapon-stats-preview')!;
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

    this.buildClassCards();
    this.injectStyles();
    this.hide();
  }

  show(
    spawns: SpawnPointOption[],
    team: number,
    capturePoints: CapturePointState[],
    onDeploy: (choice: DeployChoice) => void,
  ): void {
    this.spawns = spawns;
    this.team = team;
    this.capturePoints = capturePoints;
    this.onDeploy = onDeploy;
    this.selectedSpawn = spawns.length > 0 ? spawns[0].id : 'base';
    this.visible = true;
    this.root.style.display = '';
    this.buildSpawnList();
    this.renderMap();
    this.updateWeaponToggle();
    this.updateAttachmentPicker();
  }

  hide(): void {
    this.visible = false;
    this.root.style.display = 'none';
    this.onDeploy = null;
  }

  isVisible(): boolean {
    return this.visible;
  }

  private buildClassCards(): void {
    this.classCardsContainer.innerHTML = '';
    const classes = Object.values(CLASSES);
    for (const cls of classes) {
      const card = document.createElement('div');
      card.className = 'deploy-class-card' + (cls.id === this.selectedClass ? ' selected' : '');
      card.dataset.classId = cls.id;

      const wpn1 = WEAPONS[cls.defaultPrimary];
      const wpn2 = WEAPONS[cls.altPrimary];

      card.innerHTML = `
        <div class="deploy-class-name">${cls.name}</div>
        <div class="deploy-class-ability">${cls.abilityName}</div>
        <div class="deploy-class-weapons">${wpn1.name} / ${wpn2.name}</div>
        <div class="deploy-class-stats">
          <span>HP: ${cls.maxHealth}</span>
          <span>CD: ${cls.abilityCooldown}s</span>
        </div>
      `;

      card.addEventListener('click', () => {
        this.selectedClass = cls.id;
        this.selectedWeapon = cls.defaultPrimary;
        this.updateClassSelection();
        this.updateWeaponToggle();
        this.updateAttachmentPicker();
      });

      this.classCardsContainer.appendChild(card);
    }
  }

  private updateClassSelection(): void {
    const cards = this.classCardsContainer.querySelectorAll('.deploy-class-card');
    cards.forEach((card) => {
      const el = card as HTMLDivElement;
      el.classList.toggle('selected', el.dataset.classId === this.selectedClass);
    });
  }

  private updateWeaponToggle(): void {
    const cls = CLASSES[this.selectedClass];
    const wpn1 = WEAPONS[cls.defaultPrimary];
    const wpn2 = WEAPONS[cls.altPrimary];

    this.weaponToggle.innerHTML = '';

    const makeBtn = (weapon: typeof wpn1, weaponId: WeaponId) => {
      const btn = document.createElement('div');
      btn.className = 'deploy-weapon-btn' + (this.selectedWeapon === weaponId ? ' selected' : '');
      btn.innerHTML = `
        <div class="deploy-weapon-name">${weapon.name}</div>
        <div class="deploy-weapon-stats">
          DMG: ${weapon.damage} &middot; RPM: ${weapon.rpm} &middot; MAG: ${weapon.magSize} &middot; RNG: ${weapon.maxRange}m
        </div>
      `;
      btn.addEventListener('click', () => {
        this.selectedWeapon = weaponId;
        this.updateWeaponToggle();
        this.updateAttachmentPicker();
      });
      return btn;
    };

    this.weaponToggle.appendChild(makeBtn(wpn1, cls.defaultPrimary));
    this.weaponToggle.appendChild(makeBtn(wpn2, cls.altPrimary));
  }

  private buildSpawnList(): void {
    const list = this.root.querySelector('.deploy-spawn-list')!;
    list.innerHTML = '';
    for (const spawn of this.spawns) {
      const btn = document.createElement('div');
      btn.className = 'deploy-spawn-btn' + (spawn.id === this.selectedSpawn ? ' selected' : '');
      btn.textContent = spawn.name;
      btn.addEventListener('click', () => {
        this.selectedSpawn = spawn.id;
        this.buildSpawnList();
        this.renderMap();
      });
      list.appendChild(btn);
    }
  }

  private renderMap(): void {
    const ctx = this.mapCtx;
    const w = this.mapCanvas.width;
    const h = this.mapCanvas.height;

    // Background
    ctx.fillStyle = '#1a2a1a';
    ctx.fillRect(0, 0, w, h);

    // Grid lines
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 10; i++) {
      const x = (i / 10) * w;
      const y = (i / 10) * h;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
    }

    // Calculate bounds from all points
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
    minX -= pad; maxX += pad; minZ -= pad; maxZ += pad;
    const rangeX = maxX - minX || 1;
    const rangeZ = maxZ - minZ || 1;
    const margin = 30;

    const toScreen = (px: number, pz: number): [number, number] => {
      return [
        margin + ((px - minX) / rangeX) * (w - margin * 2),
        margin + ((pz - minZ) / rangeZ) * (h - margin * 2),
      ];
    };

    // Draw capture points
    for (const cp of this.capturePoints) {
      const [sx, sy] = toScreen(cp.position.x, cp.position.z);
      ctx.beginPath();
      ctx.arc(sx, sy, 12, 0, Math.PI * 2);
      ctx.fillStyle = cp.owner === 0 ? 'rgba(66,133,244,0.3)' : cp.owner === 1 ? 'rgba(234,67,53,0.3)' : 'rgba(128,128,128,0.3)';
      ctx.fill();
      ctx.strokeStyle = cp.owner === 0 ? '#4285f4' : cp.owner === 1 ? '#ea4335' : '#888';
      ctx.lineWidth = 2;
      ctx.stroke();

      ctx.fillStyle = '#fff';
      ctx.font = 'bold 10px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(cp.id.toUpperCase(), sx, sy + 3);
    }

    // Draw spawn markers
    for (const spawn of this.spawns) {
      const [sx, sy] = toScreen(spawn.position.x, spawn.position.z);
      const isSelected = spawn.id === this.selectedSpawn;
      const size = isSelected ? 10 : 7;

      // Glow for selected
      if (isSelected) {
        ctx.beginPath();
        ctx.arc(sx, sy, 16, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(76,175,80,0.25)';
        ctx.fill();
      }

      // Marker
      ctx.beginPath();
      if (spawn.type === 'base') {
        // Square for base
        ctx.rect(sx - size, sy - size, size * 2, size * 2);
      } else {
        // Diamond for flag
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

  /** Get the current loadout for the selected weapon */
  private getLoadout(): WeaponLoadout {
    return this.loadouts.get(this.selectedWeapon) ?? {};
  }

  /** Toggle an attachment on/off for the current weapon */
  private toggleAttachment(slot: AttachmentSlot, attachId: AttachmentId): void {
    const loadout = { ...this.getLoadout() };
    if (loadout[slot] === attachId) {
      delete loadout[slot];
    } else {
      loadout[slot] = attachId;
    }
    this.loadouts.set(this.selectedWeapon, loadout);
    this.updateAttachmentPicker();
  }

  /** Build the attachment picker UI for the selected weapon */
  private updateAttachmentPicker(): void {
    this.attachmentContainer.innerHTML = '';
    const available = WEAPON_ATTACHMENTS[this.selectedWeapon] ?? {};
    const loadout = this.getLoadout();
    const slots = Object.values(AttachmentSlot);

    for (const slot of slots) {
      const attachIds = available[slot];
      if (!attachIds || attachIds.length === 0) continue;

      const row = document.createElement('div');
      row.className = 'deploy-attach-row';

      const label = document.createElement('div');
      label.className = 'deploy-attach-slot-label';
      label.textContent = slot.toUpperCase();
      row.appendChild(label);

      const options = document.createElement('div');
      options.className = 'deploy-attach-options';

      for (const attachId of attachIds) {
        const def = ATTACHMENTS[attachId];
        if (!def) continue;

        const btn = document.createElement('div');
        const isSelected = loadout[slot] === attachId;
        btn.className = 'deploy-attach-btn' + (isSelected ? ' selected' : '');
        btn.textContent = def.name;
        btn.title = def.description;
        btn.addEventListener('click', () => this.toggleAttachment(slot, attachId));
        options.appendChild(btn);
      }

      row.appendChild(options);
      this.attachmentContainer.appendChild(row);
    }

    this.updateStatsPreview();
  }

  /** Show a compact stat comparison (base vs modified) */
  private updateStatsPreview(): void {
    const base = WEAPONS[this.selectedWeapon];
    const loadout = this.getLoadout();
    const hasAttachments = Object.keys(loadout).length > 0;

    if (!hasAttachments) {
      this.weaponStatsPreview.innerHTML = '';
      return;
    }

    const modded = applyAttachments(base, loadout);

    const stat = (label: string, baseVal: number, modVal: number, unit = '', lower = false) => {
      const changed = Math.abs(modVal - baseVal) > 0.001;
      if (!changed) return `<span class="deploy-stat-neutral">${label}: ${modVal.toFixed(1)}${unit}</span>`;
      const better = lower ? modVal < baseVal : modVal > baseVal;
      const cls = better ? 'deploy-stat-better' : 'deploy-stat-worse';
      return `<span class="${cls}">${label}: ${baseVal.toFixed(1)} → ${modVal.toFixed(1)}${unit}</span>`;
    };

    this.weaponStatsPreview.innerHTML = [
      stat('DMG', base.damage, modded.damage, ''),
      stat('MAG', base.magSize, modded.magSize, ''),
      stat('SPREAD', base.spread, modded.spread, '', true),
      stat('RECOIL', base.recoilKick, modded.recoilKick, '', true),
      stat('ADS', base.adsSpeed, modded.adsSpeed, ''),
      stat('RELOAD', base.reloadTime, modded.reloadTime, 's', true),
      stat('RANGE', base.maxRange, modded.maxRange, 'm'),
    ].join('');
  }

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
        background: rgba(0, 0, 0, 0.75);
        display: flex;
        align-items: center;
        justify-content: center;
        backdrop-filter: blur(4px);
      }
      .deploy-container {
        display: flex;
        gap: 24px;
        max-width: 900px;
        width: 90%;
        max-height: 85vh;
      }
      .deploy-left, .deploy-right {
        flex: 1;
        display: flex;
        flex-direction: column;
        gap: 10px;
        overflow-y: auto;
      }
      .deploy-section-title {
        font-size: 13px;
        font-weight: bold;
        letter-spacing: 2px;
        color: #888;
        border-bottom: 1px solid rgba(255,255,255,0.1);
        padding-bottom: 6px;
      }
      .deploy-weapon-title {
        margin-top: 8px;
      }
      .deploy-map {
        width: 100%;
        aspect-ratio: 1;
        border: 1px solid rgba(255,255,255,0.15);
        border-radius: 4px;
        cursor: pointer;
      }
      .deploy-spawn-list {
        display: flex;
        gap: 6px;
        flex-wrap: wrap;
      }
      .deploy-spawn-btn {
        padding: 6px 14px;
        background: rgba(255,255,255,0.07);
        border: 1px solid rgba(255,255,255,0.15);
        border-radius: 4px;
        cursor: pointer;
        font-size: 12px;
        transition: all 0.15s;
        pointer-events: auto;
      }
      .deploy-spawn-btn:hover {
        background: rgba(255,255,255,0.12);
      }
      .deploy-spawn-btn.selected {
        background: rgba(76,175,80,0.25);
        border-color: #4caf50;
        color: #4caf50;
      }
      .deploy-class-cards {
        display: flex;
        flex-direction: column;
        gap: 8px;
      }
      .deploy-class-card {
        padding: 10px 14px;
        background: rgba(255,255,255,0.05);
        border: 1px solid rgba(255,255,255,0.12);
        border-radius: 6px;
        cursor: pointer;
        transition: all 0.15s;
        pointer-events: auto;
      }
      .deploy-class-card:hover {
        background: rgba(255,255,255,0.1);
        border-color: rgba(255,255,255,0.25);
      }
      .deploy-class-card.selected {
        background: rgba(76,175,80,0.15);
        border-color: #4caf50;
      }
      .deploy-class-name {
        font-size: 16px;
        font-weight: bold;
        color: #fff;
      }
      .deploy-class-ability {
        font-size: 11px;
        color: #aaa;
        margin-top: 2px;
      }
      .deploy-class-weapons {
        font-size: 11px;
        color: #888;
        margin-top: 4px;
      }
      .deploy-class-stats {
        display: flex;
        gap: 12px;
        font-size: 10px;
        color: #666;
        margin-top: 4px;
      }
      .deploy-weapon-toggle {
        display: flex;
        gap: 8px;
      }
      .deploy-weapon-btn {
        flex: 1;
        padding: 10px 12px;
        background: rgba(255,255,255,0.05);
        border: 1px solid rgba(255,255,255,0.12);
        border-radius: 6px;
        cursor: pointer;
        transition: all 0.15s;
        pointer-events: auto;
      }
      .deploy-weapon-btn:hover {
        background: rgba(255,255,255,0.1);
      }
      .deploy-weapon-btn.selected {
        background: rgba(66,133,244,0.2);
        border-color: #4285f4;
      }
      .deploy-weapon-name {
        font-size: 14px;
        font-weight: bold;
        color: #fff;
      }
      .deploy-weapon-stats {
        font-size: 10px;
        color: #888;
        margin-top: 4px;
      }
      .deploy-attach-title {
        margin-top: 8px;
      }
      .deploy-attachment-container {
        display: flex;
        flex-direction: column;
        gap: 6px;
      }
      .deploy-attach-row {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .deploy-attach-slot-label {
        font-size: 9px;
        font-weight: bold;
        color: #666;
        letter-spacing: 1px;
        width: 60px;
        flex-shrink: 0;
      }
      .deploy-attach-options {
        display: flex;
        gap: 4px;
        flex-wrap: wrap;
      }
      .deploy-attach-btn {
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
      .deploy-attach-btn:hover {
        background: rgba(255,255,255,0.1);
        color: #ddd;
      }
      .deploy-attach-btn.selected {
        background: rgba(255,170,0,0.2);
        border-color: #ffaa00;
        color: #ffaa00;
      }
      .deploy-weapon-stats-preview {
        display: flex;
        flex-wrap: wrap;
        gap: 6px 12px;
        font-size: 10px;
        min-height: 14px;
      }
      .deploy-stat-neutral { color: #666; }
      .deploy-stat-better { color: #4caf50; }
      .deploy-stat-worse { color: #ef5350; }
      .deploy-btn {
        margin-top: 12px;
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
