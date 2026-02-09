/**
 * tile-fetcher.ts — Traverse Google 3D Tiles hierarchy and download GLBs.
 *
 * Google's Photorealistic 3D Tiles use:
 * - Session tokens embedded in top-level content URIs (e.g., `.glb?session=xxx`)
 * - Nested sub-tileset URIs often LACK session tokens — we must propagate them
 * - API key must be appended alongside the session parameter
 * - Deep hierarchy: root → quadtree → sub-tilesets → more quadtrees → leaf GLBs
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import type { TileRef, CLIOptions } from './types.js';
import {
  parseBoundingVolume,
  geodeticToECEF,
} from './geo-utils.js';

const TILES_ROOT = 'https://tile.googleapis.com/v1/3dtiles/root.json';
const BASE_ORIGIN = 'https://tile.googleapis.com';

interface TilesetNode {
  boundingVolume?: Record<string, unknown>;
  geometricError?: number;
  content?: { uri?: string; url?: string };
  children?: TilesetNode[];
  transform?: number[];
  refine?: string;
}

/**
 * Fetch tiles for a lat/lon bounding area.
 */
export async function fetchTiles(opts: CLIOptions, cacheDir: string): Promise<TileRef[]> {
  console.log(`Fetching tiles: center=${opts.lat},${opts.lon} radius=${opts.radius}m`);
  console.log(`  Max geometric error: ${opts.maxGeometricError}`);

  fs.mkdirSync(cacheDir, { recursive: true });

  // Fetch root tileset
  const rootUrl = `${TILES_ROOT}?key=${opts.apiKey}`;
  const rootJson = await fetchJson(rootUrl);

  // Extract session token from the first content URI that has one
  const session = extractSession(rootJson.root);
  if (session) {
    console.log(`  Session token: ${session.slice(0, 10)}...`);
  } else {
    console.warn('  Warning: no session token found in tileset');
  }

  const tiles: TileRef[] = [];
  const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  const originECEF = geodeticToECEF(opts.lat, opts.lon, 0);

  await traverseNode(
    rootJson.root, identity, opts, cacheDir,
    tiles, originECEF, session, 0,
  );

  console.log(`  Found ${tiles.length} tiles to process`);
  return tiles;
}

/**
 * Extract session token from any content URI in the tree.
 */
function extractSession(node: TilesetNode): string | null {
  if (node.content) {
    const uri = node.content.uri ?? node.content.url ?? '';
    const match = uri.match(/[?&]session=([^&]+)/);
    if (match) return match[1];
  }
  if (node.children) {
    for (const child of node.children) {
      const s = extractSession(child);
      if (s) return s;
    }
  }
  return null;
}

