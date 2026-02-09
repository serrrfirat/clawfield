/**
 * HUD Stylesheet — injected at runtime into <head>.
 * BattleBit-inspired military FPS aesthetic.
 * All HUD elements use position:fixed so they overlay the 3D canvas.
 */

const CSS = /* css */ `
/* ───────────────── Base ───────────────── */

.hud-root {
  position: fixed;
  inset: 0;
  pointer-events: none;
  font-family: 'Segoe UI', 'Helvetica Neue', Arial, sans-serif;
  color: #fff;
  z-index: 100;
  user-select: none;
}

/* ───────────────── Health bar (bottom-left) ───────────────── */

.hud-health {
  position: fixed;
  bottom: 24px;
  left: 24px;
  width: 220px;
  z-index: 100;
}

.hud-health-bar-bg {
  width: 100%;
  height: 24px;
  background: rgba(0, 0, 0, 0.6);
  border: 1px solid rgba(255, 255, 255, 0.12);
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
  font-size: 14px;
  font-weight: 700;
  text-shadow: 1px 1px 2px rgba(0, 0, 0, 0.9);
  letter-spacing: 1px;
}

/* ───────────────── Class label (bottom-left, above health) ───────────────── */

.hud-class-label {
  position: fixed;
  bottom: 86px;
  left: 24px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 2px;
  text-transform: uppercase;
  opacity: 0.6;
  text-shadow: 1px 1px 2px rgba(0, 0, 0, 0.8);
}

/* ───────────────── Ammo (bottom-right) ───────────────── */

.hud-ammo {
  position: fixed;
  bottom: 24px;
  right: 24px;
  text-align: right;
  z-index: 100;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 6px;
}

.hud-weapon-name {
  font-size: 16px;
  font-weight: 700;
  letter-spacing: 2px;
  text-shadow: 2px 2px 4px rgba(0, 0, 0, 0.8);
  text-transform: uppercase;
}

.hud-ammo-bars {
  display: flex;
  gap: 1px;
  align-items: flex-end;
  height: 20px;
}

.hud-ammo-bar {
  width: 3px;
  height: 16px;
  background: rgba(255, 255, 255, 0.9);
  transition: background 0.1s ease, height 0.1s ease;
}

.hud-ammo-bar.empty {
  background: rgba(255, 255, 255, 0.15);
  height: 10px;
}

.hud-ammo-reload {
  font-size: 13px;
  color: #f1c40f;
  font-weight: 700;
  letter-spacing: 2px;
  visibility: hidden;
}

.hud-ammo-reload.visible {
  visibility: visible;
  animation: hud-blink 0.6s infinite;
}

@keyframes hud-blink {
  0%, 100% { opacity: 1; }
  50%      { opacity: 0.3; }
}

/* ───────────────── Compass (bottom-center) ───────────────── */

.hud-compass {
  position: fixed;
  bottom: 24px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 100;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
}

.hud-compass-heading {
  font-size: 18px;
  font-weight: 700;
  letter-spacing: 1px;
  text-shadow: 1px 1px 3px rgba(0, 0, 0, 0.9);
}

.hud-compass-strip {
  display: flex;
  align-items: center;
  gap: 0;
  height: 18px;
  overflow: hidden;
  white-space: nowrap;
}

.hud-compass-strip > span {
  display: inline-block;
  width: 18px;
  text-align: center;
  font-size: 10px;
  opacity: 0.6;
  text-shadow: 1px 1px 2px rgba(0, 0, 0, 0.8);
}

.hud-compass-label {
  font-weight: 700;
  font-size: 12px !important;
  opacity: 1 !important;
  color: #f6c343;
}

.hud-compass-major {
  font-weight: 600;
  font-size: 10px;
  opacity: 0.8 !important;
}

.hud-compass-tick {
  opacity: 0.3 !important;
  font-size: 8px !important;
}

.hud-compass-center {
  position: absolute;
  bottom: 0;
  left: 50%;
  transform: translateX(-50%);
  width: 2px;
  height: 22px;
  background: rgba(255, 255, 255, 0.7);
  pointer-events: none;
}

/* ───────────────── Team tickets (top-center) ───────────────── */

.hud-tickets {
  position: fixed;
  top: 12px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 16px;
  background: rgba(0, 0, 0, 0.55);
  padding: 8px 24px;
  font-size: 14px;
  font-weight: 700;
  letter-spacing: 1px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  z-index: 100;
}

.hud-tickets-alpha {
  color: #4aa3df;
}

.hud-tickets-bravo {
  color: #e74c3c;
}

.hud-tickets-sep {
  opacity: 0.25;
  font-weight: 300;
}

.hud-tickets-highlight {
  text-decoration: underline;
  text-underline-offset: 4px;
  text-decoration-thickness: 2px;
}

/* ───────────────── Kill feed (top-right) ───────────────── */

.hud-killfeed {
  position: fixed;
  top: 48px;
  right: 16px;
  display: flex;
  flex-direction: column;
  gap: 3px;
  z-index: 100;
  max-width: 360px;
}

.hud-killfeed-entry {
  background: rgba(0, 0, 0, 0.5);
  padding: 4px 12px;
  font-size: 12px;
  white-space: nowrap;
  opacity: 1;
  transition: opacity 0.4s ease;
  border-left: 2px solid rgba(255, 255, 255, 0.15);
}

.hud-killfeed-entry.fading {
  opacity: 0;
}

.hud-killfeed-weapon {
  opacity: 0.45;
  margin: 0 6px;
  font-size: 11px;
}

.hud-killfeed-alpha {
  color: #4aa3df;
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
  font-weight: 700;
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

/* ───────────────── Revive progress bar (downed state) ───────────────── */

.hud-revive-bar {
  width: 300px;
  height: 16px;
  background: rgba(0, 0, 0, 0.6);
  border: 1px solid rgba(255, 255, 255, 0.2);
  margin-top: 20px;
  overflow: hidden;
  display: none;
}

.hud-revive-fill {
  height: 100%;
  width: 0%;
  background: #2ecc71;
  transition: width 0.1s linear;
}

.hud-revive-text {
  font-size: 16px;
  color: #f39c12;
  margin-top: 8px;
  letter-spacing: 1px;
  display: none;
}

/* ───────────────── Revive prompt (for alive players near downed teammate) ───────────────── */

.hud-revive-prompt {
  position: fixed;
  bottom: 40%;
  left: 50%;
  transform: translateX(-50%);
  background: rgba(0, 0, 0, 0.6);
  padding: 8px 20px;
  font-size: 16px;
  font-weight: bold;
  color: #2ecc71;
  letter-spacing: 1px;
  border: 1px solid rgba(46, 204, 113, 0.3);
  z-index: 120;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.2s ease;
}

.hud-revive-prompt.visible {
  opacity: 1;
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
  font-weight: 700;
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
  width: 220px;
  z-index: 100;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.hud-gadget-name {
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 1px;
  text-shadow: 1px 1px 2px rgba(0, 0, 0, 0.8);
  text-transform: uppercase;
}

.hud-gadget-cooldown {
  width: 100%;
  height: 5px;
  background: rgba(0, 0, 0, 0.5);
  border: 1px solid rgba(255, 255, 255, 0.08);
  overflow: hidden;
}

.hud-gadget-cooldown-fill {
  height: 100%;
  transition: width 0.15s ease, background-color 0.3s ease;
}

.hud-gadget-key {
  font-size: 10px;
  opacity: 0.5;
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
