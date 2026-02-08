/**
 * SoundManager — hybrid sound system using Web Audio API.
 *
 * Supports loading external audio files via sound packs, with procedural
 * generation as a fallback for any sounds not covered by the active pack.
 *
 * Usage:
 *   soundManager.init();         // call once after user gesture
 *   await soundManager.loadPack('/sounds/my-pack/');  // optional
 *   soundManager.play(SoundId.ShootRifle);
 *   soundManager.play3D(SoundId.Explosion, { x: 10, y: 0, z: 5 });
 */

import { SoundId, SOUND_CONFIGS } from './sounds';
import { loadSoundPack } from './sound-pack-loader';

export { SoundId } from './sounds';

/** Maximum concurrent instances of the same sound */
const MAX_CONCURRENT = 5;

interface Vec3 {
  x: number;
  y: number;
  z: number;
}

class SoundManager {
  private ctx: AudioContext | null = null;
  private activeCounts = new Map<SoundId, number>();
  private masterGain: GainNode | null = null;

  /** File-based audio buffers loaded from a sound pack */
  private packBuffers = new Map<SoundId, AudioBuffer>();

  /** Name of the currently loaded sound pack, if any */
  private packName: string | null = null;

  /** Create the AudioContext. Must be called after a user gesture (click/key). */
  init(): void {
    if (this.ctx) return;
    try {
      this.ctx = new AudioContext();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = 1.0;
      this.masterGain.connect(this.ctx.destination);
    } catch (e) {
      console.warn('SoundManager: Failed to create AudioContext', e);
    }
  }

  /**
   * Load a sound pack from a URL path. Sounds defined in the pack will
   * override procedural generation. Sounds not in the pack still use
   * the procedural fallback.
   *
   * @param baseUrl Path to sound pack directory (e.g. '/sounds/battlefield/')
   */
  async loadPack(baseUrl: string): Promise<void> {
    if (!this.ctx) {
      console.warn('SoundManager: Cannot load pack before init()');
      return;
    }
    this.packBuffers = await loadSoundPack(baseUrl, this.ctx);

    // Read pack name from manifest (re-fetch is cached by browser)
    try {
      const base = baseUrl.endsWith('/') ? baseUrl : baseUrl + '/';
      const res = await fetch(base + 'pack.json');
      if (res.ok) {
        const manifest = await res.json();
        this.packName = manifest.name ?? null;
      }
    } catch {
      // Name is cosmetic, ignore errors
    }
  }

  /** Unload the current sound pack and revert to procedural sounds. */
  unloadPack(): void {
    this.packBuffers.clear();
    this.packName = null;
    console.log('SoundManager: Sound pack unloaded, using procedural sounds');
  }

  /** Get the name of the currently loaded sound pack, or null. */
  getPackName(): string | null {
    return this.packName;
  }

  /** Play a 2D (non-positional) sound. */
  play(soundId: SoundId): void {
    if (!this.ctx || !this.masterGain) return;
    if (!this.acquireSlot(soundId)) return;

    const config = SOUND_CONFIGS[soundId];
    const nodes = this.createSource(soundId);
    if (!nodes) {
      this.releaseSlot(soundId);
      return;
    }

    const { source, gainNode, duration } = nodes;
    gainNode.gain.value = config.volume;
    gainNode.connect(this.masterGain);

    source.start();
    if (!config.loop) {
      this.scheduleCleanup(soundId, source, duration);
    }
  }

  /** Play a 3D positional sound at a world position. */
  play3D(soundId: SoundId, position: Vec3): void {
    if (!this.ctx || !this.masterGain) return;
    if (!this.acquireSlot(soundId)) return;

    const config = SOUND_CONFIGS[soundId];
    const nodes = this.createSource(soundId);
    if (!nodes) {
      this.releaseSlot(soundId);
      return;
    }

    const { source, gainNode, duration } = nodes;
    gainNode.gain.value = config.volume;

    // Create panner for 3D positioning
    const panner = this.ctx.createPanner();
    panner.panningModel = 'HRTF';
    panner.distanceModel = 'inverse';
    panner.refDistance = 1;
    panner.maxDistance = 100;
    panner.rolloffFactor = 1;
    panner.positionX.setValueAtTime(position.x, this.ctx.currentTime);
    panner.positionY.setValueAtTime(position.y, this.ctx.currentTime);
    panner.positionZ.setValueAtTime(position.z, this.ctx.currentTime);

    gainNode.connect(panner);
    panner.connect(this.masterGain);

    source.start();
    if (!config.loop) {
      this.scheduleCleanup(soundId, source, duration);
    }
  }

