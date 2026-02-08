import type { Vec3 } from '@clawfield/shared';

interface DamageIndicator {
  angle: number;  // relative angle in radians
  opacity: number;
  lifetime: number;
}

const INDICATOR_LIFETIME = 2.0;  // seconds
const MAX_INDICATORS = 8;

/**
 * Renders directional damage indicators around the crosshair.
 * Red wedge arrows point toward the source of incoming damage,
 * fading out over INDICATOR_LIFETIME seconds.
 */
export class DamageIndicatorSystem {
  private indicators: DamageIndicator[] = [];
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = 200;
    this.canvas.height = 200;
    this.canvas.style.cssText = `
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      pointer-events: none;
      z-index: 110;
    `;
    document.body.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d')!;
  }

  /** Called when we receive damage with a known source position */
  addHit(sourcePos: Vec3, myPos: Vec3, myYaw: number): void {
    // Calculate world angle from player to attacker
    const worldAngle = Math.atan2(sourcePos.x - myPos.x, -(sourcePos.z - myPos.z));
    const relativeAngle = worldAngle - myYaw;

    // Check if there's an existing indicator at a similar angle — boost its opacity
    for (const ind of this.indicators) {
      let angleDiff = ind.angle - relativeAngle;
      // Normalize to [-PI, PI]
      angleDiff = ((angleDiff + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
      if (Math.abs(angleDiff) < 0.3) {
        ind.opacity = Math.min(1.0, ind.opacity + 0.3);
        ind.lifetime = INDICATOR_LIFETIME;
        return;
      }
    }

    if (this.indicators.length >= MAX_INDICATORS) {
      this.indicators.shift();
    }

    this.indicators.push({
      angle: relativeAngle,
      opacity: 0.7,
      lifetime: INDICATOR_LIFETIME,
    });
  }

  update(dt: number): void {
    // Update lifetimes
    for (let i = this.indicators.length - 1; i >= 0; i--) {
      const ind = this.indicators[i]!;
      ind.lifetime -= dt;
      ind.opacity = Math.max(0, (ind.lifetime / INDICATOR_LIFETIME) * 0.7);
      if (ind.lifetime <= 0) {
        this.indicators.splice(i, 1);
      }
    }

    // Render
    const { ctx, canvas } = this;
    const cx = canvas.width / 2;
    const cy = canvas.height / 2;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    for (const ind of this.indicators) {
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(ind.angle);

      // Draw a red wedge/arrow pointing inward from the edge
      ctx.beginPath();
      ctx.moveTo(-8, -70);
      ctx.lineTo(0, -85);
      ctx.lineTo(8, -70);
      ctx.closePath();
      ctx.fillStyle = `rgba(255, 0, 0, ${ind.opacity})`;
      ctx.fill();

      ctx.restore();
    }
  }

  dispose(): void {
    this.canvas.remove();
  }
}
