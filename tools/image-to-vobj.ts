/**
 * image-to-vobj.ts
 *
 * Converts a 2D PNG image into a 3D voxel object (.vobj.json) using
 * silhouette extrusion. Non-transparent pixels become solid voxels
 * extruded along the Z axis.
 *
 * Usage:
 *   npx tsx tools/image-to-vobj.ts --input sprite.png --output barrel.vobj.json \
 *     --depth 8 --voxel-size 0.125 --category prop
 *
 * Options:
 *   --input       Path to input PNG image
 *   --output      Path for output .vobj.json file
 *   --depth       Number of voxels to extrude along Z (default: 4)
 *   --voxel-size  World meters per voxel (default: 0.125)
 *   --category    Object category: prop, building, vegetation (default: prop)
 *   --name        Object name (default: derived from filename)
 *   --depth-vary  Enable brightness-based depth variation (darker = less depth)
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { PNG } from 'pngjs';

// ---------------------------------------------------------------------------
// Color quantization (median-cut)
// ---------------------------------------------------------------------------

interface ColorEntry {
  r: number;
  g: number;
  b: number;
  count: number;
}

/**
 * Quantize a list of colors down to maxColors using median-cut.
 * Returns the quantized palette and a map from original color key to palette index.
 */
function quantizeColors(
  colors: Map<number, number>,
  maxColors: number
): { palette: number[]; colorMap: Map<number, number> } {
  // Build color list
  const entries: ColorEntry[] = [];
  for (const [key, count] of colors) {
    entries.push({
      r: (key >> 16) & 0xff,
      g: (key >> 8) & 0xff,
      b: key & 0xff,
      count,
    });
  }

  if (entries.length <= maxColors) {
    // No quantization needed
    const palette: number[] = [0]; // index 0 = air
    const colorMap = new Map<number, number>();
    for (const e of entries) {
      const key = (e.r << 16) | (e.g << 8) | e.b;
      const idx = palette.length;
      palette.push(key);
      colorMap.set(key, idx);
    }
    while (palette.length < 256) palette.push(0);
    return { palette, colorMap };
  }

  // Median-cut: recursively split buckets along the axis with greatest range
  type Bucket = ColorEntry[];

  function splitBucket(bucket: Bucket): [Bucket, Bucket] {
    // Find axis with greatest range
    let minR = 255, maxR = 0, minG = 255, maxG = 0, minB = 255, maxB = 0;
    for (const c of bucket) {
      if (c.r < minR) minR = c.r;
      if (c.r > maxR) maxR = c.r;
      if (c.g < minG) minG = c.g;
      if (c.g > maxG) maxG = c.g;
      if (c.b < minB) minB = c.b;
      if (c.b > maxB) maxB = c.b;
    }

    const rangeR = maxR - minR;
    const rangeG = maxG - minG;
    const rangeB = maxB - minB;

    let sortKey: (c: ColorEntry) => number;
    if (rangeR >= rangeG && rangeR >= rangeB) {
      sortKey = (c) => c.r;
    } else if (rangeG >= rangeB) {
      sortKey = (c) => c.g;
    } else {
      sortKey = (c) => c.b;
    }

    bucket.sort((a, b) => sortKey(a) - sortKey(b));
    const mid = Math.floor(bucket.length / 2);
    return [bucket.slice(0, mid), bucket.slice(mid)];
  }

  let buckets: Bucket[] = [entries];
  while (buckets.length < maxColors) {
    // Find the largest bucket to split
    let maxIdx = 0;
    let maxSize = 0;
    for (let i = 0; i < buckets.length; i++) {
      if (buckets[i].length > maxSize) {
        maxSize = buckets[i].length;
        maxIdx = i;
      }
    }
    if (maxSize <= 1) break;

    const [a, b] = splitBucket(buckets[maxIdx]);
    buckets.splice(maxIdx, 1, a, b);
  }

  // Compute average color per bucket
  const palette: number[] = [0]; // index 0 = air
  const colorMap = new Map<number, number>();

  for (const bucket of buckets) {
    if (bucket.length === 0) continue;
    let totalR = 0, totalG = 0, totalB = 0, totalCount = 0;
    for (const c of bucket) {
      totalR += c.r * c.count;
      totalG += c.g * c.count;
      totalB += c.b * c.count;
      totalCount += c.count;
    }
    const avgR = Math.round(totalR / totalCount);
    const avgG = Math.round(totalG / totalCount);
    const avgB = Math.round(totalB / totalCount);
    const paletteIdx = palette.length;
    palette.push((avgR << 16) | (avgG << 8) | avgB);

    // Map all bucket colors to this palette index
    for (const c of bucket) {
      const key = (c.r << 16) | (c.g << 8) | c.b;
      colorMap.set(key, paletteIdx);
    }
  }

  while (palette.length < 256) palette.push(0);
  return { palette, colorMap };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main(): void {
  const args = process.argv.slice(2);

  function getArg(name: string, defaultVal: string): string {
    const idx = args.indexOf(name);
    return idx !== -1 && args[idx + 1] ? args[idx + 1] : defaultVal;
  }

  const inputPath = path.resolve(getArg('--input', ''));
  const outputPath = path.resolve(getArg('--output', ''));
  const depth = parseInt(getArg('--depth', '4'), 10);
  const voxelSize = parseFloat(getArg('--voxel-size', '0.125'));
  const category = getArg('--category', 'prop');
  const nameArg = getArg('--name', '');
  const depthVary = args.includes('--depth-vary');

  if (!inputPath || inputPath === path.resolve('')) {
    console.error('Usage: npx tsx tools/image-to-vobj.ts --input <png> --output <vobj.json> [options]');
    console.error('Options:');
    console.error('  --depth <n>        Extrusion depth in voxels (default: 4)');
    console.error('  --voxel-size <n>   Voxel size in meters (default: 0.125)');
    console.error('  --category <cat>   Category: prop, building, vegetation (default: prop)');
    console.error('  --name <name>      Object name (default: from filename)');
    console.error('  --depth-vary       Use brightness for depth variation');
    process.exit(1);
  }

  if (!fs.existsSync(inputPath)) {
    console.error(`Error: input file not found: ${inputPath}`);
    process.exit(1);
  }

  console.log('=== Image to Voxel Object Converter ===\n');
  console.log(`  Input:      ${inputPath}`);
  console.log(`  Output:     ${outputPath}`);
  console.log(`  Depth:      ${depth} voxels`);
  console.log(`  Voxel size: ${voxelSize}m`);
  console.log(`  Category:   ${category}`);
  console.log(`  Depth vary: ${depthVary}`);

  // Read PNG
  const pngData = fs.readFileSync(inputPath);
  const png = PNG.sync.read(pngData);
  const { width, height, data } = png;

  console.log(`\n  Image size: ${width}×${height} pixels`);

  // Collect unique colors and build pixel data
  const colorCounts = new Map<number, number>();
  const pixelColors: (number | null)[] = []; // null = transparent

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const a = data[i + 3];

      if (a < 128) {
        pixelColors.push(null); // transparent = air
      } else {
        const colorKey = (r << 16) | (g << 8) | b;
        pixelColors.push(colorKey);
        colorCounts.set(colorKey, (colorCounts.get(colorKey) ?? 0) + 1);
      }
    }
  }

  console.log(`  Unique colors: ${colorCounts.size}`);

  // Quantize to 255 colors (palette index 0 reserved for air)
  const { palette, colorMap } = quantizeColors(colorCounts, 255);
  console.log(`  Palette entries: ${palette.filter(c => c !== 0).length}`);

  // Build voxel grid
  // Image coordinate system: x=right, y=down
  // Voxel object: x=right, y=up, z=depth (extrusion axis)
  // So image pixel (px, py) maps to voxel (px, height-1-py, z)
  const sizeX = width;
  const sizeY = height;
  const sizeZ = depth;
  const voxels = new Array(sizeX * sizeY * sizeZ).fill(0);

  let solidCount = 0;
  for (let py = 0; py < height; py++) {
    for (let px = 0; px < width; px++) {
      const pixelColor = pixelColors[py * width + px];
      if (pixelColor === null) continue;

      const paletteIdx = colorMap.get(pixelColor);
      if (!paletteIdx) continue;

      // Map to voxel coordinates (flip Y)
      const vx = px;
      const vy = height - 1 - py;

      // Compute depth for this pixel
      let pixelDepth = depth;
      if (depthVary) {
        // Use brightness to vary depth: darker = less depth
        const r = (pixelColor >> 16) & 0xff;
        const g = (pixelColor >> 8) & 0xff;
        const b = pixelColor & 0xff;
        const brightness = (r * 0.299 + g * 0.587 + b * 0.114) / 255;
        pixelDepth = Math.max(1, Math.round(depth * brightness));
      }

      // Center the extrusion on Z
      const zStart = Math.floor((depth - pixelDepth) / 2);
      const zEnd = zStart + pixelDepth;

      for (let vz = zStart; vz < zEnd; vz++) {
        const idx = vx + vy * sizeX + vz * sizeX * sizeY;
        voxels[idx] = paletteIdx;
        solidCount++;
      }
    }
  }

  console.log(`  Solid voxels: ${solidCount}`);

  // Derive name
  const objectName = nameArg || path.basename(inputPath, path.extname(inputPath));

  // Origin at bottom-center
  const origin = {
    x: Math.floor(sizeX / 2),
    y: 0,
    z: Math.floor(sizeZ / 2),
  };

  const objDef = {
    name: objectName,
    version: 1,
    category,
    sizeX,
    sizeY,
    sizeZ,
    voxelSize,
    origin,
    palette,
    voxels,
  };

  // Ensure output directory exists
  const outDir = path.dirname(outputPath);
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  fs.writeFileSync(outputPath, JSON.stringify(objDef));

  const fileSizeKB = (Buffer.byteLength(JSON.stringify(objDef)) / 1024).toFixed(1);
  console.log(`\n  Output: ${outputPath} (${fileSizeKB} KB)`);
  console.log(`  Dimensions: ${sizeX}×${sizeY}×${sizeZ} voxels`);
  console.log(`  World size: ${(sizeX * voxelSize).toFixed(2)}×${(sizeY * voxelSize).toFixed(2)}×${(sizeZ * voxelSize).toFixed(2)} meters`);
  console.log('\nDone!');
}

main();
