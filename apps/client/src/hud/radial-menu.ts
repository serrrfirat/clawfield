import type { ClassDef, GadgetId } from '@clawfield/shared';
import { GADGET_COOLDOWNS, GADGET_COOLDOWN } from '@clawfield/shared';

/** Gadget display names */
const GADGET_NAMES: Record<string, string> = {
  frag_grenade: 'Frag Grenade',
  smoke_grenade: 'Smoke',
  medkit: 'Medkit',
  bandage: 'Bandage',
  ammo_box: 'Ammo Box',
  repair_tool: 'Deploy Cover',
  spotting_scope: 'Spotting Scope',
  claymore: 'Claymore',
};

/**
 * Radial gadget selection menu.
 * Opens on long-press F, selects gadget by mouse direction (left/right).
 * Shows gadget name and cooldown state for both slots.
 */
export class RadialMenu {
  private root: HTMLDivElement;
  private wedge0: HTMLDivElement;
  private wedge1: HTMLDivElement;
  private name0: HTMLDivElement;
  private name1: HTMLDivElement;
  private cd0: HTMLDivElement;
  private cd1: HTMLDivElement;
  private visible = false;

  constructor() {
    this.root = document.createElement('div');
    this.root.className = 'radial-menu';
    this.root.style.display = 'none';

    // Left wedge (gadget 0)
    this.wedge0 = document.createElement('div');
    this.wedge0.className = 'radial-wedge radial-wedge-left';
    this.name0 = document.createElement('div');
    this.name0.className = 'radial-name';
    this.cd0 = document.createElement('div');
    this.cd0.className = 'radial-cd';
    this.wedge0.appendChild(this.name0);
    this.wedge0.appendChild(this.cd0);

    // Right wedge (gadget 1)
    this.wedge1 = document.createElement('div');
    this.wedge1.className = 'radial-wedge radial-wedge-right';
    this.name1 = document.createElement('div');
    this.name1.className = 'radial-name';
    this.cd1 = document.createElement('div');
    this.cd1.className = 'radial-cd';
    this.wedge1.appendChild(this.name1);
    this.wedge1.appendChild(this.cd1);

    // Center divider
    const divider = document.createElement('div');
    divider.className = 'radial-divider';

    // Center label
    const label = document.createElement('div');
    label.className = 'radial-label';
    label.textContent = 'SELECT GADGET';

    this.root.appendChild(this.wedge0);
    this.root.appendChild(divider);
    this.root.appendChild(this.wedge1);
    this.root.appendChild(label);

    document.body.appendChild(this.root);

    // Inject CSS
    this.injectStyles();
  }

  show(
    classDef: ClassDef,
    selectedIndex: number,
    lastUseTime: number,
    now: number,
  ): void {
    if (this.visible) {
      // Just update selection highlight
      this.updateSelection(selectedIndex);
      this.updateCooldowns(classDef, lastUseTime, now);
      return;
    }
    this.visible = true;
    this.root.style.display = 'flex';

    // Set gadget names
    this.name0.textContent = GADGET_NAMES[classDef.gadgets[0]] ?? classDef.gadgets[0];
    this.name1.textContent = GADGET_NAMES[classDef.gadgets[1]] ?? classDef.gadgets[1];

    this.updateSelection(selectedIndex);
    this.updateCooldowns(classDef, lastUseTime, now);
  }

  hide(): void {
    if (!this.visible) return;
    this.visible = false;
    this.root.style.display = 'none';
  }

  isVisible(): boolean {
    return this.visible;
  }

  private updateSelection(selectedIndex: number): void {
    this.wedge0.classList.toggle('radial-selected', selectedIndex === 0);
    this.wedge1.classList.toggle('radial-selected', selectedIndex === 1);
  }

  private updateCooldowns(classDef: ClassDef, lastUseTime: number, now: number): void {
    // Show cooldown per gadget based on last use time
    for (let i = 0; i < 2; i++) {
      const gadgetId = classDef.gadgets[i];
      const cooldown = (GADGET_COOLDOWNS[gadgetId] ?? GADGET_COOLDOWN) * 1000;
      const elapsed = now - lastUseTime;
      const remaining = Math.max(0, cooldown - elapsed);
      const cdEl = i === 0 ? this.cd0 : this.cd1;
      const wedge = i === 0 ? this.wedge0 : this.wedge1;

      if (remaining > 0) {
        cdEl.textContent = `${(remaining / 1000).toFixed(1)}s`;
        cdEl.style.display = 'block';
        wedge.classList.add('radial-cooldown');
      } else {
        cdEl.textContent = 'READY';
        cdEl.style.display = 'block';
        wedge.classList.remove('radial-cooldown');
      }
    }
  }

  dispose(): void {
    this.root.remove();
  }

  private injectStyles(): void {
    if (document.querySelector('[data-radial-menu]')) return;
    const style = document.createElement('style');
    style.setAttribute('data-radial-menu', '');
    style.textContent = /* css */ `
.radial-menu {
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

.radial-wedge {
  width: 140px;
  height: 100px;
  background: rgba(0, 0, 0, 0.7);
  border: 1px solid rgba(255, 255, 255, 0.2);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  transition: background 0.1s ease, border-color 0.1s ease;
}

.radial-wedge-left {
  border-radius: 8px 0 0 8px;
}

.radial-wedge-right {
  border-radius: 0 8px 8px 0;
}

.radial-wedge.radial-selected {
  background: rgba(46, 204, 113, 0.35);
  border-color: rgba(46, 204, 113, 0.8);
}

.radial-wedge.radial-cooldown {
  opacity: 0.5;
}

.radial-wedge.radial-cooldown.radial-selected {
  background: rgba(231, 76, 60, 0.3);
  border-color: rgba(231, 76, 60, 0.6);
}

.radial-divider {
  width: 2px;
  height: 100px;
  background: rgba(255, 255, 255, 0.3);
}

.radial-name {
  font-size: 13px;
  font-weight: bold;
  text-shadow: 1px 1px 2px rgba(0, 0, 0, 0.8);
  text-align: center;
  letter-spacing: 1px;
}

.radial-cd {
  font-size: 11px;
  opacity: 0.8;
  letter-spacing: 1px;
}

.radial-label {
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
