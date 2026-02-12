import * as THREE from 'three';
import {
  MAT_GRASS, MAT_DIRT, MAT_STONE, MAT_WALL, MAT_ROOF, MAT_WATER,
  MAT_SAND_LIGHT, MAT_SAND_DARK, MAT_GRASS_DARK, MAT_STONE_DARK,
  MAT_CONCRETE, MAT_CONCRETE_DARK, MAT_WOOD, MAT_WOOD_DARK,
  MAT_BRICK, MAT_ROOF_TILE, MAT_WATER_DEEP, MAT_ROAD,
  MAT_WINDOW, MAT_METAL,
  MATERIAL_COLORS,
} from '@clawfield/shared';

/**
 * Texture atlas configuration.
 *
 * The atlas is a grid of square tiles. Each material occupies up to 3 tiles:
 * top face, side face, bottom face (some materials use the same tile for all).
 *
 * Atlas layout (ATLAS_COLS × ATLAS_ROWS grid of TILE_SIZE×TILE_SIZE tiles):
 *   Row 0: grass_top, grass_side, dirt, stone, wall, roof, water, fallback
 *   Row 1: sand_light, sand_dark, grass_dark, stone_dark, concrete, concrete_dark, wood, wood_dark
 *   Row 2: brick, roof_tile, water_deep, road, window, metal
 */

export const TILE_SIZE = 32; // pixels per tile (upgraded from 16 for crisper textures)
export const ATLAS_COLS = 8;
export const ATLAS_ROWS = 4;
export const ATLAS_WIDTH = TILE_SIZE * ATLAS_COLS;
export const ATLAS_HEIGHT = TILE_SIZE * ATLAS_ROWS;

/** Which tile (col, row) in the atlas each material face uses: [top, side, bottom] */
export interface TileMapping {
  top: [number, number];
  side: [number, number];
  bottom: [number, number];
}

export const MATERIAL_TILES: Record<number, TileMapping> = {
  [MAT_GRASS]: {
    top: [0, 0],    // grass top (green with blades)
    side: [1, 0],   // grass side (green strip over dirt)
    bottom: [2, 0], // dirt
  },
  [MAT_DIRT]: {
    top: [2, 0],
    side: [2, 0],
    bottom: [2, 0],
  },
  [MAT_STONE]: {
    top: [3, 0],
    side: [3, 0],
    bottom: [3, 0],
  },
  [MAT_WALL]: {
    top: [4, 0],
    side: [4, 0],
    bottom: [4, 0],
  },
  [MAT_ROOF]: {
    top: [5, 0],
    side: [5, 0],
    bottom: [5, 0],
  },
  [MAT_WATER]: {
    top: [6, 0],
    side: [6, 0],
    bottom: [6, 0],
  },
  [MAT_SAND_LIGHT]: {
    top: [0, 1],
    side: [0, 1],
    bottom: [0, 1],
  },
  [MAT_SAND_DARK]: {
    top: [1, 1],
    side: [1, 1],
    bottom: [1, 1],
  },
  [MAT_GRASS_DARK]: {
    top: [2, 1],
    side: [2, 1],
    bottom: [2, 1],
  },
  [MAT_STONE_DARK]: {
    top: [3, 1],
    side: [3, 1],
    bottom: [3, 1],
  },
  [MAT_CONCRETE]: {
    top: [4, 1],
    side: [4, 1],
    bottom: [4, 1],
  },
  [MAT_CONCRETE_DARK]: {
    top: [5, 1],
    side: [5, 1],
    bottom: [5, 1],
  },
  [MAT_WOOD]: {
    top: [6, 1],
    side: [6, 1],
    bottom: [6, 1],
  },
  [MAT_WOOD_DARK]: {
    top: [7, 1],
    side: [7, 1],
    bottom: [7, 1],
  },
  [MAT_BRICK]: {
    top: [0, 2],
    side: [0, 2],
    bottom: [0, 2],
  },
  [MAT_ROOF_TILE]: {
    top: [1, 2],
    side: [1, 2],
    bottom: [1, 2],
  },
  [MAT_WATER_DEEP]: {
    top: [2, 2],
    side: [2, 2],
    bottom: [2, 2],
  },
  [MAT_ROAD]: {
    top: [3, 2],
    side: [3, 2],
    bottom: [3, 2],
  },
  [MAT_WINDOW]: {
    top: [4, 2],
    side: [4, 2],
    bottom: [4, 2],
  },
  [MAT_METAL]: {
    top: [5, 2],
    side: [5, 2],
    bottom: [5, 2],
  },
};

