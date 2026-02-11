import { execSync } from 'node:child_process';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { fileURLToPath } from 'node:url';

// ESM-compatible __dirname equivalent
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Generate an Incursion map using the WFC CLI tool.
 * Shells out to `tools/wfc/cli.ts` and writes to `assets/maps/incursion-{seed}.*`.
 * Returns the map name (e.g. `incursion-42`) on success, or null on failure.
 */
export function generateIncursionMap(
  seed: number,
  width: number,
  depth: number,
): string | null {
  const mapName = `incursion-${seed}`;

  // Resolve project root: walk up from this file's location until we find tools/wfc/cli.ts
  let projectRoot = process.cwd();
  if (!fs.existsSync(path.join(projectRoot, 'tools', 'wfc', 'cli.ts'))) {
    let dir = __dirname;
    for (let i = 0; i < 5; i++) {
      dir = path.dirname(dir);
      if (fs.existsSync(path.join(dir, 'tools', 'wfc', 'cli.ts'))) {
        projectRoot = dir;
        break;
      }
    }
  }

  const outputBase = path.join(projectRoot, 'assets', 'maps', mapName);
  const cmd = `npx tsx tools/wfc/cli.ts --seed ${seed} --width ${width} --depth ${depth} --output ${outputBase}`;

  console.log(`[Incursion] Generating WFC map: ${mapName} (${width}x${depth} tiles)...`);

  try {
    const output = execSync(cmd, {
      cwd: projectRoot,
      timeout: 30_000,
      stdio: 'pipe',
    });
    console.log(`[Incursion] WFC output: ${output.toString().trim().split('\n').pop()}`);
    console.log(`[Incursion] WFC map generated: ${mapName}`);

    // Verify the map file was actually created
    const mapFile = outputBase + '.map';
    if (!fs.existsSync(mapFile)) {
      console.warn(`[Incursion] WFC reported success but map file not found: ${mapFile}`);
      return null;
    }

    return mapName;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const stderr = (err as any)?.stderr?.toString?.() ?? '';
    console.warn(`[Incursion] WFC generation failed: ${msg}`);
    if (stderr) console.warn(`[Incursion] WFC stderr: ${stderr}`);
    return null;
  }
}
