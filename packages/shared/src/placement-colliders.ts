import type { PlacementCollider } from './types.js';

export interface PlacementLike {
  componentId: string;
  position: [number, number, number];
  scale: [number, number, number];
  metadata?: {
    collidable?: boolean;
    destructible?: boolean;
    [key: string]: unknown;
  };
}

function inferDestructible(componentId: string): boolean {
  const id = componentId.toLowerCase();
  return (
    id.includes('rock') ||
    id.includes('stone') ||
    id.includes('boulder') ||
    id.includes('prop')
  );
}

function inferBaseRadius(componentId: string): number {
  const id = componentId.toLowerCase();
  if (
    id.includes('flower') ||
    id.includes('grass') ||
    id.includes('fern') ||
    id.includes('bush') ||
    id.includes('plant') ||
    id.includes('mushroom') ||
    id.includes('lavender') ||
    id.includes('sunflower') ||
    id.includes('pebble')
  ) return 0;
  if (id.includes('tree') || id.includes('pine') || id.includes('birch') || id.includes('maple')) return 0.9;
  if (id.includes('rock') || id.includes('stone') || id.includes('boulder')) return 0.8;
  if (id.includes('building') || id.includes('house')) return 2.2;
  if (id.includes('wall')) return 1.6;
  return 0.7;
}

export function buildPlacementColliders(placements: PlacementLike[]): PlacementCollider[] {
  const out: PlacementCollider[] = [];

  for (let i = 0; i < placements.length; i++) {
    const p = placements[i];
    const explicit = p.metadata?.collidable;
    if (explicit === false) continue;

    const inferred = inferBaseRadius(p.componentId);
    const base = inferred > 0 ? inferred : explicit === true ? 0.7 : 0;
    if (base <= 0) continue;

    const sx = Math.abs(p.scale?.[0] ?? 1);
    const sz = Math.abs(p.scale?.[2] ?? 1);
    const r = base * Math.max(0.5, Math.max(sx, sz));

    out.push({
      id: `${p.componentId}-${i}`,
      x: p.position[0],
      z: p.position[2],
      r,
      destructible: p.metadata?.destructible === true || inferDestructible(p.componentId),
    });
  }

  return out;
}
