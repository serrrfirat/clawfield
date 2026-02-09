export interface MainMenuChoice {
  action: 'host' | 'join';
  name: string;
  roomCode?: string;
}

/**
 * Main menu screen.
 * Lets the player enter a name, then HOST a new room or JOIN with a code.
 */
export class MainMenu {
  private root: HTMLDivElement;
  private nameInput: HTMLInputElement;
  private codeInput: HTMLInputElement;
  private hostBtn: HTMLButtonElement;
  private joinBtn: HTMLButtonElement;
  private errorEl: HTMLDivElement;
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

          <button class="menu-host-btn">HOST GAME</button>

          <div class="menu-divider"><span>OR</span></div>

          <div class="menu-join-section">
            <label class="menu-label" for="menu-code-input">ROOM CODE</label>
            <div class="menu-join-row">
              <input id="menu-code-input" class="menu-code-input" type="text"
                maxlength="4" placeholder="ABCD" spellcheck="false" />
              <button class="menu-join-btn">JOIN GAME</button>
            </div>
          </div>

          <div class="menu-error"></div>
        </div>
      </div>
    `;
    document.body.appendChild(this.root);

    this.nameInput = this.root.querySelector('.menu-name-input')!;
    this.codeInput = this.root.querySelector('.menu-code-input')!;
    this.hostBtn = this.root.querySelector('.menu-host-btn')!;
    this.joinBtn = this.root.querySelector('.menu-join-btn')!;
    this.errorEl = this.root.querySelector('.menu-error')!;

    this.injectStyles();

    // Force uppercase on code input
    this.codeInput.addEventListener('input', () => {
      this.codeInput.value = this.codeInput.value.toUpperCase().replace(/[^A-Z]/g, '');
    });

    this.hostBtn.addEventListener('click', () => this.handleHost());
    this.joinBtn.addEventListener('click', () => this.handleJoin());
    this.codeInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.handleJoin();
    });
  }

  show(onPlay: (choice: MainMenuChoice) => void): void {
    this.onPlay = onPlay;
    this.visible = true;
    this.root.style.display = '';
    this.errorEl.textContent = '';
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

  showError(message: string): void {
    this.errorEl.textContent = message;
  }

  private getName(): string {
    const raw = this.nameInput.value.trim();
    return raw || this.nameInput.placeholder;
  }

  private handleHost(): void {
    if (!this.onPlay) return;
    this.errorEl.textContent = '';
    this.onPlay({ action: 'host', name: this.getName() });
  }

  private handleJoin(): void {
    if (!this.onPlay) return;
    this.errorEl.textContent = '';
    const code = this.codeInput.value.trim().toUpperCase();
    if (code.length !== 4) {
      this.errorEl.textContent = 'Enter a 4-letter room code.';
      return;
    }
    this.onPlay({ action: 'join', name: this.getName(), roomCode: code });
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
      .menu-host-btn {
        margin-top: 8px;
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
      .menu-host-btn:hover {
        background: #66bb6a;
        box-shadow: 0 0 30px rgba(76, 175, 80, 0.25);
      }
      .menu-host-btn:active {
        background: #388e3c;
      }
      .menu-divider {
        width: 100%;
        display: flex;
        align-items: center;
        gap: 16px;
        color: #555;
        font-size: 12px;
        letter-spacing: 4px;
        margin: 4px 0;
      }
      .menu-divider::before,
      .menu-divider::after {
        content: '';
        flex: 1;
        height: 1px;
        background: rgba(255,255,255,0.1);
      }
      .menu-join-section {
        width: 100%;
        display: flex;
        flex-direction: column;
        gap: 6px;
      }
      .menu-join-row {
        display: flex;
        gap: 10px;
      }
      .menu-code-input {
        flex: 1;
        padding: 12px 16px;
        background: rgba(255,255,255,0.06);
        border: 1px solid rgba(255,255,255,0.15);
        border-radius: 6px;
        color: #fff;
        font-family: monospace;
        font-size: 20px;
        font-weight: bold;
        letter-spacing: 8px;
        text-align: center;
        text-transform: uppercase;
        outline: none;
        transition: border-color 0.15s;
        box-sizing: border-box;
      }
      .menu-code-input::placeholder {
        color: #444;
        letter-spacing: 8px;
      }
      .menu-code-input:focus {
        border-color: #4caf50;
      }
      .menu-join-btn {
        padding: 12px 24px;
        background: rgba(255,255,255,0.08);
        border: 1px solid rgba(255,255,255,0.2);
        border-radius: 6px;
        color: #fff;
        font-family: monospace;
        font-size: 14px;
        font-weight: bold;
        letter-spacing: 2px;
        cursor: pointer;
        transition: all 0.15s;
        white-space: nowrap;
      }
      .menu-join-btn:hover {
        background: rgba(255,255,255,0.15);
        border-color: rgba(255,255,255,0.3);
      }
      .menu-join-btn:active {
        background: rgba(255,255,255,0.05);
      }
      .menu-error {
        color: #ef5350;
        font-size: 13px;
        min-height: 20px;
        text-align: center;
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