/** Fallback tile for unknown materials */
export const FALLBACK_TILE: [number, number] = [7, 0];

/**
 * Get the tile coordinates for a material + face direction.
 * face: 0=+X, 1=-X, 2=+Y (top), 3=-Y (bottom), 4=+Z, 5=-Z
 */
export function getTileForFace(material: number, face: number): [number, number] {
  const mapping = MATERIAL_TILES[material];
  if (!mapping) return FALLBACK_TILE;
  if (face === 2) return mapping.top;
  if (face === 3) return mapping.bottom;
  return mapping.side;
}

// --- Seeded pseudo-random for deterministic texture generation ---
function mulberry32(seed: number): () => number {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Paths to the pre-built atlas PNGs (built by tools/build-atlas.ts) */
const ATLAS_PNG_PATH = '/textures/atlas.png';
const NORMAL_ATLAS_PNG_PATH = '/textures/atlas-normal.png';

/**
 * Load the texture atlas from a PNG file.
 * Returns a THREE.Texture immediately; the image loads asynchronously.
 * Falls back to a procedural white canvas if the PNG fails to load.
 */
export function createTextureAtlas(): THREE.Texture {
  const loader = new THREE.TextureLoader();
  const texture = loader.load(
    ATLAS_PNG_PATH,
    (tex) => {
      tex.needsUpdate = true;
      console.log('Texture atlas loaded from PNG');
    },
    undefined,
    (err) => {
      console.warn('Failed to load atlas PNG, using fallback:', err);
    },
  );
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  // flipY=false so t=0 maps to image top (Row 0), matching tile row indices.
  // CanvasTexture with flipY=true happened to work because browsers handle
  // UNPACK_FLIP_Y_WEBGL differently for canvas vs image sources.
  texture.flipY = false;
  return texture;
}

/**
 * Load the normal map atlas from a PNG file.
 * Same layout as the color atlas but encodes tangent-space normals.
 */
export function createNormalAtlas(): THREE.Texture {
  const loader = new THREE.TextureLoader();
  const texture = loader.load(
    NORMAL_ATLAS_PNG_PATH,
    (tex) => {
      tex.needsUpdate = true;
      console.log('Normal atlas loaded from PNG');
    },
    undefined,
    (err) => {
      console.warn('Failed to load normal atlas PNG:', err);
    },
  );
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  // Normal maps are linear data, not sRGB
  texture.colorSpace = THREE.LinearSRGBColorSpace;
  texture.flipY = false;
  return texture;
}

// --- Tile drawing helpers ---

function hexToRgb(hex: number): [number, number, number] {
  return [(hex >> 16) & 0xff, (hex >> 8) & 0xff, hex & 0xff];
}

function rgbStr(r: number, g: number, b: number): string {
  return `rgb(${r},${g},${b})`;
}

function fillTile(ctx: CanvasRenderingContext2D, col: number, row: number, hex: number): void {
  const [r, g, b] = hexToRgb(hex);
  ctx.fillStyle = rgbStr(r, g, b);
  ctx.fillRect(col * TILE_SIZE, row * TILE_SIZE, TILE_SIZE, TILE_SIZE);
}

function drawGrassTop(ctx: CanvasRenderingContext2D, col: number, row: number): void {
  const ox = col * TILE_SIZE;
  const oy = row * TILE_SIZE;
  const [br, bg, bb] = hexToRgb(0x4a8c3f);
  const rng = mulberry32(42);

  // Base green
  ctx.fillStyle = rgbStr(br, bg, bb);
  ctx.fillRect(ox, oy, TILE_SIZE, TILE_SIZE);

  // Scattered lighter/darker pixels for grass texture
  for (let y = 0; y < TILE_SIZE; y++) {
    for (let x = 0; x < TILE_SIZE; x++) {
      const v = rng();
      if (v < 0.3) {
        const shift = Math.floor((rng() - 0.5) * 40);
        const r = Math.max(0, Math.min(255, br + shift));
        const g = Math.max(0, Math.min(255, bg + shift + Math.floor(rng() * 15)));
        const b = Math.max(0, Math.min(255, bb + shift));
        ctx.fillStyle = rgbStr(r, g, b);
        ctx.fillRect(ox + x, oy + y, 1, 1);
      }
    }
  }
}

function drawGrassSide(ctx: CanvasRenderingContext2D, col: number, row: number): void {
  const ox = col * TILE_SIZE;
  const oy = row * TILE_SIZE;
  const rng = mulberry32(99);

  // Bottom 3/4 is dirt
  const [dr, dg, db] = hexToRgb(0x7a5c3a);
  ctx.fillStyle = rgbStr(dr, dg, db);
  ctx.fillRect(ox, oy, TILE_SIZE, TILE_SIZE);

  // Add dirt noise
  for (let y = 4; y < TILE_SIZE; y++) {
    for (let x = 0; x < TILE_SIZE; x++) {
      if (rng() < 0.25) {
        const shift = Math.floor((rng() - 0.5) * 30);
        ctx.fillStyle = rgbStr(
          Math.max(0, Math.min(255, dr + shift)),
          Math.max(0, Math.min(255, dg + shift)),
          Math.max(0, Math.min(255, db + shift)),
        );
        ctx.fillRect(ox + x, oy + y, 1, 1);
      }
    }
  }

  // Top strip is grass green with uneven edge
  const [gr, gg, gb] = hexToRgb(0x4a8c3f);
  for (let x = 0; x < TILE_SIZE; x++) {
    const depth = 3 + Math.floor(rng() * 3);
    for (let y = 0; y < depth; y++) {
      const shift = Math.floor((rng() - 0.5) * 20);
      ctx.fillStyle = rgbStr(
        Math.max(0, Math.min(255, gr + shift)),
        Math.max(0, Math.min(255, gg + shift)),
        Math.max(0, Math.min(255, gb + shift)),
      );
      ctx.fillRect(ox + x, oy + y, 1, 1);
    }
  }
}

function drawDirt(ctx: CanvasRenderingContext2D, col: number, row: number): void {
  const ox = col * TILE_SIZE;
  const oy = row * TILE_SIZE;
  const [br, bg, bb] = hexToRgb(0x7a5c3a);
  const rng = mulberry32(200);

  ctx.fillStyle = rgbStr(br, bg, bb);
  ctx.fillRect(ox, oy, TILE_SIZE, TILE_SIZE);

  for (let y = 0; y < TILE_SIZE; y++) {
    for (let x = 0; x < TILE_SIZE; x++) {
      if (rng() < 0.35) {
        const shift = Math.floor((rng() - 0.5) * 35);
        ctx.fillStyle = rgbStr(
          Math.max(0, Math.min(255, br + shift)),
          Math.max(0, Math.min(255, bg + shift)),
          Math.max(0, Math.min(255, bb + shift)),
        );
        ctx.fillRect(ox + x, oy + y, 1, 1);
      }
    }
  }
}

function drawStone(ctx: CanvasRenderingContext2D, col: number, row: number): void {
  const ox = col * TILE_SIZE;
  const oy = row * TILE_SIZE;
  const rng = mulberry32(300);
  const base = 0x88;

  // Base grey
  ctx.fillStyle = rgbStr(base, base, base);
  ctx.fillRect(ox, oy, TILE_SIZE, TILE_SIZE);

  // Noise + cracks
  for (let y = 0; y < TILE_SIZE; y++) {
    for (let x = 0; x < TILE_SIZE; x++) {
      const v = rng();
      if (v < 0.4) {
        const shift = Math.floor((rng() - 0.5) * 50);
        const c = Math.max(0, Math.min(255, base + shift));
        ctx.fillStyle = rgbStr(c, c, c);
        ctx.fillRect(ox + x, oy + y, 1, 1);
      }
    }
  }

  // Darker crack lines
  ctx.fillStyle = rgbStr(0x60, 0x60, 0x60);
  for (let i = 0; i < 3; i++) {
    const sx = Math.floor(rng() * TILE_SIZE);
    const sy = Math.floor(rng() * TILE_SIZE);
    for (let j = 0; j < 4; j++) {
      const px = (sx + j) % TILE_SIZE;
      const py = (sy + Math.floor(rng() * 2)) % TILE_SIZE;
      ctx.fillRect(ox + px, oy + py, 1, 1);
    }
  }
}

function drawWall(ctx: CanvasRenderingContext2D, col: number, row: number): void {
  const ox = col * TILE_SIZE;
  const oy = row * TILE_SIZE;
  const rng = mulberry32(400);

  // Light grey brick pattern
  const [br, bg, bb] = hexToRgb(0xa0a0a0);
  ctx.fillStyle = rgbStr(br, bg, bb);
  ctx.fillRect(ox, oy, TILE_SIZE, TILE_SIZE);

  // Brick mortar lines
  const mortarColor = rgbStr(0x80, 0x80, 0x80);
  ctx.fillStyle = mortarColor;
  // Horizontal lines every 4 pixels
  for (let y = 0; y < TILE_SIZE; y += 4) {
    ctx.fillRect(ox, oy + y, TILE_SIZE, 1);
  }
  // Vertical lines (offset every other row)
  for (let row2 = 0; row2 < 4; row2++) {
    const offset = (row2 % 2) * 4;
    for (let x = offset; x < TILE_SIZE; x += 8) {
      ctx.fillRect(ox + x, oy + row2 * 4, 1, 4);
    }
  }

  // Brick surface noise
  for (let y = 0; y < TILE_SIZE; y++) {
    for (let x = 0; x < TILE_SIZE; x++) {
      if (rng() < 0.2) {
        const shift = Math.floor((rng() - 0.5) * 20);
        ctx.fillStyle = rgbStr(
          Math.max(0, Math.min(255, br + shift)),
          Math.max(0, Math.min(255, bg + shift)),
          Math.max(0, Math.min(255, bb + shift)),
        );
        ctx.fillRect(ox + x, oy + y, 1, 1);
      }
    }
  }
}

function drawRoof(ctx: CanvasRenderingContext2D, col: number, row: number): void {
  const ox = col * TILE_SIZE;
  const oy = row * TILE_SIZE;
  const [br, bg, bb] = hexToRgb(0x555555);
  const rng = mulberry32(500);

  ctx.fillStyle = rgbStr(br, bg, bb);
  ctx.fillRect(ox, oy, TILE_SIZE, TILE_SIZE);

  // Diagonal shingle lines
  for (let y = 0; y < TILE_SIZE; y++) {
    for (let x = 0; x < TILE_SIZE; x++) {
      if ((x + y) % 4 === 0) {
        const shift = -15 + Math.floor(rng() * 10);
        ctx.fillStyle = rgbStr(
          Math.max(0, Math.min(255, br + shift)),
          Math.max(0, Math.min(255, bg + shift)),
          Math.max(0, Math.min(255, bb + shift)),
        );
        ctx.fillRect(ox + x, oy + y, 1, 1);
      } else if (rng() < 0.15) {
        const shift = Math.floor((rng() - 0.5) * 20);
        ctx.fillStyle = rgbStr(
          Math.max(0, Math.min(255, br + shift)),
          Math.max(0, Math.min(255, bg + shift)),
          Math.max(0, Math.min(255, bb + shift)),
        );
        ctx.fillRect(ox + x, oy + y, 1, 1);
      }
    }
  }
}

function drawWater(ctx: CanvasRenderingContext2D, col: number, row: number): void {
  const ox = col * TILE_SIZE;
  const oy = row * TILE_SIZE;
  const [br, bg, bb] = hexToRgb(0x2389da);
  const rng = mulberry32(600);

  ctx.fillStyle = rgbStr(br, bg, bb);
  ctx.fillRect(ox, oy, TILE_SIZE, TILE_SIZE);

  // Wavy lighter streaks
  for (let y = 0; y < TILE_SIZE; y++) {
    for (let x = 0; x < TILE_SIZE; x++) {
      const wave = Math.sin((x + y * 0.5) * 0.8) * 0.5 + 0.5;
      if (rng() < wave * 0.3) {
        const shift = Math.floor(rng() * 30);
        ctx.fillStyle = rgbStr(
          Math.min(255, br + shift),
          Math.min(255, bg + shift),
          Math.min(255, bb + shift + 10),
        );
        ctx.fillRect(ox + x, oy + y, 1, 1);
      }
    }
  }
}

function drawFallback(ctx: CanvasRenderingContext2D, col: number, row: number): void {
  const ox = col * TILE_SIZE;
  const oy = row * TILE_SIZE;

  // Solid white: unmapped materials pass palette RGB via vertex colors,
  // so white (1,1,1) is neutral in the shader multiply.
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(ox, oy, TILE_SIZE, TILE_SIZE);
}

// --- New material tile drawing functions ---

/** Generic noise tile: base color with random pixel variation */
function drawNoiseTile(
  ctx: CanvasRenderingContext2D, col: number, row: number,
  hex: number, seed: number, density: number, amplitude: number,
): void {
  const ox = col * TILE_SIZE;
  const oy = row * TILE_SIZE;
  const [br, bg, bb] = hexToRgb(hex);
  const rng = mulberry32(seed);

  ctx.fillStyle = rgbStr(br, bg, bb);
  ctx.fillRect(ox, oy, TILE_SIZE, TILE_SIZE);

  for (let y = 0; y < TILE_SIZE; y++) {
    for (let x = 0; x < TILE_SIZE; x++) {
      if (rng() < density) {
        const shift = Math.floor((rng() - 0.5) * amplitude * 2);
        ctx.fillStyle = rgbStr(
          Math.max(0, Math.min(255, br + shift)),
          Math.max(0, Math.min(255, bg + shift)),
          Math.max(0, Math.min(255, bb + shift)),
        );
        ctx.fillRect(ox + x, oy + y, 1, 1);
      }
    }
  }
}

function drawGrassDark(ctx: CanvasRenderingContext2D, col: number, row: number): void {
  const ox = col * TILE_SIZE;
  const oy = row * TILE_SIZE;
  const [br, bg, bb] = hexToRgb(0x4a7a33);
  const rng = mulberry32(720);

  ctx.fillStyle = rgbStr(br, bg, bb);
  ctx.fillRect(ox, oy, TILE_SIZE, TILE_SIZE);

  for (let y = 0; y < TILE_SIZE; y++) {
    for (let x = 0; x < TILE_SIZE; x++) {
      const v = rng();
      if (v < 0.3) {
        const shift = Math.floor((rng() - 0.5) * 35);
        ctx.fillStyle = rgbStr(
          Math.max(0, Math.min(255, br + shift)),
          Math.max(0, Math.min(255, bg + shift + Math.floor(rng() * 10))),
          Math.max(0, Math.min(255, bb + shift)),
        );
        ctx.fillRect(ox + x, oy + y, 1, 1);
      }
    }
  }
}

function drawStoneDark(ctx: CanvasRenderingContext2D, col: number, row: number): void {
  const ox = col * TILE_SIZE;
  const oy = row * TILE_SIZE;
  const rng = mulberry32(730);
  const base = 0x66;

  ctx.fillStyle = rgbStr(base, base, base);
  ctx.fillRect(ox, oy, TILE_SIZE, TILE_SIZE);

  for (let y = 0; y < TILE_SIZE; y++) {
    for (let x = 0; x < TILE_SIZE; x++) {
      if (rng() < 0.4) {
        const shift = Math.floor((rng() - 0.5) * 40);
        const c = Math.max(0, Math.min(255, base + shift));
        ctx.fillStyle = rgbStr(c, c, c);
        ctx.fillRect(ox + x, oy + y, 1, 1);
      }
    }
  }

  // Crack lines
  ctx.fillStyle = rgbStr(0x44, 0x44, 0x44);
  for (let i = 0; i < 3; i++) {
    const sx = Math.floor(rng() * TILE_SIZE);
    const sy = Math.floor(rng() * TILE_SIZE);
    for (let j = 0; j < 4; j++) {
      const px = (sx + j) % TILE_SIZE;
      const py = (sy + Math.floor(rng() * 2)) % TILE_SIZE;
      ctx.fillRect(ox + px, oy + py, 1, 1);
    }
  }
}

function drawWoodTile(ctx: CanvasRenderingContext2D, col: number, row: number, hex: number, seed: number): void {
  const ox = col * TILE_SIZE;
  const oy = row * TILE_SIZE;
  const [br, bg, bb] = hexToRgb(hex);
  const rng = mulberry32(seed);

  ctx.fillStyle = rgbStr(br, bg, bb);
  ctx.fillRect(ox, oy, TILE_SIZE, TILE_SIZE);

  // Horizontal wood grain lines
  for (let y = 0; y < TILE_SIZE; y++) {
    if (y % 3 === 0) {
      const shift = -10 - Math.floor(rng() * 15);
      ctx.fillStyle = rgbStr(
        Math.max(0, br + shift),
        Math.max(0, bg + shift),
        Math.max(0, bb + shift),
      );
      ctx.fillRect(ox, oy + y, TILE_SIZE, 1);
    }
  }

  // Noise over grain
  for (let y = 0; y < TILE_SIZE; y++) {
    for (let x = 0; x < TILE_SIZE; x++) {
      if (rng() < 0.2) {
        const shift = Math.floor((rng() - 0.5) * 20);
        ctx.fillStyle = rgbStr(
          Math.max(0, Math.min(255, br + shift)),
          Math.max(0, Math.min(255, bg + shift)),
          Math.max(0, Math.min(255, bb + shift)),
        );
        ctx.fillRect(ox + x, oy + y, 1, 1);
      }
    }
  }
}

function drawBrickTile(ctx: CanvasRenderingContext2D, col: number, row: number, hex: number, seed: number): void {
  const ox = col * TILE_SIZE;
  const oy = row * TILE_SIZE;
  const [br, bg, bb] = hexToRgb(hex);
  const rng = mulberry32(seed);

  ctx.fillStyle = rgbStr(br, bg, bb);
  ctx.fillRect(ox, oy, TILE_SIZE, TILE_SIZE);

  // Mortar lines
  const mortar = rgbStr(
    Math.min(255, br + 40),
    Math.min(255, bg + 40),
    Math.min(255, bb + 40),
  );
  ctx.fillStyle = mortar;
  for (let y = 0; y < TILE_SIZE; y += 4) {
    ctx.fillRect(ox, oy + y, TILE_SIZE, 1);
  }
  for (let row2 = 0; row2 < 4; row2++) {
    const offset = (row2 % 2) * 4;
    for (let x = offset; x < TILE_SIZE; x += 8) {
      ctx.fillRect(ox + x, oy + row2 * 4, 1, 4);
    }
  }

  // Surface noise
  for (let y = 0; y < TILE_SIZE; y++) {
    for (let x = 0; x < TILE_SIZE; x++) {
      if (rng() < 0.2) {
        const shift = Math.floor((rng() - 0.5) * 25);
        ctx.fillStyle = rgbStr(
          Math.max(0, Math.min(255, br + shift)),
          Math.max(0, Math.min(255, bg + shift)),
          Math.max(0, Math.min(255, bb + shift)),
        );
        ctx.fillRect(ox + x, oy + y, 1, 1);
      }
    }
  }
}

function drawRoofTileTile(ctx: CanvasRenderingContext2D, col: number, row: number): void {
  const ox = col * TILE_SIZE;
  const oy = row * TILE_SIZE;
  const [br, bg, bb] = hexToRgb(0x8b4513);
  const rng = mulberry32(790);

  ctx.fillStyle = rgbStr(br, bg, bb);
  ctx.fillRect(ox, oy, TILE_SIZE, TILE_SIZE);

  // Overlapping tile pattern (horizontal lines with alternating offset)
  for (let y = 0; y < TILE_SIZE; y += 4) {
    const shift = -15;
    ctx.fillStyle = rgbStr(
      Math.max(0, br + shift),
      Math.max(0, bg + shift),
      Math.max(0, bb + shift),
    );
    ctx.fillRect(ox, oy + y, TILE_SIZE, 1);
  }

  for (let y = 0; y < TILE_SIZE; y++) {
    for (let x = 0; x < TILE_SIZE; x++) {
      if (rng() < 0.2) {
        const shift = Math.floor((rng() - 0.5) * 25);
        ctx.fillStyle = rgbStr(
          Math.max(0, Math.min(255, br + shift)),
          Math.max(0, Math.min(255, bg + shift)),
          Math.max(0, Math.min(255, bb + shift)),
        );
        ctx.fillRect(ox + x, oy + y, 1, 1);
      }
    }
  }
}

function drawWaterDeep(ctx: CanvasRenderingContext2D, col: number, row: number): void {
  const ox = col * TILE_SIZE;
  const oy = row * TILE_SIZE;
  const [br, bg, bb] = hexToRgb(0x1a4c80);
  const rng = mulberry32(800);

  ctx.fillStyle = rgbStr(br, bg, bb);
  ctx.fillRect(ox, oy, TILE_SIZE, TILE_SIZE);

  for (let y = 0; y < TILE_SIZE; y++) {
    for (let x = 0; x < TILE_SIZE; x++) {
      const wave = Math.sin((x + y * 0.5) * 0.8) * 0.5 + 0.5;
      if (rng() < wave * 0.25) {
        const shift = Math.floor(rng() * 20);
        ctx.fillStyle = rgbStr(
          Math.min(255, br + shift),
          Math.min(255, bg + shift),
          Math.min(255, bb + shift + 8),
        );
        ctx.fillRect(ox + x, oy + y, 1, 1);
      }
    }
  }
}

function drawRoadTile(ctx: CanvasRenderingContext2D, col: number, row: number): void {
  const ox = col * TILE_SIZE;
  const oy = row * TILE_SIZE;
  const [br, bg, bb] = hexToRgb(0x555555);
  const rng = mulberry32(810);

  ctx.fillStyle = rgbStr(br, bg, bb);
  ctx.fillRect(ox, oy, TILE_SIZE, TILE_SIZE);

  // Asphalt speckle noise
  for (let y = 0; y < TILE_SIZE; y++) {
    for (let x = 0; x < TILE_SIZE; x++) {
      if (rng() < 0.4) {
        const shift = Math.floor((rng() - 0.5) * 30);
        const c = Math.max(0, Math.min(255, br + shift));
        ctx.fillStyle = rgbStr(c, c, c);
        ctx.fillRect(ox + x, oy + y, 1, 1);
      }
    }
  }
}

function drawWindowTile(ctx: CanvasRenderingContext2D, col: number, row: number): void {
  const ox = col * TILE_SIZE;
  const oy = row * TILE_SIZE;
  const [br, bg, bb] = hexToRgb(0x87ceeb);
  const rng = mulberry32(820);

  ctx.fillStyle = rgbStr(br, bg, bb);
  ctx.fillRect(ox, oy, TILE_SIZE, TILE_SIZE);

  // Subtle reflection streaks
  for (let y = 0; y < TILE_SIZE; y++) {
    for (let x = 0; x < TILE_SIZE; x++) {
      const diag = Math.sin((x - y) * 0.5) * 0.5 + 0.5;
      if (rng() < diag * 0.2) {
        const shift = Math.floor(rng() * 20);
        ctx.fillStyle = rgbStr(
          Math.min(255, br + shift),
          Math.min(255, bg + shift),
          Math.min(255, bb + shift),
        );
        ctx.fillRect(ox + x, oy + y, 1, 1);
      }
    }
  }

  // Window frame (darker border, 1px)
  const frame = rgbStr(0x60, 0x60, 0x60);
  ctx.fillStyle = frame;
  ctx.fillRect(ox, oy, TILE_SIZE, 1);
  ctx.fillRect(ox, oy + TILE_SIZE - 1, TILE_SIZE, 1);
  ctx.fillRect(ox, oy, 1, TILE_SIZE);
  ctx.fillRect(ox + TILE_SIZE - 1, oy, 1, TILE_SIZE);
}