async function traverseNode(
  node: TilesetNode,
  parentTransform: number[],
  opts: CLIOptions,
  cacheDir: string,
  results: TileRef[],
  originECEF: [number, number, number],
  session: string | null,
  depth: number,
): Promise<void> {
  if (!node || depth > 30) return;

  // Compose transform
  const localTransform = node.transform ?? [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  const worldTransform = multiply4x4(parentTransform, localTransform);

  // Check bounding volume intersection
  if (node.boundingVolume) {
    const bv = parseBoundingVolume(node.boundingVolume);
    if (bv) {
      const cx = worldTransform[0] * bv.center[0] + worldTransform[4] * bv.center[1] + worldTransform[8] * bv.center[2] + worldTransform[12];
      const cy = worldTransform[1] * bv.center[0] + worldTransform[5] * bv.center[1] + worldTransform[9] * bv.center[2] + worldTransform[13];
      const cz = worldTransform[2] * bv.center[0] + worldTransform[6] * bv.center[1] + worldTransform[10] * bv.center[2] + worldTransform[14];

      const dx = cx - originECEF[0];
      const dy = cy - originECEF[1];
      const dz = cz - originECEF[2];
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

      // Skip if tile sphere doesn't overlap our query area (generous margin)
      if (dist > bv.radius + opts.radius * 3) {
        return;
      }
    }
  }

  const geoError = node.geometricError ?? Infinity;
  const maxError = opts.maxGeometricError;

  // Process content if present
  if (node.content) {
    const contentUri = node.content.uri ?? node.content.url;
    if (contentUri) {
      const fullUrl = resolveUrl(contentUri, opts.apiKey, session);
      const uriType = getUriType(contentUri);

      if (uriType === 'json') {
        // Always recurse into sub-tilesets when we need more detail
        if (geoError > maxError || !node.children?.length) {
          try {
            const subTileset = await fetchJson(fullUrl);
            // Extract session from sub-tileset URIs if available
            const subSession = (subTileset.root ? extractSession(subTileset.root) : null) ?? session;
            if (subTileset.root) {
              await traverseNode(
                subTileset.root, worldTransform, opts, cacheDir,
                results, originECEF, subSession, depth + 1,
              );
            }
          } catch (err) {
            if (opts.verbose) console.warn(`  d${depth} JSON fetch failed: ${String(err)}`);
          }
        }
      } else if (uriType === 'glb') {
        if (geoError <= maxError) {
          // This tile is detailed enough — download it
          const glbPath = await downloadGLB(fullUrl, cacheDir, opts.verbose);
          if (glbPath) {
            // Extract BV center as RTC offset (GLB positions are relative to this)
            let bvCenter: [number, number, number] | undefined;
            if (node.boundingVolume) {
              const bv = parseBoundingVolume(node.boundingVolume);
              if (bv) bvCenter = bv.center;
            }
            results.push({
              glbPath,
              transform: Array.from(worldTransform),
              geometricError: geoError,
              bvCenter,
            });
            if (results.length % 10 === 0) {
              process.stdout.write(`\r  Downloaded ${results.length} tiles...`);
            }
          }
        }
      }
    }
  }

  // Recurse into inline children
  if (node.children) {
    const shouldRecurse = geoError > maxError || !node.content;
    if (shouldRecurse) {
      for (const child of node.children) {
        await traverseNode(
          child, worldTransform, opts, cacheDir,
          results, originECEF, session, depth + 1,
        );
      }
    }
  }
}

/**
 * Determine content type from URI path (before query string).
 */
function getUriType(uri: string): 'glb' | 'json' | 'unknown' {
  const pathPart = uri.split('?')[0];
  if (pathPart.endsWith('.glb') || pathPart.endsWith('.gltf')) return 'glb';
  if (pathPart.endsWith('.json')) return 'json';
  return 'unknown';
}

/**
 * Resolve a content URI to a full URL with API key and session.
 * Propagates the session token to URIs that don't have one.
 */
function resolveUrl(contentUri: string, apiKey: string, session: string | null): string {
  let fullUrl: URL;

  if (contentUri.startsWith('http://') || contentUri.startsWith('https://')) {
    fullUrl = new URL(contentUri);
  } else if (contentUri.startsWith('/')) {
    fullUrl = new URL(contentUri, BASE_ORIGIN);
  } else {
    fullUrl = new URL('/' + contentUri, BASE_ORIGIN);
  }

  // Ensure API key is present
  if (!fullUrl.searchParams.has('key')) {
    fullUrl.searchParams.set('key', apiKey);
  }

  // Propagate session token if the URI doesn't already have one
  if (session && !fullUrl.searchParams.has('session')) {
    fullUrl.searchParams.set('session', session);
  }

  return fullUrl.toString();
}

async function downloadGLB(url: string, cacheDir: string, verbose: boolean): Promise<string | null> {
  // Hash URL (without key/session for cache stability)
  const urlForHash = url.replace(/key=[^&]+/, 'KEY').replace(/session=[^&]+/, 'SESSION');
  const hash = crypto.createHash('md5').update(urlForHash).digest('hex').slice(0, 12);
  const cachePath = path.join(cacheDir, `${hash}.glb`);

  if (fs.existsSync(cachePath)) {
    if (verbose) console.log(`  Cache hit: ${hash}.glb`);
    return cachePath;
  }

  try {
    const resp = await fetch(url);
    if (!resp.ok) {
      if (verbose) console.warn(`  HTTP ${resp.status} for GLB`);
      return null;
    }
    const buffer = Buffer.from(await resp.arrayBuffer());

    // Verify GLB magic
    if (buffer.length < 4 || buffer.readUInt32LE(0) !== 0x46546C67) {
      if (verbose) console.warn(`  Not a valid GLB file, skipping`);
      return null;
    }

    fs.writeFileSync(cachePath, buffer);
    if (verbose) console.log(`  Downloaded: ${hash}.glb (${(buffer.length / 1024).toFixed(0)} KB)`);
    return cachePath;
  } catch (err) {
    if (verbose) console.warn(`  Failed to download GLB: ${String(err)}`);
    return null;
  }
}

async function fetchJson(url: string): Promise<any> {
  const resp = await fetch(url);
  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status}`);
  }
  return resp.json();
}

function multiply4x4(a: number[], b: number[]): number[] {
  const out = new Array(16);
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 4; row++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) {
        sum += a[row + k * 4] * b[k + col * 4];
      }
      out[row + col * 4] = sum;
    }
  }
  return out;
}
