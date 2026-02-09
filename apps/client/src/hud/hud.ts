import type { KillEntry, GameMode } from '@clawfield/shared';
import { injectHUDStyles } from './styles.js';

// ── Public interfaces ──────────────────────────────────────────────

/** State the game loop feeds into the HUD every frame. */
export interface HUDState {
  health: number;
  ammo: number;
  maxAmmo: number;
  reloading: boolean;
  ticketsAlpha: number;
  ticketsBravo: number;
  /** 0 = Alpha, 1 = Bravo */
  myTeam: number;
  alive: boolean;
  className: string;
  gameMode: GameMode;
  conquestScoreAlpha: number;
  conquestScoreBravo: number;
  gadgetName: string;
  /** 0 = ready, 1 = full cooldown */
  gadgetCooldownPct: number;
  gadgetReady: boolean;
  /** Display name of the currently equipped weapon */
  weaponName: string;
  /** Player yaw in radians for compass (0 = north / -Z) */
  playerYaw: number;
}

// ── Internal helpers ───────────────────────────────────────────────

/** Team index constants matching shared/combat.ts Team enum. */
const TEAM_ALPHA = 0;
const TEAM_BRAVO = 1;

/** Max kill feed entries shown at once. */
const MAX_KILLFEED = 5;

/** How long (ms) a kill feed entry lives before fading. */
const KILLFEED_LIFETIME = 5_000;

/** How long (ms) the hit marker stays visible. */
const HITMARKER_DURATION = 200;

// ── HUD Class ──────────────────────────────────────────────────────

/**
 * Pure HTML/CSS heads-up display overlay.
 *
 * Usage:
 * ```ts
 * const hud = new HUD();
 * // Every frame:
 * hud.update({ health, ammo, maxAmmo, ... });
 * // Events:
 * hud.addKill(entry);
 * hud.showHitMarker();
 * hud.showDeath(5);
 * hud.hideDeath();
 * hud.showGameOver(winner, myTeam);
 * // Cleanup:
 * hud.dispose();
 * ```
 */
export class HUD {
  // ── DOM refs ─────────────────────────────────────────────────

  private root: HTMLDivElement;

  // Health
  private healthFill: HTMLDivElement;
  private healthText: HTMLDivElement;

  // Ammo
  private ammoBarContainer: HTMLDivElement;
  private ammoReload: HTMLDivElement;
  private weaponNameEl: HTMLDivElement;

  // Tickets
  private ticketsAlphaEl: HTMLSpanElement;
  private ticketsBravoEl: HTMLSpanElement;

  // Kill feed
  private killfeedContainer: HTMLDivElement;
  private killfeedTimers: number[] = [];

  // Hit marker
  private hitmarker: HTMLDivElement;
  private hitmarkerTimer: number | null = null;

  // Death overlay
  private deathOverlay: HTMLDivElement;
  private deathTitle: HTMLDivElement;
  private deathKillerName: HTMLDivElement;
  private deathCountdown: HTMLDivElement;
  private deathInterval: number | null = null;

  // Downed / revive overlay
  private downedReviveBar: HTMLDivElement;
  private downedReviveFill: HTMLDivElement;
  private downedReviveText: HTMLDivElement;

  // Game over
  private gameoverOverlay: HTMLDivElement;
  private gameoverText: HTMLDivElement;

  // Revive prompt (shown to alive players near downed teammates)
  private revivePrompt: HTMLDivElement;

  // Gadget indicator
  private gadgetWrap: HTMLDivElement;
  private gadgetName: HTMLDivElement;
  private gadgetCdFill: HTMLDivElement;
  private gadgetKey: HTMLDivElement;

  // Compass
  private compassStrip: HTMLDivElement;
  private compassHeading: HTMLDivElement;

  // Class indicator
  private classLabel: HTMLDivElement;

  /** Cached ammo bar elements for reuse */
  private ammoBars: HTMLDivElement[] = [];
  private lastMaxAmmo = 0;

  // ── Constructor ──────────────────────────────────────────────

