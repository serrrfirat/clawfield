#!/usr/bin/env node
/**
 * GLB Texture Optimizer
 *
 * Extracts embedded textures from GLB files, resizes and compresses them,
 * then re-embeds them — dramatically reducing file size while preserving geometry.
 *
 * Usage:
 *   node tools/optimize-glb.js <file.glb>                     # optimize single file
 *   node tools/optimize-glb.js <file.glb> --max-size 256      # resize textures to 256x256
 *   node tools/optimize-glb.js <file.glb> --format jpeg       # convert to JPEG
 *   node tools/optimize-glb.js --batch assets/models/weapons   # batch optimize a directory
 *   node tools/optimize-glb.js --batch assets/models --dry-run # preview savings
 */

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

// --- Config ---
const DEFAULT_MAX_SIZE = 512;    // max texture dimension
const DEFAULT_FORMAT = 'png';    // 'png' or 'jpeg'
const JPEG_QUALITY = 85;
const PNG_COMPRESSION = 9;       // 0-9, higher = smaller
const PNG_COLORS = 256;          // for palette-based PNG quantization

// --- GLB Parser ---
function parseGLB(buffer) {
  const magic = buffer.readUInt32LE(0);
  if (magic !== 0x46546C67) throw new Error('Not a valid GLB file');

  const version = buffer.readUInt32LE(4);
  const totalLength = buffer.readUInt32LE(8);

  // Chunk 0: JSON
  const jsonChunkLength = buffer.readUInt32LE(12);
  const jsonChunkType = buffer.readUInt32LE(16);
  if (jsonChunkType !== 0x4E4F534A) throw new Error('First chunk is not JSON');
  const jsonStr = buffer.toString('utf8', 20, 20 + jsonChunkLength);
  const json = JSON.parse(jsonStr);

  // Chunk 1: Binary
  const binOffset = 20 + jsonChunkLength;
  let binBuffer = null;
  if (binOffset < totalLength) {
    const binChunkLength = buffer.readUInt32LE(binOffset);
    const binChunkType = buffer.readUInt32LE(binOffset + 4);
    if (binChunkType === 0x004E4942) {
      binBuffer = buffer.slice(binOffset + 8, binOffset + 8 + binChunkLength);
    }
  }

  return { version, json, binBuffer };
}

function buildGLB(json, binBuffer) {
  const jsonStr = JSON.stringify(json);
  // JSON chunk must be padded to 4-byte boundary with spaces
  const jsonPad = (4 - (jsonStr.length % 4)) % 4;
  const jsonBuf = Buffer.from(jsonStr + ' '.repeat(jsonPad), 'utf8');

  // Binary chunk must be padded to 4-byte boundary with zeros
  const binPad = (4 - (binBuffer.length % 4)) % 4;
  const paddedBin = Buffer.concat([binBuffer, Buffer.alloc(binPad)]);

  const totalLength = 12 + 8 + jsonBuf.length + 8 + paddedBin.length;

  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546C67, 0); // magic
  header.writeUInt32LE(2, 4);           // version
  header.writeUInt32LE(totalLength, 8);

  const jsonChunkHeader = Buffer.alloc(8);
  jsonChunkHeader.writeUInt32LE(jsonBuf.length, 0);
  jsonChunkHeader.writeUInt32LE(0x4E4F534A, 4);

  const binChunkHeader = Buffer.alloc(8);
  binChunkHeader.writeUInt32LE(paddedBin.length, 0);
  binChunkHeader.writeUInt32LE(0x004E4942, 4);

  return Buffer.concat([header, jsonChunkHeader, jsonBuf, binChunkHeader, paddedBin]);
}

// --- Texture Optimization ---
async function optimizeTexture(imageData, mimeType, opts) {
  const { maxSize, format } = opts;

  let pipeline = sharp(imageData);
  const metadata = await pipeline.metadata();

  const origW = metadata.width;
  const origH = metadata.height;

  // Resize if either dimension exceeds maxSize
  if (origW > maxSize || origH > maxSize) {
    pipeline = pipeline.resize(maxSize, maxSize, {
      fit: 'inside',
      withoutEnlargement: true,
    });
  }

  let outputBuffer;
  let outputMime;

  if (format === 'jpeg') {
    outputBuffer = await pipeline.jpeg({ quality: JPEG_QUALITY }).toBuffer();
    outputMime = 'image/jpeg';
  } else {
    outputBuffer = await pipeline.png({
      compressionLevel: PNG_COMPRESSION,
      palette: true,
      colours: PNG_COLORS,
    }).toBuffer();
    outputMime = 'image/png';
  }

  return {
    buffer: outputBuffer,
    mimeType: outputMime,
    origW,
    origH,
    origSize: imageData.length,
    newSize: outputBuffer.length,
  };
}

