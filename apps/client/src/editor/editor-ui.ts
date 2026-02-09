export type EditorMode = 'terrain' | 'place' | 'metadata';

export interface EditorUICallbacks {
  onNew: () => void;
  onOpen: () => void;
  onSave: () => void;
  onModeChange: (mode: EditorMode) => void;
  onAIGenerate: () => void;
}

export class EditorUI {
  private root: HTMLDivElement;
  private sidebar: HTMLDivElement;
  private sidebarContent: HTMLDivElement;
  private sidebarHeader: HTMLDivElement;
  private statusBar: HTMLDivElement;
  private canvasContainer: HTMLDivElement;
  private modeButtons: Map<EditorMode, HTMLButtonElement> = new Map();
  private currentMode: EditorMode = 'terrain';
  private callbacks: EditorUICallbacks;

  // Status bar items
  private placementCountEl!: HTMLSpanElement;
  private spawnCountEl!: HTMLSpanElement;
  private dirtyEl!: HTMLSpanElement;
  private cursorEl!: HTMLSpanElement;

  constructor(callbacks: EditorUICallbacks) {
    this.callbacks = callbacks;

    // Root container
    this.root = document.createElement('div');
    this.root.className = 'editor-root';
    document.body.appendChild(this.root);

    // Toolbar
    const toolbar = this.createToolbar();
    this.root.appendChild(toolbar);

    // Sidebar
    this.sidebar = document.createElement('div');
    this.sidebar.className = 'editor-sidebar';
    this.sidebarHeader = document.createElement('div');
    this.sidebarHeader.className = 'editor-sidebar-header';
    this.sidebarHeader.textContent = 'Terrain';
    this.sidebar.appendChild(this.sidebarHeader);
    this.sidebarContent = document.createElement('div');
    this.sidebarContent.className = 'editor-sidebar-content';
    this.sidebar.appendChild(this.sidebarContent);
    this.root.appendChild(this.sidebar);

    // Canvas container
    this.canvasContainer = document.createElement('div');
    this.canvasContainer.className = 'editor-canvas-container';
    this.root.appendChild(this.canvasContainer);

    // Status bar
    this.statusBar = this.createStatusBar();
    this.root.appendChild(this.statusBar);
  }

  private createToolbar(): HTMLDivElement {
    const toolbar = document.createElement('div');
    toolbar.className = 'editor-toolbar';

    // File operations
    const fileGroup = document.createElement('div');
    fileGroup.className = 'editor-toolbar-group';

    const newBtn = this.makeButton('New', () => this.callbacks.onNew());
    const openBtn = this.makeButton('Open', () => this.callbacks.onOpen());
    const saveBtn = this.makeButton('Save', () => this.callbacks.onSave());
    fileGroup.append(newBtn, openBtn, saveBtn);
    toolbar.appendChild(fileGroup);

    // Separator
    toolbar.appendChild(this.makeSep());

    // Mode tabs
    const modeGroup = document.createElement('div');
    modeGroup.className = 'editor-toolbar-group';

    const modes: { mode: EditorMode; label: string }[] = [
      { mode: 'terrain', label: 'Terrain' },
      { mode: 'place', label: 'Place' },
      { mode: 'metadata', label: 'Metadata' },
    ];

    for (const { mode, label } of modes) {
      const btn = this.makeButton(label, () => this.setMode(mode));
      this.modeButtons.set(mode, btn);
      modeGroup.appendChild(btn);
    }

    this.modeButtons.get('terrain')!.classList.add('active');
    toolbar.appendChild(modeGroup);

    // Separator + AI button
    toolbar.appendChild(this.makeSep());
    const aiBtn = this.makeButton('AI Generate', () => this.callbacks.onAIGenerate());
    aiBtn.classList.add('editor-ai-btn-toolbar');
    toolbar.appendChild(aiBtn);

    // Help text
    toolbar.appendChild(this.makeSep());
    const helpSpan = document.createElement('span');
    helpSpan.style.cssText = 'font-size:11px;color:#888;margin-left:8px';
    helpSpan.textContent = 'Right-drag: orbit | Scroll: zoom | Middle-drag: pan | Right+WASD: fly';
    toolbar.appendChild(helpSpan);

    return toolbar;
  }

  private createStatusBar(): HTMLDivElement {
    const bar = document.createElement('div');
    bar.className = 'editor-status';

    this.placementCountEl = document.createElement('span');
    this.placementCountEl.className = 'editor-status-item';
    this.placementCountEl.textContent = 'Placements: 0';
    bar.appendChild(this.placementCountEl);

    this.spawnCountEl = document.createElement('span');
    this.spawnCountEl.className = 'editor-status-item';
    this.spawnCountEl.textContent = 'Spawns: 0';
    bar.appendChild(this.spawnCountEl);

    this.dirtyEl = document.createElement('span');
    this.dirtyEl.className = 'editor-status-item editor-status-dirty';
    this.dirtyEl.textContent = '';
    bar.appendChild(this.dirtyEl);

    this.cursorEl = document.createElement('span');
    this.cursorEl.className = 'editor-status-item';
    this.cursorEl.style.marginLeft = 'auto';
    this.cursorEl.textContent = '';
    bar.appendChild(this.cursorEl);

    return bar;
  }

  private makeButton(label: string, onClick: () => void): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.className = 'editor-btn';
    btn.textContent = label;
    btn.addEventListener('click', onClick);
    return btn;
  }

  private makeSep(): HTMLDivElement {
    const sep = document.createElement('div');
    sep.className = 'editor-toolbar-sep';
    return sep;
  }

  setMode(mode: EditorMode): void {
    if (mode === this.currentMode) return;
    this.currentMode = mode;
    for (const [m, btn] of this.modeButtons) {
      btn.classList.toggle('active', m === mode);
    }
    const titles: Record<EditorMode, string> = {
      terrain: 'Terrain',
      place: 'Components',
      metadata: 'Metadata',
    };
    this.sidebarHeader.textContent = titles[mode];
    this.callbacks.onModeChange(mode);
  }

  getMode(): EditorMode {
    return this.currentMode;
  }

  getCanvasContainer(): HTMLDivElement {
    return this.canvasContainer;
  }

  getSidebarContent(): HTMLDivElement {
    return this.sidebarContent;
  }

  updateStatus(placements: number, spawns: number, dirty: boolean): void {
    this.placementCountEl.textContent = `Placements: ${placements}`;
    this.spawnCountEl.textContent = `Spawns: ${spawns}`;
    this.dirtyEl.textContent = dirty ? 'Unsaved' : '';
  }

  updateCursor(x: number, y: number, z: number): void {
    this.cursorEl.textContent = `X:${x} Y:${y} Z:${z}`;
  }

  clearCursor(): void {
    this.cursorEl.textContent = '';
  }
}