  constructor() {
    injectHUDStyles();
    this.root = this.el('div', 'hud-root');

    // ── Health (bottom-left) ──
    const healthWrap = this.el('div', 'hud-health');
    const barBg = this.el('div', 'hud-health-bar-bg');
    this.healthFill = this.el('div', 'hud-health-bar-fill');
    this.healthText = this.el('div', 'hud-health-text');
    barBg.appendChild(this.healthFill);
    barBg.appendChild(this.healthText);
    healthWrap.appendChild(barBg);
    this.root.appendChild(healthWrap);

    // Class label (above health bar)
    this.classLabel = this.el('div', 'hud-class-label');
    this.root.appendChild(this.classLabel);

    // ── Ammo (bottom-right) ──
    const ammoWrap = this.el('div', 'hud-ammo');
    this.weaponNameEl = this.el('div', 'hud-weapon-name');
    this.ammoBarContainer = this.el('div', 'hud-ammo-bars');
    this.ammoReload = this.el('div', 'hud-ammo-reload');
    this.ammoReload.textContent = 'RELOADING';
    ammoWrap.appendChild(this.weaponNameEl);
    ammoWrap.appendChild(this.ammoBarContainer);
    ammoWrap.appendChild(this.ammoReload);
    this.root.appendChild(ammoWrap);

    // ── Tickets (top-center) ──
    const ticketsWrap = this.el('div', 'hud-tickets');
    this.ticketsAlphaEl = this.el('span', 'hud-tickets-alpha') as HTMLSpanElement;
    this.ticketsBravoEl = this.el('span', 'hud-tickets-bravo') as HTMLSpanElement;
    const sep = this.el('span', 'hud-tickets-sep');
    sep.textContent = '|';
    ticketsWrap.appendChild(this.ticketsAlphaEl);
    ticketsWrap.appendChild(sep);
    ticketsWrap.appendChild(this.ticketsBravoEl);
    this.root.appendChild(ticketsWrap);

    // ── Kill feed (top-right) ──
    this.killfeedContainer = this.el('div', 'hud-killfeed');
    this.root.appendChild(this.killfeedContainer);

    // ── Hit marker (center) ──
    this.hitmarker = this.el('div', 'hud-hitmarker');
    this.root.appendChild(this.hitmarker);

    // ── Death overlay (also used for downed state) ──
    this.deathOverlay = this.el('div', 'hud-death');
    this.deathTitle = this.el('div', 'hud-death-title');
    this.deathTitle.textContent = 'YOU DIED';
    this.deathKillerName = this.el('div', 'hud-death-killer');
    this.deathCountdown = this.el('div', 'hud-death-countdown');
    // Revive progress bar (shown when downed and being revived)
    this.downedReviveBar = this.el('div', 'hud-revive-bar');
    this.downedReviveFill = this.el('div', 'hud-revive-fill');
    this.downedReviveText = this.el('div', 'hud-revive-text');
    this.downedReviveBar.appendChild(this.downedReviveFill);
    this.deathOverlay.appendChild(this.deathTitle);
    this.deathOverlay.appendChild(this.deathKillerName);
    this.deathOverlay.appendChild(this.deathCountdown);
    this.deathOverlay.appendChild(this.downedReviveBar);
    this.deathOverlay.appendChild(this.downedReviveText);
    this.root.appendChild(this.deathOverlay);

    // ── Revive prompt (shown when alive and near a downed teammate) ──
    this.revivePrompt = this.el('div', 'hud-revive-prompt');
    this.revivePrompt.textContent = 'Hold [E] to revive';
    this.root.appendChild(this.revivePrompt);

    // ── Gadget indicator (bottom-left, above health) ──
    this.gadgetWrap = this.el('div', 'hud-gadget');
    this.gadgetName = this.el('div', 'hud-gadget-name');
    this.gadgetKey = this.el('div', 'hud-gadget-key');
    this.gadgetKey.textContent = '[F]';
    const gadgetCdBg = this.el('div', 'hud-gadget-cooldown');
    this.gadgetCdFill = this.el('div', 'hud-gadget-cooldown-fill');
    gadgetCdBg.appendChild(this.gadgetCdFill);
    this.gadgetWrap.appendChild(this.gadgetName);
    this.gadgetWrap.appendChild(gadgetCdBg);
    this.gadgetWrap.appendChild(this.gadgetKey);
    this.root.appendChild(this.gadgetWrap);

    // ── Compass (bottom-center) ──
    const compassWrap = this.el('div', 'hud-compass');
    this.compassHeading = this.el('div', 'hud-compass-heading');
    this.compassStrip = this.el('div', 'hud-compass-strip');
    compassWrap.appendChild(this.compassHeading);
    compassWrap.appendChild(this.compassStrip);
    // Center tick mark
    const centerTick = this.el('div', 'hud-compass-center');
    compassWrap.appendChild(centerTick);
    this.root.appendChild(compassWrap);

    // ── Game over ──
    this.gameoverOverlay = this.el('div', 'hud-gameover');
    this.gameoverText = this.el('div', 'hud-gameover-text');
    this.gameoverOverlay.appendChild(this.gameoverText);
    this.root.appendChild(this.gameoverOverlay);

    // Mount
    document.body.appendChild(this.root);
  }