async function optimizeGLB(inputPath, opts) {
  const { maxSize, format, dryRun } = opts;
  const buffer = fs.readFileSync(inputPath);
  const origFileSize = buffer.length;
  const { json, binBuffer } = parseGLB(buffer);

  if (!json.images || json.images.length === 0) {
    return { skipped: true, reason: 'no embedded textures', origFileSize };
  }

  const results = [];
  const newBufferParts = [];
  let currentOffset = 0;

  // Copy the entire binary buffer — we'll rebuild it with optimized images
  // First, collect all buffer view ranges that are images
  const imageBufferViews = new Set();
  for (const img of json.images) {
    if (img.bufferView !== undefined) {
      imageBufferViews.add(img.bufferView);
    }
  }

  // Build a map of bufferView index -> optimized data
  const optimizedViews = new Map();

  for (let i = 0; i < json.images.length; i++) {
    const img = json.images[i];
    if (img.bufferView === undefined) continue;

    const bv = json.bufferViews[img.bufferView];
    const offset = bv.byteOffset || 0;
    const length = bv.byteLength;
    const imageData = binBuffer.slice(offset, offset + length);

    const result = await optimizeTexture(imageData, img.mimeType, { maxSize, format });
    results.push({
      index: i,
      bufferView: img.bufferView,
      origMime: img.mimeType,
      newMime: result.mimeType,
      origW: result.origW,
      origH: result.origH,
      origSize: result.origSize,
      newSize: result.newSize,
      savings: ((1 - result.newSize / result.origSize) * 100).toFixed(1),
    });

    optimizedViews.set(img.bufferView, {
      data: result.buffer,
      mimeType: result.mimeType,
    });
  }

  if (dryRun) {
    return { dryRun: true, results, origFileSize };
  }

  // Rebuild binary buffer with optimized images
  // Strategy: rebuild all buffer views in order, replacing image ones
  const sortedViews = json.bufferViews
    .map((bv, idx) => ({ ...bv, _idx: idx }))
    .sort((a, b) => (a.byteOffset || 0) - (b.byteOffset || 0));

  const newParts = [];
  const newOffsets = new Map();
  let runningOffset = 0;

  for (const bv of sortedViews) {
    const origOffset = bv.byteOffset || 0;
    const origLength = bv.byteLength;

    if (optimizedViews.has(bv._idx)) {
      // Replace with optimized image data
      const opt = optimizedViews.get(bv._idx);
      newParts.push(opt.data);
      newOffsets.set(bv._idx, { offset: runningOffset, length: opt.data.length });
      runningOffset += opt.data.length;

      // Update image mimeType
      for (const img of json.images) {
        if (img.bufferView === bv._idx) {
          img.mimeType = opt.mimeType;
        }
      }
    } else {
      // Keep original data
      const origData = binBuffer.slice(origOffset, origOffset + origLength);
      newParts.push(origData);
      newOffsets.set(bv._idx, { offset: runningOffset, length: origLength });
      runningOffset += origLength;
    }

    // Pad to 4-byte alignment (GLB requirement)
    const pad = (4 - (runningOffset % 4)) % 4;
    if (pad > 0) {
      newParts.push(Buffer.alloc(pad));
      runningOffset += pad;
    }
  }

  // Update buffer views with new offsets/lengths
  for (let i = 0; i < json.bufferViews.length; i++) {
    const info = newOffsets.get(i);
    if (info) {
      json.bufferViews[i].byteOffset = info.offset;
      json.bufferViews[i].byteLength = info.length;
    }
  }

  // Update buffer total size
  const newBinBuffer = Buffer.concat(newParts);
  if (json.buffers && json.buffers.length > 0) {
    json.buffers[0].byteLength = newBinBuffer.length;
  }

  // Rebuild GLB
  const outputBuffer = buildGLB(json, newBinBuffer);
  const outputPath = inputPath; // overwrite in place
  fs.writeFileSync(outputPath, outputBuffer);

  return {
    results,
    origFileSize,
    newFileSize: outputBuffer.length,
    savings: ((1 - outputBuffer.length / origFileSize) * 100).toFixed(1),
  };
}