  /** Update the listener position and orientation for spatial audio. */
  updateListener(position: Vec3, forward: Vec3, up: Vec3): void {
    if (!this.ctx) return;

    const listener = this.ctx.listener;

    // Use setValueAtTime when available (modern browsers), fallback to direct set
    if (listener.positionX) {
      const t = this.ctx.currentTime;
      listener.positionX.setValueAtTime(position.x, t);
      listener.positionY.setValueAtTime(position.y, t);
      listener.positionZ.setValueAtTime(position.z, t);
      listener.forwardX.setValueAtTime(forward.x, t);
      listener.forwardY.setValueAtTime(forward.y, t);
      listener.forwardZ.setValueAtTime(forward.z, t);
      listener.upX.setValueAtTime(up.x, t);
      listener.upY.setValueAtTime(up.y, t);
      listener.upZ.setValueAtTime(up.z, t);
    } else {
      // Legacy fallback
      listener.setPosition(position.x, position.y, position.z);
      listener.setOrientation(forward.x, forward.y, forward.z, up.x, up.y, up.z);
    }
  }

  // ── Private helpers ─────────────────────────────────────────────

  /**
   * Create a source node for a sound. If the sound pack has a buffer for this
   * sound, use it. Otherwise fall back to procedural generation.
   */
  private createSource(
    soundId: SoundId,
  ): { source: AudioBufferSourceNode; gainNode: GainNode; duration: number } | null {
    if (!this.ctx) return null;

    // Try file-based buffer first
    const packBuffer = this.packBuffers.get(soundId);
    if (packBuffer) {
      return this.makeFromBuffer(packBuffer, soundId);
    }

    // Fall back to procedural generation
    return this.generateSound(soundId);
  }

  /** Create source nodes from a pre-decoded AudioBuffer. */
  private makeFromBuffer(
    buffer: AudioBuffer,
    soundId: SoundId,
  ): { source: AudioBufferSourceNode; gainNode: GainNode; duration: number } {
    const ctx = this.ctx!;
    const config = SOUND_CONFIGS[soundId];

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = config.loop;

    const gainNode = ctx.createGain();
    source.connect(gainNode);

    return { source, gainNode, duration: buffer.duration };
  }

  /** Check if we can play another instance of this sound, and reserve a slot. */
  private acquireSlot(soundId: SoundId): boolean {
    const count = this.activeCounts.get(soundId) ?? 0;
    if (count >= MAX_CONCURRENT) return false;
    this.activeCounts.set(soundId, count + 1);
    return true;
  }

  /** Release a slot when a sound finishes. */
  private releaseSlot(soundId: SoundId): void {
    const count = this.activeCounts.get(soundId) ?? 0;
    this.activeCounts.set(soundId, Math.max(0, count - 1));
  }

  /** Schedule cleanup after a sound finishes playing. */
  private scheduleCleanup(
    soundId: SoundId,
    source: AudioBufferSourceNode,
    duration: number,
  ): void {
    // Add a small buffer to ensure the sound has finished
    const cleanupDelay = (duration + 0.05) * 1000;
    setTimeout(() => {
      try {
        source.stop();
      } catch {
        // Already stopped
      }
      this.releaseSlot(soundId);
    }, cleanupDelay);
  }

  /**
   * Generate a procedural sound for the given SoundId.
   * Returns the source node, a gain node, and the duration in seconds.
   */
  private generateSound(
    soundId: SoundId,
  ): { source: AudioBufferSourceNode; gainNode: GainNode; duration: number } | null {
    if (!this.ctx) return null;

    switch (soundId) {
      case SoundId.ShootRifle:
        return this.makeNoiseBurst(0.08, 800, 'lowpass', 0.9);
      case SoundId.ShootSmg:
        return this.makeNoiseBurst(0.05, 2500, 'lowpass', 0.8);
      case SoundId.ShootShotgun:
        return this.makeNoiseBurst(0.1, 400, 'lowpass', 1.0);
      case SoundId.ShootSniper:
        return this.makeNoiseBurst(0.06, 3000, 'highpass', 0.85);
      case SoundId.Reload:
        return this.makeNoiseBurst(0.05, 1500, 'bandpass', 0.6);
      case SoundId.FootstepGrass:
        return this.makeNoiseBurst(0.02, 600, 'lowpass', 0.5);
      case SoundId.FootstepStone:
        return this.makeNoiseBurst(0.02, 1200, 'lowpass', 0.6);
      case SoundId.Jump:
        return this.makeNoiseBurst(0.03, 800, 'lowpass', 0.5);
      case SoundId.Land:
        return this.makeNoiseBurst(0.04, 500, 'lowpass', 0.7);
      case SoundId.Explosion:
        return this.makeExplosion();
      case SoundId.HitConfirmDing:
        return this.makeSineTone(1200, 0.1);
      case SoundId.GrenadeBounce:
        return this.makeNoiseBurst(0.03, 2000, 'bandpass', 0.5);
      case SoundId.AmbientWind:
        return this.makeAmbientWind();
      case SoundId.CaptureTick:
        return this.makeSineTone(800, 0.08);
      default:
        return null;
    }
  }