  // ── Public API ───────────────────────────────────────────────

  /**
   * Call every frame to sync HUD with current game state.
   */
  update(state: HUDState): void {
    // Health bar
    const pct = Math.max(0, Math.min(100, state.health));
    this.healthFill.style.width = `${pct}%`;
    this.healthFill.style.backgroundColor = this.healthColor(pct);
    this.healthText.textContent = `${Math.round(state.health)}`;

    // Class label
    this.classLabel.textContent = state.className.toUpperCase();

    // Weapon name
    this.weaponNameEl.textContent = state.weaponName || state.className;

    // Ammo bars
    this.updateAmmoBars(state.ammo, state.maxAmmo);
    if (state.reloading) {
      this.ammoReload.classList.add('visible');
    } else {
      this.ammoReload.classList.remove('visible');
    }

    // Score display — mode-aware
    if (state.gameMode === 'conquest') {
      this.ticketsAlphaEl.textContent = `ALPHA: ${state.conquestScoreAlpha}`;
      this.ticketsBravoEl.textContent = `BRAVO: ${state.conquestScoreBravo}`;
    } else {
      this.ticketsAlphaEl.textContent = `ALPHA: ${state.ticketsAlpha}`;
      this.ticketsBravoEl.textContent = `BRAVO: ${state.ticketsBravo}`;
    }

    // Highlight player's own team
    this.ticketsAlphaEl.classList.toggle(
      'hud-tickets-highlight',
      state.myTeam === TEAM_ALPHA,
    );
    this.ticketsBravoEl.classList.toggle(
      'hud-tickets-highlight',
      state.myTeam === TEAM_BRAVO,
    );

    // Gadget indicator
    this.gadgetName.textContent = state.gadgetName;
    const cdPct = Math.max(0, Math.min(1, 1 - state.gadgetCooldownPct));
    this.gadgetCdFill.style.width = `${cdPct * 100}%`;
    this.gadgetCdFill.style.backgroundColor = state.gadgetReady ? '#2ecc71' : '#e74c3c';
    this.gadgetKey.style.opacity = state.gadgetReady ? '1' : '0.4';

    // Compass
    this.updateCompass(state.playerYaw);
  }

  /**
   * Push a new kill into the kill feed.
   * Automatically trims to the most recent entries and schedules fade-out.
   */
  addKill(entry: KillEntry): void {
    const row = document.createElement('div');
    row.className = 'hud-killfeed-entry';

    // Killer name — color by weapon holder's team (we don't have team in KillEntry,
    // so we use a neutral approach; the integrator can extend KillEntry later).
    // For now, killer gets Alpha color, victim gets Bravo as a visual distinction.
    // In practice the main.ts integration layer should set team info; we rely on
    // the overloaded addKill variant below for team-aware coloring.
    row.innerHTML =
      `<span class="hud-killfeed-alpha">${this.esc(entry.killerName)}</span>` +
      `<span class="hud-killfeed-weapon">[${this.esc(entry.weapon)}]</span>` +
      `<span class="hud-killfeed-bravo">${this.esc(entry.victimName)}</span>`;

    this.killfeedContainer.appendChild(row);

    // Trim to MAX_KILLFEED
    while (this.killfeedContainer.children.length > MAX_KILLFEED) {
      this.killfeedContainer.removeChild(this.killfeedContainer.children[0]!);
    }

    // Schedule fade-out
    const timer = window.setTimeout(() => {
      row.classList.add('fading');
      // Remove from DOM after CSS transition
      window.setTimeout(() => {
        row.remove();
      }, 400);
    }, KILLFEED_LIFETIME);

    this.killfeedTimers.push(timer);
  }

  /**
   * Team-aware kill feed variant.
   * Lets the integrator pass team indices so names get correct colors.
   */
  addKillWithTeams(
    entry: KillEntry,
    killerTeam: number,
    victimTeam: number,
  ): void {
    const row = document.createElement('div');
    row.className = 'hud-killfeed-entry';

    const killerClass = killerTeam === TEAM_ALPHA ? 'hud-killfeed-alpha' : 'hud-killfeed-bravo';
    const victimClass = victimTeam === TEAM_ALPHA ? 'hud-killfeed-alpha' : 'hud-killfeed-bravo';

    row.innerHTML =
      `<span class="${killerClass}">${this.esc(entry.killerName)}</span>` +
      `<span class="hud-killfeed-weapon">[${this.esc(entry.weapon)}]</span>` +
      `<span class="${victimClass}">${this.esc(entry.victimName)}</span>`;

    this.killfeedContainer.appendChild(row);

    while (this.killfeedContainer.children.length > MAX_KILLFEED) {
      this.killfeedContainer.removeChild(this.killfeedContainer.children[0]!);
    }

    const timer = window.setTimeout(() => {
      row.classList.add('fading');
      window.setTimeout(() => {
        row.remove();
      }, 400);
    }, KILLFEED_LIFETIME);

    this.killfeedTimers.push(timer);
  }