// --- Batch Processing ---
function findGLBFiles(dir) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...findGLBFiles(fullPath));
    } else if (entry.name.toLowerCase().endsWith('.glb')) {
      files.push(fullPath);
    }
  }
  return files;
}

function formatBytes(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

// --- CLI ---
async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.log('Usage:');
    console.log('  node optimize-glb.js <file.glb> [options]');
    console.log('  node optimize-glb.js --batch <directory> [options]');
    console.log('');
    console.log('Options:');
    console.log('  --max-size <n>   Max texture dimension (default: 512)');
    console.log('  --format <fmt>   Output format: png or jpeg (default: png)');
    console.log('  --dry-run        Preview savings without modifying files');
    console.log('  --batch <dir>    Process all GLB files in directory recursively');
    process.exit(0);
  }

  // Parse args
  let inputPath = null;
  let batchDir = null;
  let maxSize = DEFAULT_MAX_SIZE;
  let format = DEFAULT_FORMAT;
  let dryRun = false;

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--max-size':
        maxSize = parseInt(args[++i], 10);
        break;
      case '--format':
        format = args[++i];
        break;
      case '--dry-run':
        dryRun = true;
        break;
      case '--batch':
        batchDir = args[++i];
        break;
      default:
        if (!args[i].startsWith('--')) inputPath = args[i];
    }
  }

  if (format !== 'png' && format !== 'jpeg') {
    console.error('Error: --format must be "png" or "jpeg"');
    process.exit(1);
  }

  const files = batchDir
    ? findGLBFiles(path.resolve(batchDir))
    : [path.resolve(inputPath)];

  if (files.length === 0) {
    console.log('No GLB files found.');
    return;
  }

  console.log(`\nProcessing ${files.length} GLB file(s)...`);
  console.log(`  Max texture size: ${maxSize}x${maxSize}`);
  console.log(`  Format: ${format}`);
  console.log(`  Mode: ${dryRun ? 'DRY RUN (no changes)' : 'OPTIMIZE (in-place)'}\n`);

  let totalOrigSize = 0;
  let totalNewSize = 0;
  let processed = 0;
  let skipped = 0;

  for (const filePath of files) {
    const relPath = path.relative(process.cwd(), filePath);
    console.log(`--- ${relPath} ---`);

    try {
      const result = await optimizeGLB(filePath, { maxSize, format, dryRun });

      if (result.skipped) {
        console.log(`  Skipped: ${result.reason}`);
        skipped++;
        continue;
      }

      for (const r of result.results) {
        console.log(
          `  Texture ${r.index}: ${r.origW}x${r.origH} ${r.origMime} (${formatBytes(r.origSize)})` +
          ` -> ${format} (${formatBytes(r.newSize)}) [${r.savings}% smaller]`
        );
      }

      if (result.dryRun) {
        const totalTexOrig = result.results.reduce((s, r) => s + r.origSize, 0);
        const totalTexNew = result.results.reduce((s, r) => s + r.newSize, 0);
        console.log(`  File: ${formatBytes(result.origFileSize)} -> ~${formatBytes(result.origFileSize - totalTexOrig + totalTexNew)}`);
        totalOrigSize += result.origFileSize;
        totalNewSize += result.origFileSize - totalTexOrig + totalTexNew;
      } else {
        console.log(`  File: ${formatBytes(result.origFileSize)} -> ${formatBytes(result.newFileSize)} (${result.savings}% smaller)`);
        totalOrigSize += result.origFileSize;
        totalNewSize += result.newFileSize;
      }
      processed++;
    } catch (err) {
      console.error(`  Error: ${err.message}`);
    }
  }

  console.log('\n=== Summary ===');
  console.log(`  Files processed: ${processed}`);
  console.log(`  Files skipped: ${skipped}`);
  if (processed > 0) {
    console.log(`  Total: ${formatBytes(totalOrigSize)} -> ${formatBytes(totalNewSize)} (${((1 - totalNewSize / totalOrigSize) * 100).toFixed(1)}% smaller)`);
  }
}

main().catch(err => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
