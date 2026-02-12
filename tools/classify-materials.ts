/**
 * classify-materials.ts -- Build-time material classifier for GLB files.
 *
 * Scans GLB files, classifies each mesh's material into a destruction
 * category (glass, wood, concrete, metal, stone, brick, plastic, unknown),
 * and outputs a JSON manifest with health/fragment metadata.
 *
 * Usage:
 *   npx tsx tools/classify-materials.ts [--dir path/to/glbs] [--output path/to/manifest.json]
 *
 * Defaults:
 *   --dir  apps/client/public/models/ and apps/client/src/assets/models/
 *   --output assets/material-manifest.json
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type MaterialType =
  | 'glass'
  | 'wood'
  | 'concrete'
  | 'metal'
  | 'stone'
  | 'brick'
  | 'plastic'
  | 'unknown';

type ClassifiedBy = 'name' | 'pbr' | 'default' | 'override';

interface MaterialHealth {
  healthMultiplier: number;
  fragmentCount: number;
  style: string;
}

interface MeshEntry {
  meshName: string;
  materialName: string;
  materialType: MaterialType;
  classifiedBy: ClassifiedBy;
  healthMultiplier: number;
  fragmentCount: number;
  fragmentStyle: string;
}

interface GLBEntry {
  glbPath: string;
  meshes: MeshEntry[];
}

// ---------------------------------------------------------------------------
// Material health table
// ---------------------------------------------------------------------------

const MATERIAL_HEALTH: Record<MaterialType, MaterialHealth> = {
  glass: { healthMultiplier: 0.2, fragmentCount: 24, style: 'shards' },
  wood: { healthMultiplier: 0.5, fragmentCount: 12, style: 'splinters' },
  concrete: { healthMultiplier: 1.0, fragmentCount: 18, style: 'chunks' },
  metal: { healthMultiplier: 1.5, fragmentCount: 8, style: 'twisted' },
  stone: { healthMultiplier: 1.2, fragmentCount: 12, style: 'irregular' },
  brick: { healthMultiplier: 0.8, fragmentCount: 20, style: 'bricks' },
  plastic: { healthMultiplier: 0.3, fragmentCount: 10, style: 'pieces' },
  unknown: { healthMultiplier: 1.0, fragmentCount: 12, style: 'chunks' },
};

// ---------------------------------------------------------------------------
// Name-based keyword rules (Layer 1)
// ---------------------------------------------------------------------------

const NAME_KEYWORDS: { keywords: string[]; type: MaterialType }[] = [
  { keywords: ['wood', 'timber', 'plank', 'bark'], type: 'wood' },
  { keywords: ['glass', 'window', 'transparent'], type: 'glass' },
  { keywords: ['metal', 'steel', 'iron', 'aluminum', 'chrome'], type: 'metal' },
  { keywords: ['concrete', 'cement'], type: 'concrete' },
  { keywords: ['stone', 'rock', 'marble', 'granite'], type: 'stone' },
  { keywords: ['brick'], type: 'brick' },
  { keywords: ['plastic', 'rubber'], type: 'plastic' },
];

function classifyByName(name: string): MaterialType | null {
  const lower = name.toLowerCase();
  for (const rule of NAME_KEYWORDS) {
    for (const kw of rule.keywords) {
      if (lower.includes(kw)) {
        return rule.type;
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// PBR heuristic classification (Layer 2)
// ---------------------------------------------------------------------------

interface PBRProps {
  metallicFactor: number;
  roughnessFactor: number;
  baseColorFactor: [number, number, number, number] | null;
  alphaMode: string;
  hasAlphaTexture: boolean;
}

/**
 * Convert RGB [0-1] to HSL.
 * Returns { h: 0-360, s: 0-1, l: 0-1 }
 */
function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;

  if (max === min) {
    return { h: 0, s: 0, l };
  }

  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);

  let h: number;
  if (max === r) {
    h = ((g - b) / d + (g < b ? 6 : 0)) * 60;
  } else if (max === g) {
    h = ((b - r) / d + 2) * 60;
  } else {
    h = ((r - g) / d + 4) * 60;
  }

  return { h, s, l };
}

