import type { MapdefFile } from './mapdef-io';

/**
 * AI Map Generator — file-based protocol with Claude Code.
 *
 * Flow:
 * 1. Editor writes prompt to /tmp/clawfield-ai-prompt.json
 * 2. Editor polls for /tmp/clawfield-ai-result.json
 * 3. Claude Code (running in terminal) detects the prompt, generates a mapdef, writes the result
 * 4. Editor picks up the result and loads it
 *
 * The Vite dev server serves /tmp/ files via the asset proxy, so we use
 * a simpler approach: write prompt via POST to a local endpoint, or
 * just poll a known path.
 *
 * Simplest approach: editor writes the description, user tells Claude Code
 * to generate, Claude Code writes the mapdef, editor loads it via Open.
 *
 * Even simpler: save prompt + auto-poll for result at a known path.
 */

const PROMPT_PATH = '/tmp/clawfield-ai-prompt.json';
const RESULT_PATH = '/tmp/clawfield-ai-result.json';

export interface AIPrompt {
  description: string;
  timestamp: number;
}

/** Save the AI prompt to disk via the Vite dev server */
export async function savePrompt(description: string): Promise<boolean> {
  const prompt: AIPrompt = {
    description,
    timestamp: Date.now(),
  };

  try {
    // Write via a local fetch to the dev server's file-write endpoint
    // Since we can't write files from the browser, we'll use a different approach:
    // Copy to clipboard and save the description for the user to paste to Claude Code
    await navigator.clipboard.writeText(description);
    return true;
  } catch {
    return false;
  }
}

/** Poll for a result mapdef at the known path */
export async function pollForResult(
  startTime: number,
  timeoutMs: number = 120000,
): Promise<MapdefFile | null> {
  const pollInterval = 1000;
  const deadline = startTime + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const resp = await fetch(`/api/ai-result?t=${Date.now()}`);
      if (resp.ok) {
        const data = await resp.json() as { timestamp: number; mapdef: MapdefFile };
        // Only accept results newer than our prompt
        if (data.timestamp > startTime) {
          return data.mapdef;
        }
      }
    } catch {
      // Not ready yet
    }
    await new Promise((r) => setTimeout(r, pollInterval));
  }

  return null;
}

/**
 * Read a mapdef result that Claude Code wrote to disk.
 * The Vite plugin serves files from the project root, so we check
 * assets/maps/_ai_generated.mapdef.json
 */
export async function checkForAIResult(): Promise<MapdefFile | null> {
  try {
    const resp = await fetch(`/assets/maps/_ai_generated.mapdef.json?t=${Date.now()}`);
    if (!resp.ok) return null;
    const mapdef = await resp.json() as MapdefFile;
    if (mapdef.name && mapdef.bounds && mapdef.placements) {
      return mapdef;
    }
    return null;
  } catch {
    return null;
  }
}
