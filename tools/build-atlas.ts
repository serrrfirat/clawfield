/**
 * build-atlas.ts — Stitch individual tile PNGs into a single texture atlas PNG,
 * and generate a corresponding normal map atlas via Sobel-filter height derivation.
 *
 * Atlas layout: 8 cols × 4 rows of 32×32 tiles (256×128 total).
 * Matches the MATERIAL_TILES mapping in texture-atlas.ts.
 *
 * Usage: pnpm tsx tools/build-atlas.ts
 * Output: assets/textures/atlas.png, assets/textures/atlas-normal.png
 *
 * Source: GoodVibes texture pack (CC-BY) from github.com/Phyronnaz/VoxelAssets
 */

import sharp from 'sharp';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TILES_DIR = path.join(__dirname, '..', 'assets', 'textures', 'tiles');
const OUTPUT = path.join(__dirname, '..', 'assets', 'textures', 'atlas.png');
const NORMAL_OUTPUT = path.join(__dirname, '..', 'assets', 'textures', 'atlas-normal.png');

const TILE = 32;
const COLS = 8;
const ROWS = 4;

interface TileSpec {
  col: number;
  row: number;
  file: string;
  /** If source is larger than TILE×TILE, extract first TILE×TILE region */
  crop?: boolean;
  /** Tint overlay: multiply RGB by this color (hex) */
  tint?: [number, number, number];
}

// Map each atlas slot to a source texture file
const tiles: TileSpec[] = [
  // Row 0: grass_top, grass_side, dirt, stone, wall, roof, water, fallback
  { col: 0, row: 0, file: 'grass_block_top.png', tint: [0x4a, 0x8c, 0x3f] }, // grass needs green tint
  { col: 1, row: 0, file: 'grass_block_side.png', tint: [0x5a, 0x9c, 0x4f] },
  { col: 2, row: 0, file: 'dirt.png' },
  { col: 3, row: 0, file: 'stone.png' },
  { col: 4, row: 0, file: 'stone_bricks.png' },       // wall
  { col: 5, row: 0, file: 'gray_concrete.png' },       // roof
  { col: 6, row: 0, file: 'water_still.png', crop: true, tint: [0x23, 0x89, 0xda] },
  // col 7 row 0 = fallback (white, left empty)

  // Row 1: sand_light, sand_dark, grass_dark, stone_dark, concrete, concrete_dark, wood, wood_dark
  { col: 0, row: 1, file: 'sand.png' },                // sand_light
  { col: 1, row: 1, file: 'sandstone_top.png' },       // sand_dark
  { col: 2, row: 1, file: 'grass_block_top.png', tint: [0x3a, 0x6a, 0x2a] }, // grass_dark (darker tint)
  { col: 3, row: 1, file: 'cobblestone.png' },          // stone_dark
  { col: 4, row: 1, file: 'light_gray_concrete.png' },  // concrete
  { col: 5, row: 1, file: 'gray_concrete.png' },        // concrete_dark
  { col: 6, row: 1, file: 'oak_planks.png' },           // wood
  { col: 7, row: 1, file: 'dark_oak_planks.png' },      // wood_dark

  // Row 2: brick, roof_tile, water_deep, road, window, metal
  { col: 0, row: 2, file: 'bricks.png' },
  { col: 1, row: 2, file: 'terracotta.png' },           // roof_tile
  { col: 2, row: 2, file: 'water_still.png', crop: true, tint: [0x1a, 0x4c, 0x80] }, // water_deep
  { col: 3, row: 2, file: 'gravel.png' },               // road
  { col: 4, row: 2, file: 'light_blue_stained_glass.png' }, // window
  { col: 5, row: 2, file: 'iron_block.png' },           // metal
];

async function loadTile(spec: TileSpec): Promise<Buffer> {
  const src = path.join(TILES_DIR, spec.file);
  let img = sharp(src);

  const meta = await img.metadata();

  // If source is larger than 16x16 (e.g., animated water), extract top-left 16x16
  if (spec.crop || (meta.width! > TILE || meta.height! > TILE)) {
    img = sharp(await img.extract({ left: 0, top: 0, width: Math.min(TILE, meta.width!), height: Math.min(TILE, meta.height!) }).toBuffer());
  }

  // Resize to exactly 16x16 if needed
  if (meta.width !== TILE || meta.height !== TILE) {
    img = sharp(await img.resize(TILE, TILE, { kernel: 'nearest' }).toBuffer());
  }

  // Apply tint if specified (multiply blend)
  if (spec.tint) {
    const { data, info } = await img.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const pixels = new Uint8Array(data);
    const [tr, tg, tb] = spec.tint;

    for (let i = 0; i < pixels.length; i += 4) {
      pixels[i]     = Math.round((pixels[i]     * tr) / 255);
      pixels[i + 1] = Math.round((pixels[i + 1] * tg) / 255);
      pixels[i + 2] = Math.round((pixels[i + 2] * tb) / 255);
      // alpha unchanged
    }

    return sharp(Buffer.from(pixels), { raw: { width: TILE, height: TILE, channels: 4 } })
      .png()
      .toBuffer();
  }

  return img.resize(TILE, TILE, { kernel: 'nearest' }).png().toBuffer();
}