function classifyByPBR(props: PBRProps): MaterialType | null {
  // Shiny metal: high metallic, low roughness
  if (props.metallicFactor > 0.7 && props.roughnessFactor < 0.3) {
    return 'metal';
  }

  // Transparency => glass
  if (props.alphaMode !== 'OPAQUE' || props.hasAlphaTexture) {
    return 'glass';
  }

  // Non-metallic, rough surfaces => distinguish by color
  if (props.metallicFactor < 0.3 && props.roughnessFactor > 0.6 && props.baseColorFactor) {
    const [r, g, b] = props.baseColorFactor;
    const hsl = rgbToHsl(r, g, b);

    // Wood: warm hues, some saturation
    if (hsl.h >= 20 && hsl.h <= 50 && hsl.s > 0.15) {
      return 'wood';
    }

    // Concrete: desaturated, medium darkness
    if (hsl.s < 0.15 && hsl.l >= 0.3 && hsl.l <= 0.6) {
      return 'concrete';
    }

    // Stone: desaturated, lighter
    if (hsl.s < 0.15 && hsl.l > 0.6 && hsl.l <= 0.8) {
      return 'stone';
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// GLB parser (minimal, matches codebase pattern from glb-to-voxel.ts)
// ---------------------------------------------------------------------------

interface GLBParsed {
  json: any;
  binChunk: Buffer;
}

function parseGLB(data: Buffer): GLBParsed | null {
  if (data.length < 12) return null;

  const magic = data.readUInt32LE(0);
  if (magic !== 0x46546c67) return null; // "glTF"

  const version = data.readUInt32LE(4);
  if (version !== 2) return null;

  let offset = 12;
  let json: any = null;
  let binChunk: Buffer = Buffer.alloc(0);

  while (offset < data.length) {
    if (offset + 8 > data.length) break;
    const chunkLength = data.readUInt32LE(offset);
    const chunkType = data.readUInt32LE(offset + 4);
    offset += 8;

    if (chunkType === 0x4e4f534a) {
      // JSON chunk
      json = JSON.parse(data.subarray(offset, offset + chunkLength).toString('utf-8'));
    } else if (chunkType === 0x004e4942) {
      // BIN chunk
      binChunk = data.subarray(offset, offset + chunkLength) as Buffer;
    }

    offset += chunkLength;
  }

  if (!json) return null;
  return { json, binChunk };
}

// ---------------------------------------------------------------------------
// Extract PBR properties from a glTF material
// ---------------------------------------------------------------------------

function extractPBRProps(material: any): PBRProps {
  const pbr = material.pbrMetallicRoughness ?? {};

  const metallicFactor = pbr.metallicFactor ?? 1.0;
  const roughnessFactor = pbr.roughnessFactor ?? 1.0;
  const baseColorFactor = pbr.baseColorFactor
    ? (pbr.baseColorFactor as [number, number, number, number])
    : null;
  const alphaMode = material.alphaMode ?? 'OPAQUE';

  // Check if there's an alpha texture (baseColorTexture with alpha channel usage)
  const hasAlphaTexture =
    alphaMode !== 'OPAQUE' && pbr.baseColorTexture !== undefined;

  return {
    metallicFactor,
    roughnessFactor,
    baseColorFactor,
    alphaMode,
    hasAlphaTexture,
  };
}

// ---------------------------------------------------------------------------
// Classify a single material
// ---------------------------------------------------------------------------

function classifyMaterial(
  materialName: string,
  pbrProps: PBRProps,
): { type: MaterialType; classifiedBy: ClassifiedBy } {
  // Layer 1: Name parsing
  const nameResult = classifyByName(materialName);
  if (nameResult) {
    return { type: nameResult, classifiedBy: 'name' };
  }

  // Layer 2: PBR heuristics
  const pbrResult = classifyByPBR(pbrProps);
  if (pbrResult) {
    return { type: pbrResult, classifiedBy: 'pbr' };
  }

  // Layer 3: Default
  return { type: 'unknown', classifiedBy: 'default' };
}

// ---------------------------------------------------------------------------
// Process a single GLB file
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Load sidecar .materials.json overrides (Layer 0)
// ---------------------------------------------------------------------------

interface SidecarOverride {
  meshName: string;
  materialType: MaterialType;
}

function loadSidecarOverrides(glbPath: string, verbose: boolean): Map<string, MaterialType> {
  const overrides = new Map<string, MaterialType>();
  const sidecarPath = glbPath.replace(/\.(glb|gltf)$/i, '.materials.json');

  if (!fs.existsSync(sidecarPath)) return overrides;

  try {
    const raw = JSON.parse(fs.readFileSync(sidecarPath, 'utf-8'));
    const entries: SidecarOverride[] = raw.overrides ?? [];
    for (const entry of entries) {
      if (entry.meshName && entry.materialType) {
        overrides.set(entry.meshName, entry.materialType);
      }
    }
    if (verbose) {
      console.log(`    Loaded ${overrides.size} override(s) from ${path.basename(sidecarPath)}`);
    }
  } catch (err) {
    if (verbose) {
      console.warn(`    WARN: Failed to parse sidecar ${sidecarPath}: ${(err as Error).message}`);
    }
  }

  return overrides;
}

function processGLB(filePath: string, basePath: string, verbose: boolean): GLBEntry | null {
  const data = fs.readFileSync(filePath);
  const parsed = parseGLB(data as Buffer);
  if (!parsed) {
    if (verbose) {
      console.warn(`  WARN: Failed to parse ${filePath} (invalid GLB format)`);
    }
    return null;
  }

  // Layer 0: Check for sidecar overrides
  const sidecarOverrides = loadSidecarOverrides(filePath, verbose);

  const { json } = parsed;
  const meshes = json.meshes ?? [];
  const materials = json.materials ?? [];

  const meshEntries: MeshEntry[] = [];

  // Walk all meshes and their primitives
  for (let mi = 0; mi < meshes.length; mi++) {
    const mesh = meshes[mi];
    const meshName = mesh.name ?? `mesh_${mi}`;
    const primitives = mesh.primitives ?? [];

    // Track materials already seen for this mesh to avoid duplicates
    const seenMaterials = new Set<number>();

    for (const primitive of primitives) {
      const matIndex = primitive.material;
      if (matIndex === undefined || seenMaterials.has(matIndex)) continue;
      seenMaterials.add(matIndex);

      const material = materials[matIndex];
      if (!material) continue;

      const materialName = material.name ?? `material_${matIndex}`;

      // Check sidecar override first
      const overrideType = sidecarOverrides.get(meshName);
      if (overrideType) {
        const health = MATERIAL_HEALTH[overrideType];
        meshEntries.push({
          meshName,
          materialName,
          materialType: overrideType,
          classifiedBy: 'override',
          healthMultiplier: health.healthMultiplier,
          fragmentCount: health.fragmentCount,
          fragmentStyle: health.style,
        });
        continue;
      }

      const pbrProps = extractPBRProps(material);
      const { type, classifiedBy } = classifyMaterial(materialName, pbrProps);
      const health = MATERIAL_HEALTH[type];

      meshEntries.push({
        meshName,
        materialName,
        materialType: type,
        classifiedBy,
        healthMultiplier: health.healthMultiplier,
        fragmentCount: health.fragmentCount,
        fragmentStyle: health.style,
      });
    }

    // Handle meshes with no material assigned
    if (primitives.length > 0 && primitives.every((p: any) => p.material === undefined)) {
      // Check sidecar override for meshes without materials too
      const overrideType = sidecarOverrides.get(meshName);
      if (overrideType) {
        const health = MATERIAL_HEALTH[overrideType];
        meshEntries.push({
          meshName,
          materialName: '(none)',
          materialType: overrideType,
          classifiedBy: 'override',
          healthMultiplier: health.healthMultiplier,
          fragmentCount: health.fragmentCount,
          fragmentStyle: health.style,
        });
      } else {
        const health = MATERIAL_HEALTH['unknown'];
        meshEntries.push({
          meshName,
          materialName: '(none)',
          materialType: 'unknown',
          classifiedBy: 'default',
          healthMultiplier: health.healthMultiplier,
          fragmentCount: health.fragmentCount,
          fragmentStyle: health.style,
        });
      }
    }
  }

  // Compute relative path from basePath for cleaner output
  const glbPath = path.relative(basePath, filePath);

  return {
    glbPath,
    meshes: meshEntries,
  };
}

// ---------------------------------------------------------------------------
// Recursively find all .glb files in a directory
// ---------------------------------------------------------------------------

function findGLBFiles(dir: string): string[] {
  const results: string[] = [];

  if (!fs.existsSync(dir)) return results;

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findGLBFiles(fullPath));
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.glb')) {
      results.push(fullPath);
    }
  }

  return results.sort();
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function getArg(args: string[], name: string, defaultVal: string): string {
  const idx = args.indexOf(name);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : defaultVal;
}

function main(): void {
  const args = process.argv.slice(2);
  const verbose = args.includes('--verbose');

  // Determine project root (one level up from tools/)
  const projectRoot = path.resolve(__dirname, '..');

  // Gather directories to scan
  const dirArg = getArg(args, '--dir', '');
  let dirs: string[];

  if (dirArg) {
    dirs = [path.resolve(dirArg)];
  } else {
    // Default directories
    dirs = [
      path.join(projectRoot, 'apps/client/public/models'),
      path.join(projectRoot, 'apps/client/src/assets/models'),
    ];
  }

  const outputPath = path.resolve(
    getArg(args, '--output', path.join(projectRoot, 'assets/material-manifest.json')),
  );

  console.log('=== Material Classifier ===\n');
  console.log(`  Directories:`);
  for (const d of dirs) {
    const exists = fs.existsSync(d);
    console.log(`    ${d} ${exists ? '' : '(not found, skipping)'}`);
  }
  console.log(`  Output: ${outputPath}`);
  console.log('');

  // Find all GLB files
  const allGLBs: string[] = [];
  for (const dir of dirs) {
    allGLBs.push(...findGLBFiles(dir));
  }

  if (allGLBs.length === 0) {
    console.log('No .glb files found in the specified directories.');
    // Write empty manifest
    const outDir = path.dirname(outputPath);
    if (!fs.existsSync(outDir)) {
      fs.mkdirSync(outDir, { recursive: true });
    }
    fs.writeFileSync(outputPath, JSON.stringify([], null, 2));
    console.log(`Wrote empty manifest to ${outputPath}`);
    return;
  }

  console.log(`Found ${allGLBs.length} .glb file(s):\n`);

  const manifest: GLBEntry[] = [];

  // Summary counters
  const typeCounts: Record<MaterialType, number> = {
    glass: 0,
    wood: 0,
    concrete: 0,
    metal: 0,
    stone: 0,
    brick: 0,
    plastic: 0,
    unknown: 0,
  };

  for (const glbPath of allGLBs) {
    const displayName = path.relative(projectRoot, glbPath);
    console.log(`  Processing: ${displayName}`);

    const entry = processGLB(glbPath, projectRoot, verbose);
    if (!entry) {
      console.log(`    -> skipped (parse error)`);
      continue;
    }

    manifest.push(entry);

    for (const mesh of entry.meshes) {
      typeCounts[mesh.materialType]++;
      if (verbose) {
        console.log(
          `    ${mesh.meshName} | ${mesh.materialName} -> ${mesh.materialType} (${mesh.classifiedBy})`,
        );
      }
    }

    console.log(`    -> ${entry.meshes.length} mesh(es) classified`);
  }

  // Write manifest
  const outDir = path.dirname(outputPath);
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }
  fs.writeFileSync(outputPath, JSON.stringify(manifest, null, 2));

  // Print summary
  const totalMeshes = Object.values(typeCounts).reduce((a, b) => a + b, 0);
  console.log(`\n=== Summary ===`);
  console.log(`  Files processed: ${manifest.length}`);
  console.log(`  Total meshes:    ${totalMeshes}`);
  console.log('');
  console.log('  Classification breakdown:');
  for (const [type, count] of Object.entries(typeCounts)) {
    if (count > 0) {
      console.log(`    ${type.padEnd(10)} ${count}`);
    }
  }
  console.log('');
  console.log(`  Manifest written to: ${outputPath}`);
  console.log('\nDone!');
}

main();
