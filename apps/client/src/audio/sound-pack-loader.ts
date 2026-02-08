/**
 * SoundPackLoader — fetches a sound pack manifest and decodes audio files
 * into AudioBuffers that can be used by the SoundManager.
 *
 * Sound packs live under public/sounds/<pack-name>/ and contain:
 *   - pack.json   (SoundPackManifest)
 *   - *.ogg / *.mp3 / *.wav audio files referenced by the manifest
 *
 * Usage:
 *   const buffers = await loadSoundPack('/sounds/battlefield/', audioContext);
 */

import { SoundId, type SoundPackManifest } from './sounds';

/**
 * Load a sound pack from a base URL path.
 * Returns a map of SoundId -> decoded AudioBuffer for each sound defined in the pack.
 */
export async function loadSoundPack(
  baseUrl: string,
  ctx: AudioContext,
): Promise<Map<SoundId, AudioBuffer>> {
  const buffers = new Map<SoundId, AudioBuffer>();

  // Ensure trailing slash
  const base = baseUrl.endsWith('/') ? baseUrl : baseUrl + '/';

  // Fetch manifest
  const manifestUrl = base + 'pack.json';
  const res = await fetch(manifestUrl);
  if (!res.ok) {
    console.warn(`SoundPackLoader: Failed to fetch manifest at ${manifestUrl} (${res.status})`);
    return buffers;
  }

  const manifest: SoundPackManifest = await res.json();
  console.log(`SoundPackLoader: Loading sound pack "${manifest.name}"`);

  // Decode all sound files in parallel
  const entries = Object.entries(manifest.sounds) as Array<[SoundId, string]>;
  const results = await Promise.allSettled(
    entries.map(async ([soundId, filename]) => {
      const url = base + filename;
      const audioRes = await fetch(url);
      if (!audioRes.ok) {
        console.warn(`SoundPackLoader: Failed to fetch ${url} (${audioRes.status})`);
        return;
      }
      const arrayBuffer = await audioRes.arrayBuffer();
      const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
      buffers.set(soundId, audioBuffer);
    }),
  );

  // Log any failures
  let loaded = 0;
  for (const result of results) {
    if (result.status === 'fulfilled') loaded++;
    else console.warn('SoundPackLoader: Failed to decode audio file', result.reason);
  }

  console.log(
    `SoundPackLoader: Loaded ${loaded}/${entries.length} sounds from "${manifest.name}"`,
  );
  return buffers;
}