  /**
   * Flash the hit marker for HITMARKER_DURATION ms.
   */
  showHitMarker(): void {
    if (this.hitmarkerTimer !== null) {
      window.clearTimeout(this.hitmarkerTimer);
    }
    this.hitmarker.classList.add('visible');
    this.hitmarkerTimer = window.setTimeout(() => {
      this.hitmarker.classList.remove('visible');
      this.hitmarkerTimer = null;
    }, HITMARKER_DURATION);
  }

  /**
   * Show the death overlay with a live countdown.
   * @param respawnTime — seconds until respawn
   * @param killerName — optional name of the player who killed us
   */
  showDeath(respawnTime: number, killerName?: string): void {
    this.clearDeathInterval();

    if (killerName) {
      this.deathKillerName.textContent = `Killed by ${killerName}`;
      this.deathKillerName.style.display = 'block';
    } else {
      this.deathKillerName.style.display = 'none';
    }

    let remaining = Math.ceil(respawnTime);
    this.deathCountdown.textContent = `Respawning in ${remaining}...`;
    this.deathOverlay.classList.add('visible');

    this.deathInterval = window.setInterval(() => {
      remaining -= 1;
      if (remaining <= 0) {
        this.deathCountdown.textContent = 'Respawning...';
        this.clearDeathInterval();
      } else {
        this.deathCountdown.textContent = `Respawning in ${remaining}...`;
      }
    }, 1_000);
  }

  /**
   * Show the downed overlay with a bleedout countdown.
   * @param bleedoutTime — seconds until bleedout death
   * @param killerName — optional name of the player who downed us
   */
  showDowned(bleedoutTime: number, killerName?: string): void {
    this.clearDeathInterval();

    this.deathTitle.textContent = 'DOWNED';
    this.deathTitle.style.color = '#f39c12';
    this.deathOverlay.style.background = 'rgba(60, 20, 0, 0.55)';

    if (killerName) {
      this.deathKillerName.textContent = `Downed by ${killerName}`;
      this.deathKillerName.style.display = 'block';
    } else {
      this.deathKillerName.style.display = 'none';
    }

    let remaining = Math.ceil(bleedoutTime);
    this.deathCountdown.textContent = `Bleeding out in ${remaining}s...`;
    this.downedReviveBar.style.display = 'none';
    this.downedReviveText.textContent = 'Waiting for revive...';
    this.downedReviveText.style.display = 'block';
    this.deathOverlay.classList.add('visible');

    this.deathInterval = window.setInterval(() => {
      remaining -= 1;
      if (remaining <= 0) {
        this.deathCountdown.textContent = 'Bled out';
        this.clearDeathInterval();
      } else {
        this.deathCountdown.textContent = `Bleeding out in ${remaining}s...`;
      }
    }, 1_000);
  }

  /**
   * Update revive progress bar on the downed overlay.
   * @param progress — 0 to 1
   * @param reviverName — name of the player reviving us
   */
  updateReviveProgress(progress: number, reviverName?: string): void {
    this.downedReviveBar.style.display = 'block';
    this.downedReviveFill.style.width = `${Math.min(100, progress * 100)}%`;
    if (reviverName) {
      this.downedReviveText.textContent = `${reviverName} is reviving you...`;
    }
    this.downedReviveText.style.display = 'block';
  }

  /**
   * Show or hide the "Hold [E] to revive" prompt for alive players near downed teammates.
   * @param downedName — name of the downed teammate, or null to hide
   */
  showRevivePrompt(downedName: string | null): void {
    if (downedName) {
      this.revivePrompt.textContent = `Hold [E] to revive ${downedName}`;
      this.revivePrompt.classList.add('visible');
    } else {
      this.revivePrompt.classList.remove('visible');
    }
  }

  /**
   * Hide the death/downed overlay (called on respawn or revive).
   */
  hideDeath(): void {
    this.clearDeathInterval();
    this.deathOverlay.classList.remove('visible');
    // Reset styling for normal death overlay
    this.deathTitle.textContent = 'YOU DIED';
    this.deathTitle.style.color = '';
    this.deathOverlay.style.background = '';
    this.downedReviveBar.style.display = 'none';
    this.downedReviveText.style.display = 'none';
  }