  /**
   * Create a short white noise burst with the specified filter.
   * Used for weapon shots, footsteps, reload, etc.
   */
  private makeNoiseBurst(
    duration: number,
    filterFreq: number,
    filterType: BiquadFilterType,
    decayRate: number,
  ): { source: AudioBufferSourceNode; gainNode: GainNode; duration: number } {
    const ctx = this.ctx!;
    const sampleRate = ctx.sampleRate;
    const length = Math.ceil(sampleRate * duration);
    const buffer = ctx.createBuffer(1, length, sampleRate);
    const data = buffer.getChannelData(0);

    // White noise with amplitude decay envelope
    for (let i = 0; i < length; i++) {
      const t = i / length;
      const envelope = Math.pow(1 - t, decayRate);
      data[i] = (Math.random() * 2 - 1) * envelope;
    }

    const source = ctx.createBufferSource();
    source.buffer = buffer;

    // Apply filter
    const filter = ctx.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.value = filterFreq;
    if (filterType === 'bandpass') {
      filter.Q.value = 2;
    }

    const gainNode = ctx.createGain();

    source.connect(filter);
    filter.connect(gainNode);

    return { source, gainNode, duration };
  }

  /**
   * Create an explosion sound: longer noise burst with low-pass filter
   * and a strong decay envelope.
   */
  private makeExplosion(): {
    source: AudioBufferSourceNode;
    gainNode: GainNode;
    duration: number;
  } {
    const ctx = this.ctx!;
    const duration = 0.3;
    const sampleRate = ctx.sampleRate;
    const length = Math.ceil(sampleRate * duration);
    const buffer = ctx.createBuffer(1, length, sampleRate);
    const data = buffer.getChannelData(0);

    // Noise with strong initial hit and exponential decay
    for (let i = 0; i < length; i++) {
      const t = i / length;
      // Sharp attack (first 5%) then exponential decay
      const attack = t < 0.05 ? t / 0.05 : 1;
      const decay = Math.exp(-t * 8);
      data[i] = (Math.random() * 2 - 1) * attack * decay;
    }

    const source = ctx.createBufferSource();
    source.buffer = buffer;

    // Low-pass filter for deep boom
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 300;
    filter.Q.value = 1;

    const gainNode = ctx.createGain();

    source.connect(filter);
    filter.connect(gainNode);

    return { source, gainNode, duration };
  }

  /**
   * Create a sine wave tone (for hit confirm ding, capture tick).
   */
  private makeSineTone(
    frequency: number,
    duration: number,
  ): { source: AudioBufferSourceNode; gainNode: GainNode; duration: number } {
    const ctx = this.ctx!;
    const sampleRate = ctx.sampleRate;
    const length = Math.ceil(sampleRate * duration);
    const buffer = ctx.createBuffer(1, length, sampleRate);
    const data = buffer.getChannelData(0);

    for (let i = 0; i < length; i++) {
      const t = i / sampleRate;
      const tNorm = i / length;
      // Sine wave with smooth fade out
      const envelope = 1 - tNorm;
      data[i] = Math.sin(2 * Math.PI * frequency * t) * envelope;
    }

    const source = ctx.createBufferSource();
    source.buffer = buffer;

    const gainNode = ctx.createGain();
    source.connect(gainNode);

    return { source, gainNode, duration };
  }

  /**
   * Create continuous ambient wind noise (looping).
   * Uses a long buffer that loops seamlessly.
   */
  private makeAmbientWind(): {
    source: AudioBufferSourceNode;
    gainNode: GainNode;
    duration: number;
  } {
    const ctx = this.ctx!;
    const duration = 2.0; // 2-second loop
    const sampleRate = ctx.sampleRate;
    const length = Math.ceil(sampleRate * duration);
    const buffer = ctx.createBuffer(1, length, sampleRate);
    const data = buffer.getChannelData(0);

    // Gentle filtered noise with smooth crossfade at edges for seamless loop
    for (let i = 0; i < length; i++) {
      const t = i / length;
      // Crossfade envelope: fade in at start, fade out at end for seamless loop
      const fadeLength = 0.05; // 5% of buffer
      let envelope = 1;
      if (t < fadeLength) {
        envelope = t / fadeLength;
      } else if (t > 1 - fadeLength) {
        envelope = (1 - t) / fadeLength;
      }
      data[i] = (Math.random() * 2 - 1) * 0.3 * envelope;
    }

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;

    // Heavy low-pass for a soft wind effect
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 400;
    filter.Q.value = 0.5;

    const gainNode = ctx.createGain();

    source.connect(filter);
    filter.connect(gainNode);

    return { source, gainNode, duration };
  }
}

export const soundManager = new SoundManager();
