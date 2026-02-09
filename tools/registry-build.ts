/**
 * registry-build.ts
 *
 * Scans assets/components/ for *.component.json files and builds
 * a registry at assets/components/registry.json.
 *
 * Usage:
 *   npx tsx tools/registry-build.ts
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ComponentEntry {
  id: string;
  name: string;
  category: string;
  bounds: { sizeX: number; sizeY: number; sizeZ: number };
  voxelCount: number;
  tags: string[];
  componentPath: string;
  source?: { file: string; modelIndex: number; license?: string };
}

interface Registry {
  version: number;
  components: ComponentEntry[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function findComponentFiles(dir: string, base: string): string[] {
  const results: string[] = [];
  if (!fs.existsSync(dir)) return results;

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findComponentFiles(fullPath, base));
    } else if (entry.name.endsWith('.component.json')) {
      results.push(fullPath);
    }
  }
  return results;
}

function inferLicense(sourceFile: string): string | undefined {
  const lower = sourceFile.toLowerCase();
  if (lower.includes('oasis')) return 'CC0';
  return undefined;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main(): void {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const projectRoot = path.resolve(__dirname, '..');
  const componentsDir = path.join(projectRoot, 'assets', 'components');
  const registryPath = path.join(componentsDir, 'registry.json');

  console.log('=== Clawfield Registry Builder ===\n');

  // 1. Find all component files
  const files = findComponentFiles(componentsDir, componentsDir);
  console.log(`  Found ${files.length} component files`);

  if (files.length === 0) {
    console.log('  No components found. Run vox-extract first.');
    process.exit(0);
  }

  // 2. Build registry
  const components: ComponentEntry[] = [];

  for (const filePath of files) {
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    const relPath = path.relative(projectRoot, filePath);

    // Derive ID from path: assets/components/oasis/model_042.component.json → oasis/model_042
    const relToComponents = path.relative(componentsDir, filePath);
    const id = relToComponents.replace(/\.component\.json$/, '').replace(/\\/g, '/');

    const license = raw.source?.file ? inferLicense(raw.source.file) : undefined;

    components.push({
      id,
      name: raw.name || path.basename(filePath, '.component.json'),
      category: 'uncategorized',
      bounds: raw.bounds,
      voxelCount: raw.voxels?.length ?? 0,
      tags: [],
      componentPath: relPath,
      source: raw.source
        ? { ...raw.source, ...(license ? { license } : {}) }
        : undefined,
    });
  }

  // Sort by id for deterministic output
  components.sort((a, b) => a.id.localeCompare(b.id));

  const registry: Registry = { version: 1, components };

  // 3. Write registry
  fs.writeFileSync(registryPath, JSON.stringify(registry, null, 2));
  const size = fs.statSync(registryPath).size;

  console.log(`\n=== Registry built ===`);
  console.log(`  Components: ${components.length}`);
  console.log(`  Output:     ${registryPath} (${(size / 1024).toFixed(1)} KB)`);
}

main();
