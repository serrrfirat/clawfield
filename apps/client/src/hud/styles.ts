/**
 * HUD Stylesheet — injected at runtime into <head>.
 * All HUD elements use position:fixed so they overlay the 3D canvas.
 */

const CSS = /* css */ `
/* ───────────────── Base ───────────────── */

.hud-root {
  position: fixed;
  inset: 0;
  pointer-events: none;
  font-family: monospace;
  color: #fff;
  z-index: 100;
  user-select: none;
}

/* ───────────────── Health bar (bottom-left) ───────────────── */

.hud-health {
  position: fixed;
  bottom: 24px;
  left: 24px;
  width: 200px;
  z-index: 100;
}

.hud-health-bar-bg {
  width: 100%;
  height: 22px;
  background: rgba(0, 0, 0, 0.5);
  border: 1px solid rgba(255, 255, 255, 0.15);
  position: relative;
  overflow: hidden;
}

.hud-health-bar-fill {
  height: 100%;
  transition: width 0.15s ease, background-color 0.3s ease;
}

.hud-health-text {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  font-weight: bold;
  text-shadow: 1px 1px 2px rgba(0, 0, 0, 0.8);
  letter-spacing: 1px;
}

/* ───────────────── Ammo counter (bottom-right) ───────────────── */

.hud-ammo {
  position: fixed;
  bottom: 24px;
  right: 24px;
  text-align: right;
  z-index: 100;
}

.hud-ammo-count {
  font-size: 36px;
  font-weight: bold;
  text-shadow: 2px 2px 4px rgba(0, 0, 0, 0.8);
  line-height: 1;
}

.hud-ammo-count span {
  font-size: 18px;
  opacity: 0.7;
}

.hud-ammo-reload {
  font-size: 14px;
  color: #f1c40f;
  font-weight: bold;
  letter-spacing: 2px;
  margin-top: 2px;
  visibility: hidden;
}

.hud-ammo-reload.visible {
  visibility: visible;
  animation: hud-blink 0.6s infinite;
}

.hud-ammo-class {
  font-size: 11px;
  opacity: 0.6;
  text-transform: uppercase;
  letter-spacing: 2px;
  margin-top: 4px;
}

@keyframes hud-blink {
  0%, 100% { opacity: 1; }
  50%      { opacity: 0.3; }
}

/* ───────────────── Team tickets (top-center) ───────────────── */

.hud-tickets {
  position: fixed;
  top: 16px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 12px;
  background: rgba(0, 0, 0, 0.5);
  padding: 6px 18px;
  font-size: 15px;
  font-weight: bold;
  letter-spacing: 1px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  z-index: 100;
}

.hud-tickets-alpha {
  color: #3498db;
}

.hud-tickets-bravo {
  color: #e74c3c;
}

.hud-tickets-sep {
  opacity: 0.4;
}

.hud-tickets-highlight {
  text-decoration: underline;
  text-underline-offset: 3px;
}

/* ───────────────── Kill feed (top-right) ───────────────── */

.hud-killfeed {
  position: fixed;
  top: 16px;
  right: 16px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  z-index: 100;
  max-width: 340px;
}

.hud-killfeed-entry {
  background: rgba(0, 0, 0, 0.5);
  padding: 4px 10px;
  font-size: 12px;
  white-space: nowrap;
  opacity: 1;
  transition: opacity 0.4s ease;
  border: 1px solid rgba(255, 255, 255, 0.05);
}

.hud-killfeed-entry.fading {
  opacity: 0;
}

.hud-killfeed-weapon {
  opacity: 0.5;
  margin: 0 6px;
}

.hud-killfeed-alpha {
  color: #3498db;
}

.hud-killfeed-bravo {
  color: #e74c3c;
}

/* ───────────────── Hit marker (center) ───────────────── */

.hud-hitmarker {
  position: fixed;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 20px;
  height: 20px;
  z-index: 150;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.05s ease;
}

.hud-hitmarker.visible {
  opacity: 1;
}

.hud-hitmarker::before,
.hud-hitmarker::after {
  content: '';
  position: absolute;
  background: #fff;
}

/* Top-left to bottom-right stroke */
.hud-hitmarker::before {
  width: 2px;
  height: 20px;
  top: 0;
  left: 50%;
  transform: translateX(-50%) rotate(45deg);
}

/* Top-right to bottom-left stroke */
.hud-hitmarker::after {
  width: 2px;
  height: 20px;
  top: 0;
  left: 50%;
  transform: translateX(-50%) rotate(-45deg);
}

/* ───────────────── Death overlay (center) ───────────────── */

.hud-death {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.65);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  z-index: 200;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.3s ease;
}

.hud-death.visible {
  opacity: 1;
  pointer-events: auto;
}

.hud-death-title {
  font-size: 48px;
  font-weight: bold;
  color: #e74c3c;
  letter-spacing: 6px;
  text-shadow: 2px 2px 8px rgba(0, 0, 0, 0.9);
  margin-bottom: 16px;
}

.hud-death-killer {
  font-size: 18px;
  color: #e74c3c;
  margin-bottom: 8px;
  letter-spacing: 1px;
  display: none;
}

.hud-death-countdown {
  font-size: 20px;
  opacity: 0.8;
  letter-spacing: 2px;
}

/* ───────────────── Game over overlay ───────────────── */

.hud-gameover {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.75);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 200;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.4s ease;
}

.hud-gameover.visible {
  opacity: 1;
  pointer-events: auto;
}

.hud-gameover-text {
  font-size: 64px;
  font-weight: bold;
  letter-spacing: 8px;
  text-shadow: 2px 4px 12px rgba(0, 0, 0, 0.9);
}

.hud-gameover-victory {
  color: #2ecc71;
}

.hud-gameover-defeat {
  color: #e74c3c;
}

/* ───────────────── Gadget indicator (bottom-left, above health) ───────────────── */

.hud-gadget {
  position: fixed;
  bottom: 56px;
  left: 24px;
  width: 200px;
  z-index: 100;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.hud-gadget-name {
  font-size: 12px;
  font-weight: bold;
  letter-spacing: 1px;
  text-shadow: 1px 1px 2px rgba(0, 0, 0, 0.8);
  text-transform: uppercase;
}

.hud-gadget-cooldown {
  width: 100%;
  height: 6px;
  background: rgba(0, 0, 0, 0.5);
  border: 1px solid rgba(255, 255, 255, 0.1);
  overflow: hidden;
}

.hud-gadget-cooldown-fill {
  height: 100%;
  transition: width 0.15s ease, background-color 0.3s ease;
}

.hud-gadget-key {
  font-size: 10px;
  opacity: 0.6;
  letter-spacing: 1px;
}
`;

let injected = false;

/**
 * Inject all HUD styles into the document head.
 * Safe to call multiple times — only injects once.
 */
export function injectHUDStyles(): void {
  if (injected) return;
  injected = true;

  const style = document.createElement('style');
  style.setAttribute('data-hud', '');
  style.textContent = CSS;
  document.head.appendChild(style);
}
