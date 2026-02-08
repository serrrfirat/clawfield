import type { GameMode } from '@clawfield/shared';

export interface MainMenuChoice {
  name: string;
  gameMode: GameMode;
}

/**
 * Main menu / mode selection screen.
 * Shown before the player connects to the game.
 * Lets the player enter a name, pick TDM or Conquest, and join.
 */
export class MainMenu {
  private root: HTMLDivElement;
  private nameInput: HTMLInputElement;
  private modeCards: HTMLDivElement;
  private playBtn: HTMLButtonElement;
  private selectedMode: GameMode = 'tdm';
  private onPlay: ((choice: MainMenuChoice) => void) | null = null;
  private visible = true;

  constructor() {
    this.root = document.createElement('div');
    this.root.className = 'menu-root';
    this.root.innerHTML = `
      <div class="menu-overlay">
        <div class="menu-container">
          <div class="menu-title">CLAWFIELD</div>
          <div class="menu-subtitle">MULTIPLAYER COMBAT</div>

          <div class="menu-name-section">
            <label class="menu-label" for="menu-name-input">CALL SIGN</label>
            <input id="menu-name-input" class="menu-name-input" type="text"
              maxlength="16" placeholder="Player_${Math.floor(Math.random() * 1000)}" spellcheck="false" />
          </div>

          <div class="menu-label">SELECT GAME MODE</div>
          <div class="menu-mode-cards"></div>

          <button class="menu-play-btn">PLAY</button>
        </div>
      </div>
    `;
    document.body.appendChild(this.root);

    this.nameInput = this.root.querySelector('.menu-name-input')!;
    this.modeCards = this.root.querySelector('.menu-mode-cards')!;
    this.playBtn = this.root.querySelector('.menu-play-btn')!;

    this.buildModeCards();
    this.injectStyles();

    this.playBtn.addEventListener('click', () => this.handlePlay());
    this.nameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.handlePlay();
    });
  }

  show(onPlay: (choice: MainMenuChoice) => void): void {
    this.onPlay = onPlay;
    this.visible = true;
    this.root.style.display = '';
    this.nameInput.focus();
  }

  hide(): void {
    this.visible = false;
    this.root.style.display = 'none';
    this.onPlay = null;
  }

  isVisible(): boolean {
    return this.visible;
  }

  private handlePlay(): void {
    if (!this.onPlay) return;
    const rawName = this.nameInput.value.trim();
    const name = rawName || this.nameInput.placeholder;
    this.onPlay({ name, gameMode: this.selectedMode });
  }

  private buildModeCards(): void {
    const modes: Array<{ id: GameMode; name: string; desc: string; detail: string }> = [
      {
        id: 'tdm',
        name: 'TEAM DEATHMATCH',
        desc: 'Classic team combat. Eliminate the enemy team to drain their tickets.',
        detail: '75 tickets per team  |  First to 0 loses',
      },
      {
        id: 'conquest',
        name: 'CONQUEST',
        desc: 'Capture and hold flag objectives across the map to earn points.',
        detail: '3 capture points  |  200 point lead to win',
      },
    ];

    this.modeCards.innerHTML = '';
    for (const mode of modes) {
      const card = document.createElement('div');
      card.className = 'menu-mode-card' + (mode.id === this.selectedMode ? ' selected' : '');
      card.dataset.mode = mode.id;
      card.innerHTML = `
        <div class="menu-mode-name">${mode.name}</div>
        <div class="menu-mode-desc">${mode.desc}</div>
        <div class="menu-mode-detail">${mode.detail}</div>
      `;
      card.addEventListener('click', () => {
        this.selectedMode = mode.id;
        this.updateModeSelection();
      });
      this.modeCards.appendChild(card);
    }
  }

  private updateModeSelection(): void {
    const cards = this.modeCards.querySelectorAll('.menu-mode-card');
    cards.forEach((card) => {
      const el = card as HTMLDivElement;
      el.classList.toggle('selected', el.dataset.mode === this.selectedMode);
    });
  }

  private injectStyles(): void {
    if (document.getElementById('main-menu-styles')) return;
    const style = document.createElement('style');
    style.id = 'main-menu-styles';
    style.textContent = /* css */ `
      .menu-root {
        position: fixed;
        inset: 0;
        z-index: 300;
        font-family: monospace;
        color: #e0e0e0;
      }
      .menu-overlay {
        width: 100%;
        height: 100%;
        background: linear-gradient(135deg, #0a0f0a 0%, #1a2a1a 50%, #0a150a 100%);
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .menu-container {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 16px;
        max-width: 560px;
        width: 90%;
      }
      .menu-title {
        font-size: 48px;
        font-weight: bold;
        letter-spacing: 12px;
        color: #fff;
        text-shadow: 0 0 30px rgba(76, 175, 80, 0.4), 0 0 60px rgba(76, 175, 80, 0.15);
      }
      .menu-subtitle {
        font-size: 12px;
        letter-spacing: 6px;
        color: #666;
        margin-bottom: 24px;
      }
      .menu-label {
        font-size: 11px;
        font-weight: bold;
        letter-spacing: 2px;
        color: #888;
        align-self: flex-start;
        width: 100%;
      }
      .menu-name-section {
        width: 100%;
        display: flex;
        flex-direction: column;
        gap: 6px;
        margin-bottom: 8px;
      }
      .menu-name-input {
        width: 100%;
        padding: 12px 16px;
        background: rgba(255,255,255,0.06);
        border: 1px solid rgba(255,255,255,0.15);
        border-radius: 6px;
        color: #fff;
        font-family: monospace;
        font-size: 16px;
        outline: none;
        transition: border-color 0.15s;
        box-sizing: border-box;
      }
      .menu-name-input::placeholder {
        color: #555;
      }
      .menu-name-input:focus {
        border-color: #4caf50;
      }
      .menu-mode-cards {
        width: 100%;
        display: flex;
        flex-direction: column;
        gap: 10px;
        margin-top: 4px;
      }
      .menu-mode-card {
        padding: 16px 20px;
        background: rgba(255,255,255,0.04);
        border: 1px solid rgba(255,255,255,0.1);
        border-radius: 8px;
        cursor: pointer;
        transition: all 0.15s;
      }
      .menu-mode-card:hover {
        background: rgba(255,255,255,0.08);
        border-color: rgba(255,255,255,0.2);
      }
      .menu-mode-card.selected {
        background: rgba(76,175,80,0.12);
        border-color: #4caf50;
        box-shadow: 0 0 20px rgba(76, 175, 80, 0.1);
      }
      .menu-mode-name {
        font-size: 18px;
        font-weight: bold;
        color: #fff;
        letter-spacing: 2px;
      }
      .menu-mode-desc {
        font-size: 12px;
        color: #aaa;
        margin-top: 6px;
        line-height: 1.4;
      }
      .menu-mode-detail {
        font-size: 10px;
        color: #666;
        margin-top: 6px;
        letter-spacing: 1px;
      }
      .menu-play-btn {
        margin-top: 16px;
        padding: 16px 0;
        width: 100%;
        background: #4caf50;
        border: none;
        border-radius: 8px;
        color: #fff;
        font-family: monospace;
        font-size: 20px;
        font-weight: bold;
        letter-spacing: 4px;
        cursor: pointer;
        transition: all 0.15s;
      }
      .menu-play-btn:hover {
        background: #66bb6a;
        box-shadow: 0 0 30px rgba(76, 175, 80, 0.25);
      }
      .menu-play-btn:active {
        background: #388e3c;
      }
    `;
    document.head.appendChild(style);
  }

  dispose(): void {
    this.root.remove();
    const style = document.getElementById('main-menu-styles');
    if (style) style.remove();
  }
}
