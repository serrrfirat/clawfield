import type { GameMode, LobbyPlayer } from '@clawfield/shared';

export interface LobbyCallbacks {
  onSetTeam: (team: number) => void;
  onSetMode: (mode: GameMode) => void;
  onSetMap: (mapName: string) => void;
  onStartGame: () => void;
  onLeave: () => void;
}

/**
 * Lobby screen shown after creating/joining a room.
 * Displays room code, team columns, and game controls.
 */
export class LobbyScreen {
  private root: HTMLDivElement;
  private codeEl: HTMLSpanElement;
  private alphaList: HTMLDivElement;
  private bravoList: HTMLDivElement;
  private joinAlphaBtn: HTMLButtonElement;
  private joinBravoBtn: HTMLButtonElement;
  private modeSelect: HTMLSelectElement;
  private mapSelect: HTMLSelectElement;
  private mapSection: HTMLDivElement;
  private startBtn: HTMLButtonElement;
  private leaveBtn: HTMLButtonElement;
  private modeSection: HTMLDivElement;
  private callbacks: LobbyCallbacks | null = null;
  private visible = false;
  private isHost = false;
  private myId = '';

  constructor() {
    this.root = document.createElement('div');
    this.root.className = 'lobby-root';
    this.root.style.display = 'none';
    this.root.innerHTML = `
      <div class="lobby-overlay">
        <div class="lobby-container">
          <div class="lobby-header">
            <div class="lobby-title">LOBBY</div>
            <div class="lobby-code-row">
              <span class="lobby-code-label">ROOM CODE:</span>
              <span class="lobby-code"></span>
              <button class="lobby-copy-btn" title="Copy to clipboard">COPY</button>
            </div>
          </div>

          <div class="lobby-teams">
            <div class="lobby-team lobby-team-alpha">
              <div class="lobby-team-header alpha">ALPHA</div>
              <div class="lobby-team-list" data-team="alpha"></div>
              <button class="lobby-join-team-btn alpha">JOIN ALPHA</button>
            </div>
            <div class="lobby-team lobby-team-bravo">
              <div class="lobby-team-header bravo">BRAVO</div>
              <div class="lobby-team-list" data-team="bravo"></div>
              <button class="lobby-join-team-btn bravo">JOIN BRAVO</button>
            </div>
          </div>

          <div class="lobby-mode-section lobby-map-section">
            <label class="lobby-label">MAP</label>
            <select class="lobby-map-select">
            </select>
          </div>

          <div class="lobby-mode-section">
            <label class="lobby-label">GAME MODE</label>
            <select class="lobby-mode-select">
              <option value="tdm">TEAM DEATHMATCH</option>
              <option value="conquest">CONQUEST</option>
              <option value="incursion">INCURSION</option>
            </select>
          </div>

          <div class="lobby-actions">
            <button class="lobby-leave-btn">LEAVE</button>
            <button class="lobby-start-btn">START GAME</button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(this.root);

    this.codeEl = this.root.querySelector('.lobby-code')!;
    this.alphaList = this.root.querySelector('[data-team="alpha"]')!;
    this.bravoList = this.root.querySelector('[data-team="bravo"]')!;
    this.joinAlphaBtn = this.root.querySelector('.lobby-join-team-btn.alpha')!;
    this.joinBravoBtn = this.root.querySelector('.lobby-join-team-btn.bravo')!;
    this.modeSelect = this.root.querySelector('.lobby-mode-select')!;
    this.modeSection = this.root.querySelector('.lobby-mode-section:not(.lobby-map-section)')!;
    this.mapSelect = this.root.querySelector('.lobby-map-select')!;
    this.mapSection = this.root.querySelector('.lobby-map-section')!;
    this.startBtn = this.root.querySelector('.lobby-start-btn')!;
    this.leaveBtn = this.root.querySelector('.lobby-leave-btn')!;

    const copyBtn = this.root.querySelector('.lobby-copy-btn')!;
    copyBtn.addEventListener('click', () => {
      navigator.clipboard.writeText(this.codeEl.textContent ?? '');
      (copyBtn as HTMLButtonElement).textContent = 'COPIED!';
      setTimeout(() => { (copyBtn as HTMLButtonElement).textContent = 'COPY'; }, 1500);
    });

    this.joinAlphaBtn.addEventListener('click', () => this.callbacks?.onSetTeam(0));
    this.joinBravoBtn.addEventListener('click', () => this.callbacks?.onSetTeam(1));
    this.mapSelect.addEventListener('change', () => {
      this.callbacks?.onSetMap(this.mapSelect.value);
    });
    this.modeSelect.addEventListener('change', () => {
      this.callbacks?.onSetMode(this.modeSelect.value as GameMode);
    });
    this.startBtn.addEventListener('click', () => this.callbacks?.onStartGame());
    this.leaveBtn.addEventListener('click', () => this.callbacks?.onLeave());

    this.injectStyles();
  }

  show(myId: string, callbacks: LobbyCallbacks): void {
    this.myId = myId;
    this.callbacks = callbacks;
    this.visible = true;
    this.root.style.display = '';
  }

  hide(): void {
    this.visible = false;
    this.root.style.display = 'none';
    this.callbacks = null;
  }

  isVisible(): boolean {
    return this.visible;
  }

  update(
    players: LobbyPlayer[],
    gameMode: GameMode,
    hostId: string,
    roomCode: string,
    mapName?: string,
    availableMaps?: { id: string; name: string }[]
  ): void {
    this.isHost = this.myId === hostId;
    this.codeEl.textContent = roomCode;

    // Update team lists
    const alphaPlayers = players.filter(p => p.team === 0);
    const bravoPlayers = players.filter(p => p.team === 1);

    this.alphaList.innerHTML = alphaPlayers.map(p =>
      `<div class="lobby-player${p.id === this.myId ? ' me' : ''}${p.isHost ? ' host' : ''}">${p.name}${p.isHost ? ' <span class="lobby-host-badge">HOST</span>' : ''}</div>`
    ).join('');

    this.bravoList.innerHTML = bravoPlayers.map(p =>
      `<div class="lobby-player${p.id === this.myId ? ' me' : ''}${p.isHost ? ' host' : ''}">${p.name}${p.isHost ? ' <span class="lobby-host-badge">HOST</span>' : ''}</div>`
    ).join('');

    // Update map selector
    if (availableMaps && availableMaps.length > 0) {
      // Rebuild options only if the list changed (avoids flicker)
      const optionIds = Array.from(this.mapSelect.options).map(o => o.value).join(',');
      const newIds = availableMaps.map(m => m.id).join(',');
      if (optionIds !== newIds) {
        this.mapSelect.innerHTML = availableMaps
          .map(m => `<option value="${m.id}">${m.name}</option>`)
          .join('');
      }
    }
    if (mapName) {
      this.mapSelect.value = mapName;
    }
    this.mapSelect.disabled = !this.isHost;
    this.mapSection.style.opacity = this.isHost ? '1' : '0.5';

    // Update mode selector
    this.modeSelect.value = gameMode;
    this.modeSelect.disabled = !this.isHost;
    this.modeSection.style.opacity = this.isHost ? '1' : '0.5';

    // Show/hide start button
    this.startBtn.style.display = this.isHost ? '' : 'none';
  }

  private injectStyles(): void {
    if (document.getElementById('lobby-screen-styles')) return;
    const style = document.createElement('style');
    style.id = 'lobby-screen-styles';
    style.textContent = /* css */ `
      .lobby-root {
        position: fixed;
        inset: 0;
        z-index: 300;
        font-family: monospace;
        color: #e0e0e0;
      }
      .lobby-overlay {
        width: 100%;
        height: 100%;
        background: linear-gradient(135deg, #0a0f0a 0%, #1a2a1a 50%, #0a150a 100%);
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .lobby-container {
        display: flex;
        flex-direction: column;
        gap: 20px;
        max-width: 700px;
        width: 90%;
      }
      .lobby-header {
        text-align: center;
      }
      .lobby-title {
        font-size: 32px;
        font-weight: bold;
        letter-spacing: 8px;
        color: #fff;
        margin-bottom: 12px;
      }
      .lobby-code-row {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 12px;
      }
      .lobby-code-label {
        font-size: 12px;
        color: #888;
        letter-spacing: 2px;
      }
      .lobby-code {
        font-size: 36px;
        font-weight: bold;
        color: #4caf50;
        letter-spacing: 12px;
        text-shadow: 0 0 20px rgba(76, 175, 80, 0.4);
      }
      .lobby-copy-btn {
        padding: 4px 12px;
        background: rgba(255,255,255,0.08);
        border: 1px solid rgba(255,255,255,0.2);
        border-radius: 4px;
        color: #aaa;
        font-family: monospace;
        font-size: 10px;
        letter-spacing: 1px;
        cursor: pointer;
        transition: all 0.15s;
      }
      .lobby-copy-btn:hover {
        background: rgba(255,255,255,0.15);
        color: #fff;
      }
      .lobby-teams {
        display: flex;
        gap: 16px;
      }
      .lobby-team {
        flex: 1;
        background: rgba(255,255,255,0.03);
        border: 1px solid rgba(255,255,255,0.08);
        border-radius: 8px;
        padding: 16px;
        display: flex;
        flex-direction: column;
        gap: 8px;
        min-height: 200px;
      }
      .lobby-team-header {
        font-size: 16px;
        font-weight: bold;
        letter-spacing: 4px;
        text-align: center;
        padding-bottom: 8px;
        border-bottom: 1px solid rgba(255,255,255,0.08);
      }
      .lobby-team-header.alpha { color: #4fc3f7; }
      .lobby-team-header.bravo { color: #ef5350; }
      .lobby-team-list {
        flex: 1;
        display: flex;
        flex-direction: column;
        gap: 4px;
      }
      .lobby-player {
        padding: 6px 10px;
        background: rgba(255,255,255,0.04);
        border-radius: 4px;
        font-size: 13px;
        color: #ccc;
      }
      .lobby-player.me {
        color: #fff;
        background: rgba(76,175,80,0.15);
        border: 1px solid rgba(76,175,80,0.3);
      }
      .lobby-host-badge {
        font-size: 9px;
        color: #ffc107;
        letter-spacing: 1px;
        margin-left: 6px;
      }
      .lobby-join-team-btn {
        padding: 8px;
        background: rgba(255,255,255,0.06);
        border: 1px solid rgba(255,255,255,0.15);
        border-radius: 6px;
        color: #ccc;
        font-family: monospace;
        font-size: 11px;
        font-weight: bold;
        letter-spacing: 2px;
        cursor: pointer;
        transition: all 0.15s;
        text-align: center;
      }
      .lobby-join-team-btn.alpha:hover {
        background: rgba(79,195,247,0.15);
        border-color: #4fc3f7;
        color: #4fc3f7;
      }
      .lobby-join-team-btn.bravo:hover {
        background: rgba(239,83,80,0.15);
        border-color: #ef5350;
        color: #ef5350;
      }
      .lobby-mode-section {
        display: flex;
        flex-direction: column;
        gap: 6px;
        transition: opacity 0.15s;
      }
      .lobby-label {
        font-size: 11px;
        font-weight: bold;
        letter-spacing: 2px;
        color: #888;
      }
      .lobby-mode-select,
      .lobby-map-select {
        padding: 10px 14px;
        background: rgba(255,255,255,0.06);
        border: 1px solid rgba(255,255,255,0.15);
        border-radius: 6px;
        color: #fff;
        font-family: monospace;
        font-size: 14px;
        outline: none;
        cursor: pointer;
      }
      .lobby-mode-select option,
      .lobby-map-select option {
        background: #1a2a1a;
        color: #fff;
      }
      .lobby-actions {
        display: flex;
        gap: 12px;
      }
      .lobby-leave-btn {
        flex: 1;
        padding: 14px;
        background: rgba(255,255,255,0.06);
        border: 1px solid rgba(255,255,255,0.15);
        border-radius: 8px;
        color: #aaa;
        font-family: monospace;
        font-size: 16px;
        font-weight: bold;
        letter-spacing: 3px;
        cursor: pointer;
        transition: all 0.15s;
      }
      .lobby-leave-btn:hover {
        background: rgba(239,83,80,0.15);
        border-color: #ef5350;
        color: #ef5350;
      }
      .lobby-start-btn {
        flex: 2;
        padding: 14px;
        background: #4caf50;
        border: none;
        border-radius: 8px;
        color: #fff;
        font-family: monospace;
        font-size: 18px;
        font-weight: bold;
        letter-spacing: 4px;
        cursor: pointer;
        transition: all 0.15s;
      }
      .lobby-start-btn:hover {
        background: #66bb6a;
        box-shadow: 0 0 30px rgba(76, 175, 80, 0.25);
      }
      .lobby-start-btn:active {
        background: #388e3c;
      }
    `;
    document.head.appendChild(style);
  }

  dispose(): void {
    this.root.remove();
    const style = document.getElementById('lobby-screen-styles');
    if (style) style.remove();
  }
}
