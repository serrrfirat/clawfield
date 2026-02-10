/**
 * Radial grenade selection menu.
 * Opens on long-press G, selects grenade type by mouse direction (left = frag, right = smoke).
 */
export class GrenadeRadialMenu {
  private root: HTMLDivElement;
  private wedge0: HTMLDivElement;
  private wedge1: HTMLDivElement;
  private name0: HTMLDivElement;
  private name1: HTMLDivElement;
  private visible = false;

  constructor() {
    this.root = document.createElement('div');
    this.root.className = 'grenade-radial-menu';
    this.root.style.display = 'none';

    // Left wedge (frag)
    this.wedge0 = document.createElement('div');
    this.wedge0.className = 'grenade-radial-wedge grenade-radial-wedge-left';
    this.name0 = document.createElement('div');
    this.name0.className = 'grenade-radial-name';
    this.name0.textContent = 'FRAG';
    this.wedge0.appendChild(this.name0);

    // Right wedge (smoke)
    this.wedge1 = document.createElement('div');
    this.wedge1.className = 'grenade-radial-wedge grenade-radial-wedge-right';
    this.name1 = document.createElement('div');
    this.name1.className = 'grenade-radial-name';
    this.name1.textContent = 'SMOKE';
    this.wedge1.appendChild(this.name1);

    // Center divider
    const divider = document.createElement('div');
    divider.className = 'grenade-radial-divider';

    // Center label
    const label = document.createElement('div');
    label.className = 'grenade-radial-label';
    label.textContent = 'SELECT GRENADE';

    this.root.appendChild(this.wedge0);
    this.root.appendChild(divider);
    this.root.appendChild(this.wedge1);
    this.root.appendChild(label);

    document.body.appendChild(this.root);
    this.injectStyles();
  }

  show(selectedIndex: number): void {
    if (!this.visible) {
      this.visible = true;
      this.root.style.display = 'flex';
    }
    this.wedge0.classList.toggle('grenade-radial-selected', selectedIndex === 0);
    this.wedge1.classList.toggle('grenade-radial-selected', selectedIndex === 1);
  }

  hide(): void {
    if (!this.visible) return;
    this.visible = false;
    this.root.style.display = 'none';
  }

  isVisible(): boolean {
    return this.visible;
  }

  dispose(): void {
    this.root.remove();
  }

  private injectStyles(): void {
    if (document.querySelector('[data-grenade-radial]')) return;
    const style = document.createElement('style');
    style.setAttribute('data-grenade-radial', '');
    style.textContent = /* css */ `
.grenade-radial-menu {
  position: fixed;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  display: flex;
  align-items: center;
  gap: 0;
  z-index: 150;
  pointer-events: none;
  font-family: monospace;
  color: #fff;
}

.grenade-radial-wedge {
  width: 120px;
  height: 80px;
  background: rgba(0, 0, 0, 0.7);
  border: 1px solid rgba(255, 255, 255, 0.2);
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.1s ease, border-color 0.1s ease;
}

.grenade-radial-wedge-left {
  border-radius: 8px 0 0 8px;
}

.grenade-radial-wedge-right {
  border-radius: 0 8px 8px 0;
}

.grenade-radial-wedge.grenade-radial-selected {
  background: rgba(241, 196, 15, 0.35);
  border-color: rgba(241, 196, 15, 0.8);
}

.grenade-radial-divider {
  width: 2px;
  height: 80px;
  background: rgba(255, 255, 255, 0.3);
}

.grenade-radial-name {
  font-size: 14px;
  font-weight: bold;
  text-shadow: 1px 1px 2px rgba(0, 0, 0, 0.8);
  text-align: center;
  letter-spacing: 2px;
}

.grenade-radial-label {
  position: absolute;
  top: -28px;
  left: 50%;
  transform: translateX(-50%);
  font-size: 11px;
  letter-spacing: 2px;
  opacity: 0.6;
  white-space: nowrap;
}
`;
    document.head.appendChild(style);
  }
}