/**
 * Generate a normal map from a color atlas using Sobel-filter height derivation.
 * Converts color to grayscale height, then applies Sobel operators to compute
 * per-pixel normals. Output is RGB where (128,128,255) = flat surface.
 */
async function generateNormalMap(colorAtlasPath: string, outputPath: string, strength: number = 2.0): Promise<void> {
  const { data, info } = await sharp(colorAtlasPath)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const w = info.width;
  const h = info.height;
  const pixels = new Uint8Array(data);

  // Convert to grayscale height map
  const height = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      // Luminance formula
      height[y * w + x] = (pixels[i] * 0.299 + pixels[i + 1] * 0.587 + pixels[i + 2] * 0.114) / 255;
    }
  }

  // Sample height with wrapping within each tile (prevents cross-tile bleeding)
  function sampleHeight(x: number, y: number): number {
    // Compute which tile we're in and wrap within it
    const tileX = Math.floor(x / TILE);
    const tileY = Math.floor(y / TILE);
    const localX = ((x % TILE) + TILE) % TILE;
    const localY = ((y % TILE) + TILE) % TILE;
    const sx = tileX * TILE + localX;
    const sy = tileY * TILE + localY;
    if (sx < 0 || sx >= w || sy < 0 || sy >= h) return 0.5;
    return height[sy * w + sx];
  }

  // Apply Sobel filter to generate normals
  const normalPixels = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      // Sobel kernels
      const tl = sampleHeight(x - 1, y - 1);
      const t  = sampleHeight(x,     y - 1);
      const tr = sampleHeight(x + 1, y - 1);
      const l  = sampleHeight(x - 1, y);
      const r  = sampleHeight(x + 1, y);
      const bl = sampleHeight(x - 1, y + 1);
      const b  = sampleHeight(x,     y + 1);
      const br = sampleHeight(x + 1, y + 1);

      // Sobel X: horizontal gradient
      const dx = (tr + 2 * r + br) - (tl + 2 * l + bl);
      // Sobel Y: vertical gradient
      const dy = (bl + 2 * b + br) - (tl + 2 * t + tr);

      // Normal vector (tangent space: X right, Y up, Z out)
      const nx = -dx * strength;
      const ny = -dy * strength;
      const nz = 1.0;
      const len = Math.sqrt(nx * nx + ny * ny + nz * nz);

      const i = (y * w + x) * 4;
      normalPixels[i]     = Math.round(((nx / len) * 0.5 + 0.5) * 255);
      normalPixels[i + 1] = Math.round(((ny / len) * 0.5 + 0.5) * 255);
      normalPixels[i + 2] = Math.round(((nz / len) * 0.5 + 0.5) * 255);
      normalPixels[i + 3] = 255;
    }
  }

  await sharp(Buffer.from(normalPixels), { raw: { width: w, height: h, channels: 4 } })
    .png()
    .toFile(outputPath);
}

async function main() {
  console.log('Building texture atlas...');

  // Start with white canvas (neutral fallback)
  const composites: sharp.OverlayOptions[] = [];

  for (const spec of tiles) {
    const buf = await loadTile(spec);
    composites.push({
      input: buf,
      left: spec.col * TILE,
      top: spec.row * TILE,
    });
    console.log(`  [${spec.col},${spec.row}] ← ${spec.file}${spec.tint ? ' (tinted)' : ''}`);
  }

  await sharp({
    create: {
      width: COLS * TILE,
      height: ROWS * TILE,
      channels: 4,
      background: { r: 255, g: 255, b: 255, alpha: 255 },
    },
  })
    .composite(composites)
    .png()
    .toFile(OUTPUT);

  console.log(`Atlas written to ${OUTPUT} (${COLS * TILE}×${ROWS * TILE})`);

  // Generate normal map from color atlas
  console.log('Generating normal map atlas...');
  await generateNormalMap(OUTPUT, NORMAL_OUTPUT, 2.0);
  console.log(`Normal atlas written to ${NORMAL_OUTPUT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
