import type { CapturePointState, MapObjective, Vec3 } from '@clawfield/shared';

/** Team colors (CSS hex strings) */
const COLOR_ALPHA = '#3498db'; // blue
const COLOR_BRAVO = '#e74c3c'; // red
const COLOR_NEUTRAL = '#cccccc'; // gray

/** Local player indicator color */
const COLOR_LOCAL_PLAYER = '#ffffff';

/** Background color with alpha */
const COLOR_BACKGROUND = 'rgba(0, 0, 0, 0.55)';

/** Border color */
const COLOR_BORDER = 'rgba(255, 255, 255, 0.2)';

/** Player dot radius in canvas pixels */
const DOT_RADIUS = 3;

/** Capture point marker radius in canvas pixels */
const CAPTURE_POINT_RADIUS = 6;

/** Objective marker radius in canvas pixels */
const OBJECTIVE_RADIUS = 5;

/** Local player triangle size in canvas pixels */
const TRIANGLE_SIZE = 6;

/** Capture point labels by index (alphabetical) */
const POINT_LABELS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** Objective marker color */
const COLOR_OBJECTIVE = '#f6c343';

export interface MinimapConfig {
  /** Canvas size in pixels */
  size: number;
  /** World units shown in the minimap (how zoomed in) */
  worldScale: number;
}

const DEFAULT_CONFIG: MinimapConfig = {
  size: 150,
  worldScale: 100,
};

/**
 * HTML Canvas minimap overlay positioned in the bottom-right corner.
 *
 * Shows:
 * - Capture points as colored circles with letter labels
 * - Friendly players as blue dots
 * - Enemy players as red dots (within view range)
 * - Local player as a white triangle pointing in look direction
 *
 * The map rotates so the local player always faces up.
 */
export class Minimap {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private config: MinimapConfig;

  /** Pixels per world unit */
  private scale: number;

  /** Spotted enemy positions from the SpottingScope gadget */
  private spottedPositions: Vec3[] = [];
  private spottedExpiry = 0;

  constructor(config?: Partial<MinimapConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.scale = this.config.size / this.config.worldScale;

    // Create the canvas element
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.config.size;
    this.canvas.height = this.config.size;

    // Position in bottom-right corner
    this.canvas.style.position = 'fixed';
    this.canvas.style.bottom = '16px';
    this.canvas.style.right = '16px';
    this.canvas.style.zIndex = '100';
    this.canvas.style.pointerEvents = 'none';
    this.canvas.style.borderRadius = '4px';
    this.canvas.style.border = `1px solid ${COLOR_BORDER}`;

    const ctx = this.canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Minimap: failed to get 2D canvas context');
    }
    this.ctx = ctx;

