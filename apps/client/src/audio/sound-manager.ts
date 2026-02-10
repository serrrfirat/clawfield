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
const MAX_CONCURRENT = 8;

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

  /**
   * Play a 3D positional sound at a world position.
   * @param options.volume  Override volume (0-1). Defaults to config value.
   * @param options.pitch   Playback rate multiplier. 1.0 = normal. Randomize for variation.
   * @param options.refDistance  Override reference distance for attenuation.
   */
  play3D(
    soundId: SoundId,
    position: Vec3,
    options?: { volume?: number; pitch?: number; refDistance?: number },
  ): void {
    if (!this.ctx || !this.masterGain) return;
    if (!this.acquireSlot(soundId)) return;

    const config = SOUND_CONFIGS[soundId];
    const nodes = this.createSource(soundId);
    if (!nodes) {
      this.releaseSlot(soundId);
      return;
    }

    const { source, gainNode, duration } = nodes;
    gainNode.gain.value = options?.volume ?? config.volume;

    // Pitch variation via playback rate
    if (options?.pitch) {
      source.playbackRate.value = options.pitch;
    }

    // Create panner for 3D positioning
    const panner = this.ctx.createPanner();
    panner.panningModel = 'HRTF';
    panner.distanceModel = 'inverse';
    panner.refDistance = options?.refDistance ?? 5;
    panner.maxDistance = 200;
    panner.rolloffFactor = 0.8;
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
        return this.makeLayeredShot(0.1, 600, 1200, 2.5);
      case SoundId.ShootSmg:
        return this.makeLayeredShot(0.07, 1200, 2800, 2.0);
      case SoundId.ShootShotgun:
        return this.makeLayeredShot(0.14, 200, 600, 3.0);
      case SoundId.ShootSniper:
        return this.makeLayeredShot(0.12, 800, 3500, 3.5);
      case SoundId.ShootTail:
        return this.makeNoiseBurst(0.3, 300, 'lowpass', 0.4);
      case SoundId.ShootBass:
        return this.makeBassThump(0.08);
      case SoundId.RocketFire:
        return this.makeRocketLaunch();
      case SoundId.BulletCrack:
        return this.makeBulletCrack();
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
        return this.makeHitDing();
      case SoundId.GrenadeBounce:
        return this.makeNoiseBurst(0.03, 2000, 'bandpass', 0.5);
      case SoundId.AmbientWind:
        return this.makeAmbientWind();
      case SoundId.CaptureTick:
        return this.makeSineTone(800, 0.08);
      case SoundId.GadgetMedkit:
        return this.makeSineTone(600, 0.15);
      case SoundId.GadgetAmmo:
        return this.makeNoiseBurst(0.06, 1800, 'bandpass', 0.7);
      case SoundId.GadgetSpot:
        return this.makeSineTone(1000, 0.12);
      case SoundId.GadgetCover:
        return this.makeNoiseBurst(0.1, 300, 'lowpass', 0.8);
      case SoundId.GadgetDeploy:
        return this.makeSineTone(900, 0.1);
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
   * Rocket launcher fire: deep ignition thump + propellant hiss/whoosh.
   */
  private makeRocketLaunch(): {
    source: AudioBufferSourceNode;
    gainNode: GainNode;
    duration: number;
  } {
    const ctx = this.ctx!;
    const duration = 0.55;
    const sampleRate = ctx.sampleRate;
    const length = Math.ceil(sampleRate * duration);
    const buffer = ctx.createBuffer(1, length, sampleRate);
    const data = buffer.getChannelData(0);

    for (let i = 0; i < length; i++) {
      const t = i / sampleRate;
      const tNorm = i / length;

      // Layer 1: Deep ignition thump (50Hz sine, sharp attack, fast decay)
      const thumpEnv = t < 0.005 ? t / 0.005 : Math.exp(-t * 15);
      const thump = Math.sin(2 * Math.PI * 50 * t) * thumpEnv * 0.7;

      // Layer 2: Mid punch (150Hz, slightly slower decay)
      const punchEnv = t < 0.003 ? t / 0.003 : Math.exp(-t * 10);
      const punch = Math.sin(2 * Math.PI * 150 * t) * punchEnv * 0.4;

      // Layer 3: Propellant hiss (filtered noise, ramps up then decays)
      const hissAttack = Math.min(1, t / 0.03);
      const hissDecay = Math.exp(-t * 4);
      const hiss = (Math.random() * 2 - 1) * hissAttack * hissDecay * 0.35;

      // Layer 4: Whoosh (noise with falling frequency character via amplitude mod)
      const whooshEnv = t > 0.02 ? Math.exp(-(t - 0.02) * 6) : 0;
      const whoosh = (Math.random() * 2 - 1) * whooshEnv * 0.25;

      // Layer 5: Tail rumble (very low freq noise, slow decay)
      const tailEnv = Math.exp(-tNorm * 2.5);
      const tail = (Math.random() * 2 - 1) * tailEnv * 0.15;

      data[i] = thump + punch + hiss + whoosh + tail;
    }

    const source = ctx.createBufferSource();
    source.buffer = buffer;

    // Low-pass filter to keep it bassy and not too harsh
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 1800;
    filter.Q.value = 0.7;

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
   * Create a layered weapon shot sound: combines a mid-frequency crack
   * with a bass punch and a filtered tail, all in one buffer.
   * Much punchier and more realistic than a simple noise burst.
   */
  private makeLayeredShot(
    duration: number,
    bassFreq: number,
    crackFreq: number,
    punchiness: number,
  ): { source: AudioBufferSourceNode; gainNode: GainNode; duration: number } {
    const ctx = this.ctx!;
    const sampleRate = ctx.sampleRate;
    // Total duration includes the reverb tail
    const totalDuration = duration + 0.15;
    const length = Math.ceil(sampleRate * totalDuration);
    const buffer = ctx.createBuffer(1, length, sampleRate);
    const data = buffer.getChannelData(0);

    for (let i = 0; i < length; i++) {
      const t = i / sampleRate;
      const tNorm = i / length;

      // Layer 1: Sharp transient crack (first 5-15ms)
      const crackEnv = t < 0.002 ? t / 0.002 : Math.exp(-t * 80);
      const crack = (Math.random() * 2 - 1) * crackEnv * 0.8;

      // Layer 2: Mid-frequency body (main tone)
      const bodyEnv = Math.exp(-t * punchiness * 10);
      const body = Math.sin(2 * Math.PI * bassFreq * t + Math.random() * 0.1) * bodyEnv * 0.5;

      // Layer 3: High-frequency noise (metallic crack)
      const noiseEnv = Math.exp(-t * 40);
      const noise = (Math.random() * 2 - 1) * noiseEnv * 0.3;

      // Layer 4: Low bass thump (sub-bass punch)
      const bassEnv = Math.exp(-t * 15);
      const bass = Math.sin(2 * Math.PI * (bassFreq * 0.5) * t) * bassEnv * 0.6;

      // Layer 5: Reverb tail (filtered noise, long decay)
      const tailEnv = Math.pow(1 - tNorm, 0.8) * (t > 0.02 ? 1 : t / 0.02);
      const tail = (Math.random() * 2 - 1) * tailEnv * 0.08;

      data[i] = Math.max(-1, Math.min(1, crack + body + noise + bass + tail));
    }

    const source = ctx.createBufferSource();
    source.buffer = buffer;

    // Bandpass filter to shape the overall sound
    const filter = ctx.createBiquadFilter();
    filter.type = 'peaking';
    filter.frequency.value = crackFreq;
    filter.Q.value = 0.7;
    filter.gain.value = 3;

    const gainNode = ctx.createGain();
    source.connect(filter);
    filter.connect(gainNode);

    return { source, gainNode, duration: totalDuration };
  }

  /**
   * Create a low-frequency bass thump for weapon fire.
   * Layered on top of the main shot for visceral impact.
   */
  private makeBassThump(
    duration: number,
  ): { source: AudioBufferSourceNode; gainNode: GainNode; duration: number } {
    const ctx = this.ctx!;
    const sampleRate = ctx.sampleRate;
    const length = Math.ceil(sampleRate * duration);
    const buffer = ctx.createBuffer(1, length, sampleRate);
    const data = buffer.getChannelData(0);

    for (let i = 0; i < length; i++) {
      const t = i / sampleRate;
      // Fast attack, moderate decay sub-bass sine
      const env = t < 0.005 ? t / 0.005 : Math.exp(-t * 20);
      // Frequency drops slightly over time (pitch down effect)
      const freq = 80 - t * 200;
      data[i] = Math.sin(2 * Math.PI * Math.max(30, freq) * t) * env;
    }

    const source = ctx.createBufferSource();
    source.buffer = buffer;

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 150;

    const gainNode = ctx.createGain();
    source.connect(filter);
    filter.connect(gainNode);

    return { source, gainNode, duration };
  }

  /**
   * BattleBit-style hit confirm: sharp two-tone ding with metallic ring.
   * Much more satisfying than a plain sine tone.
   */
  private makeHitDing(): {
    source: AudioBufferSourceNode;
    gainNode: GainNode;
    duration: number;
  } {
    const ctx = this.ctx!;
    const duration = 0.15;
    const sampleRate = ctx.sampleRate;
    const length = Math.ceil(sampleRate * duration);
    const buffer = ctx.createBuffer(1, length, sampleRate);
    const data = buffer.getChannelData(0);

    for (let i = 0; i < length; i++) {
      const t = i / sampleRate;
      // Sharp attack with fast decay
      const env = t < 0.002 ? t / 0.002 : Math.exp(-t * 25);
      // Two tones for a richer "ding"
      const tone1 = Math.sin(2 * Math.PI * 1400 * t) * 0.6;
      const tone2 = Math.sin(2 * Math.PI * 2100 * t) * 0.4;
      // Metallic shimmer
      const shimmer = Math.sin(2 * Math.PI * 3800 * t) * Math.exp(-t * 50) * 0.15;
      data[i] = (tone1 + tone2 + shimmer) * env;
    }

    const source = ctx.createBufferSource();
    source.buffer = buffer;

    const gainNode = ctx.createGain();
    source.connect(gainNode);

    return { source, gainNode, duration };
  }

  /**
   * Create a supersonic bullet crack/whizz sound.
   * Short, sharp, with a frequency sweep.
   */
  private makeBulletCrack(): {
    source: AudioBufferSourceNode;
    gainNode: GainNode;
    duration: number;
  } {
    const ctx = this.ctx!;
    const duration = 0.06;
    const sampleRate = ctx.sampleRate;
    const length = Math.ceil(sampleRate * duration);
    const buffer = ctx.createBuffer(1, length, sampleRate);
    const data = buffer.getChannelData(0);

    for (let i = 0; i < length; i++) {
      const t = i / sampleRate;
      // Sharp crack with descending frequency sweep
      const env = Math.exp(-t * 60);
      const freq = 4000 - t * 30000; // High to low sweep
      data[i] = Math.sin(2 * Math.PI * Math.max(500, freq) * t) * env * 0.7
        + (Math.random() * 2 - 1) * env * 0.3;
    }

    const source = ctx.createBufferSource();
    source.buffer = buffer;

    const filter = ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = 1000;

    const gainNode = ctx.createGain();
    source.connect(filter);
    filter.connect(gainNode);

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