  /**
   * Show the game-over screen.
   * @param winner — winning team index (0 = Alpha, 1 = Bravo)
   * @param myTeam — the local player's team
   */
  showGameOver(winner: number, myTeam: number): void {
    const isVictory = winner === myTeam;
    this.gameoverText.textContent = isVictory ? 'VICTORY' : 'DEFEAT';
    this.gameoverText.className =
      'hud-gameover-text ' +
      (isVictory ? 'hud-gameover-victory' : 'hud-gameover-defeat');
    this.gameoverOverlay.classList.add('visible');
  }

  /** Hide the game-over screen (when returning to lobby). */
  hideGameOver(): void {
    this.gameoverOverlay.classList.remove('visible');
  }

  /**
   * Remove all HUD DOM elements and clear timers.
   */
  dispose(): void {
    this.clearDeathInterval();

    if (this.hitmarkerTimer !== null) {
      window.clearTimeout(this.hitmarkerTimer);
      this.hitmarkerTimer = null;
    }

    for (const t of this.killfeedTimers) {
      window.clearTimeout(t);
    }
    this.killfeedTimers.length = 0;

    this.root.remove();
  }

  // ── Private helpers ──────────────────────────────────────────

  /** Cardinal/intercardinal labels for the compass */
  private static readonly COMPASS_LABELS: Record<number, string> = {
    0: 'N', 45: 'NE', 90: 'E', 135: 'SE',
    180: 'S', 225: 'SW', 270: 'W', 315: 'NW',
  };

  /**
   * Update the compass strip to reflect the player's heading.
   * Shows a horizontal band of degree ticks scrolling under a center marker.
   */
  private updateCompass(yawRad: number): void {
    // Convert yaw to compass degrees (0 = North, clockwise).
    // In the engine yaw 0 means looking along -Z (north), increasing CW.
    let deg = ((yawRad * 180) / Math.PI) % 360;
    if (deg < 0) deg += 360;

    this.compassHeading.textContent = `${Math.round(deg)}`;

    // Build strip: show +/- 40 degrees around current heading
    const halfSpan = 40;
    let html = '';
    for (let offset = -halfSpan; offset <= halfSpan; offset += 5) {
      let d = Math.round(deg) + offset;
      if (d < 0) d += 360;
      if (d >= 360) d -= 360;

      const label = HUD.COMPASS_LABELS[d];
      const isMajor = d % 10 === 0;

      if (label) {
        html += `<span class="hud-compass-label">${label}</span>`;
      } else if (isMajor) {
        html += `<span class="hud-compass-major">${d}</span>`;
      } else {
        html += `<span class="hud-compass-tick">|</span>`;
      }
    }
    this.compassStrip.innerHTML = html;
  }

  /**
   * Render ammo as vertical bar indicators (like BattleBit).
   * Each bar represents one round — filled bars are remaining ammo.
   */
  private updateAmmoBars(ammo: number, maxAmmo: number): void {
    // Rebuild bar elements if mag size changed
    if (maxAmmo !== this.lastMaxAmmo) {
      this.lastMaxAmmo = maxAmmo;
      this.ammoBarContainer.innerHTML = '';
      this.ammoBars = [];
      for (let i = 0; i < maxAmmo; i++) {
        const bar = document.createElement('div');
        bar.className = 'hud-ammo-bar';
        this.ammoBarContainer.appendChild(bar);
        this.ammoBars.push(bar);
      }
    }

    // Update filled/empty state
    for (let i = 0; i < this.ammoBars.length; i++) {
      const bar = this.ammoBars[i]!;
      if (i < ammo) {
        bar.classList.remove('empty');
      } else {
        bar.classList.add('empty');
      }
    }
  }

  /** Create a typed DOM element with a CSS class. */
  private el<K extends keyof HTMLElementTagNameMap>(
    tag: K,
    className: string,
  ): HTMLElementTagNameMap[K] {
    const node = document.createElement(tag);
    node.className = className;
    return node;
  }

  /** Pick a health bar color based on percentage. */
  private healthColor(pct: number): string {
    if (pct > 60) return '#2ecc71'; // green
    if (pct > 30) return '#f1c40f'; // yellow
    return '#e74c3c'; // red
  }

  /** Simple HTML-escape to avoid injection from player names. */
  private esc(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /** Clear the death countdown interval if running. */
  private clearDeathInterval(): void {
    if (this.deathInterval !== null) {
      window.clearInterval(this.deathInterval);
      this.deathInterval = null;
    }
  }
}