    document.body.appendChild(this.canvas);
  }

  /**
   * Redraw the minimap. Called every frame from the game loop.
   *
   * @param localPlayerPos - World position of the local player
   * @param localPlayerYaw - Yaw in radians (0 = looking along -Z, increases CW from above)
   * @param localTeam - Team index of the local player (0 = Alpha, 1 = Bravo)
   * @param players - All other visible players
   * @param capturePoints - Current capture point states
   */
  update(
    localPlayerPos: Vec3,
    localPlayerYaw: number,
    localTeam: number,
    players: Array<{ position: Vec3; team: number; alive: boolean }>,
    capturePoints: CapturePointState[],
    objectives: MapObjective[] = [],
  ): void {
    const { ctx, config, scale } = this;
    const half = config.size / 2;

    // Clear canvas
    ctx.clearRect(0, 0, config.size, config.size);

    // Draw background
    ctx.fillStyle = COLOR_BACKGROUND;
    ctx.fillRect(0, 0, config.size, config.size);

    // Set up rotation: rotate so player faces up
    // The yaw convention: 0 = looking along -Z. We rotate the map by -yaw
    // so that the player's forward direction points up on the minimap.
    ctx.save();
    ctx.translate(half, half);
    ctx.rotate(-localPlayerYaw);

    // --- Draw capture points ---
    for (let i = 0; i < capturePoints.length; i++) {
      const cp = capturePoints[i]!;
      const dx = (cp.position.x - localPlayerPos.x) * scale;
      const dz = (cp.position.z - localPlayerPos.z) * scale;

      // Skip if outside minimap bounds (with some margin for the marker)
      if (Math.abs(dx) > half + CAPTURE_POINT_RADIUS || Math.abs(dz) > half + CAPTURE_POINT_RADIUS) {
        continue;
      }

      const color = this.teamColor(cp.owner);

      // Draw filled circle
      ctx.beginPath();
      ctx.arc(dx, dz, CAPTURE_POINT_RADIUS, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.globalAlpha = 0.7;
      ctx.fill();
      ctx.globalAlpha = 1;

      // Draw border
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1;
      ctx.stroke();

      // Draw label letter (rotated back so text is always upright)
      ctx.save();
      ctx.rotate(localPlayerYaw); // counter-rotate text
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 8px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      // Rotate the text position back into the rotated frame
      const label = i < POINT_LABELS.length ? POINT_LABELS[i]! : '?';
      // We need to compute where the text position is after counter-rotation
      const cosR = Math.cos(localPlayerYaw);
      const sinR = Math.sin(localPlayerYaw);
      const textX = dx * cosR - dz * sinR;
      const textY = dx * sinR + dz * cosR;
      ctx.fillText(label, textX, textY);
      ctx.restore();
    }

    // --- Draw map objectives ---
    for (const objective of objectives) {
      const dx = (objective.position.x - localPlayerPos.x) * scale;
      const dz = (objective.position.z - localPlayerPos.z) * scale;
      if (Math.abs(dx) > half + OBJECTIVE_RADIUS || Math.abs(dz) > half + OBJECTIVE_RADIUS) {
        continue;
      }

      ctx.beginPath();
      ctx.moveTo(dx, dz - OBJECTIVE_RADIUS);
      ctx.lineTo(dx + OBJECTIVE_RADIUS, dz);
      ctx.lineTo(dx, dz + OBJECTIVE_RADIUS);
      ctx.lineTo(dx - OBJECTIVE_RADIUS, dz);
      ctx.closePath();
      ctx.fillStyle = COLOR_OBJECTIVE;
      ctx.globalAlpha = 0.9;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = '#222222';
      ctx.lineWidth = 1;
      ctx.stroke();

      ctx.save();
      ctx.rotate(localPlayerYaw);
      ctx.fillStyle = '#111111';
      ctx.font = 'bold 8px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const cosR = Math.cos(localPlayerYaw);
      const sinR = Math.sin(localPlayerYaw);
      const textX = dx * cosR - dz * sinR;
      const textY = dx * sinR + dz * cosR;
      const label = objective.id.length > 0 ? objective.id[0]!.toUpperCase() : '?';
      ctx.fillText(label, textX, textY);
      ctx.restore();
    }

    // --- Draw other players ---
    for (const player of players) {
      if (!player.alive) continue;

      const dx = (player.position.x - localPlayerPos.x) * scale;
      const dz = (player.position.z - localPlayerPos.z) * scale;

      // Skip if outside minimap bounds
      if (Math.abs(dx) > half || Math.abs(dz) > half) {
        continue;
      }

      const isFriendly = player.team === localTeam;
      ctx.beginPath();
      ctx.arc(dx, dz, DOT_RADIUS, 0, Math.PI * 2);
      ctx.fillStyle = isFriendly ? COLOR_ALPHA : COLOR_BRAVO;
      ctx.fill();
    }

    // --- Draw spotted enemies (orange pulsing dots) ---
    if (performance.now() < this.spottedExpiry) {
      for (const pos of this.spottedPositions) {
        const dx = (pos.x - localPlayerPos.x) * scale;
        const dz = (pos.z - localPlayerPos.z) * scale;
        if (Math.abs(dx) > half || Math.abs(dz) > half) continue;

        // Pulsing orange dot
        const pulse = 0.6 + 0.4 * Math.sin(performance.now() / 200);
        ctx.beginPath();
        ctx.arc(dx, dz, DOT_RADIUS + 1, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255, 165, 0, ${pulse})`;
        ctx.fill();
        ctx.strokeStyle = '#ff8800';
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }

    ctx.restore();

    // --- Draw local player (always at center, always facing up) ---
    this.drawPlayerTriangle(half, half, COLOR_LOCAL_PLAYER);

    // --- Draw border on top ---
    ctx.strokeStyle = COLOR_BORDER;
    ctx.lineWidth = 1;
    ctx.strokeRect(0, 0, config.size, config.size);
  }

  /** Update spotted enemy positions from server */
  setSpottedEnemies(positions: Vec3[], duration: number): void {
    this.spottedPositions = positions;
    this.spottedExpiry = performance.now() + duration * 1000;
  }

  /** Remove the minimap canvas from the DOM. */
  dispose(): void {
    this.canvas.remove();
  }

  // ── Private helpers ─────────────────────────────────────────────

  /** Draw a small triangle pointing up at the given canvas position. */
  private drawPlayerTriangle(cx: number, cy: number, color: string): void {
    const { ctx } = this;
    const s = TRIANGLE_SIZE;

    ctx.save();
    ctx.translate(cx, cy);

    ctx.beginPath();
    // Triangle pointing up
    ctx.moveTo(0, -s);           // top vertex
    ctx.lineTo(-s * 0.6, s * 0.5); // bottom-left
    ctx.lineTo(s * 0.6, s * 0.5);  // bottom-right
    ctx.closePath();

    ctx.fillStyle = color;
    ctx.fill();

    ctx.strokeStyle = 'rgba(0, 0, 0, 0.5)';
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.restore();
  }

  /** Map owner team index to a CSS color string. */
  private teamColor(owner: number): string {
    if (owner === 0) return COLOR_ALPHA;
    if (owner === 1) return COLOR_BRAVO;
    return COLOR_NEUTRAL;
  }
}
