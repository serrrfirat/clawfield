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
  private weaponsGain: GainNode | null = null;
  private uiGain: GainNode | null = null;
  private ambienceGain: GainNode | null = null;
  private sfxGain: GainNode | null = null;
  private ambienceBaseGain = 0.8;
  private ambienceDuckUntil = 0;

  /** Cached listener position for distance-based filtering */
  private listenerPos: Vec3 = { x: 0, y: 0, z: 0 };

  /** File-based audio buffers loaded from a sound pack */
  private packBuffers = new Map<SoundId, AudioBuffer>();

  /** Name of the currently loaded sound pack, if any */
  private packName: string | null = null;

  /** Looping sources (ambient beds, low-health loop, downed loop, etc.) */
  private loops = new Map<SoundId, { source: AudioBufferSourceNode; gainNode: GainNode }>();

  /** Create the AudioContext. Must be called after a user gesture (click/key). */
  init(): void {
    if (this.ctx) return;
    try {
      this.ctx = new AudioContext();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = 1.0;

      this.weaponsGain = this.ctx.createGain();
      this.uiGain = this.ctx.createGain();
      this.ambienceGain = this.ctx.createGain();
      this.sfxGain = this.ctx.createGain();

      this.weaponsGain.gain.value = 1.0;
      this.uiGain.gain.value = 0.95;
      this.ambienceGain.gain.value = this.ambienceBaseGain;
      this.sfxGain.gain.value = 1.0;

      this.weaponsGain.connect(this.masterGain);
      this.uiGain.connect(this.masterGain);
      this.ambienceGain.connect(this.masterGain);
      this.sfxGain.connect(this.masterGain);

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
  play(soundId: SoundId, options?: { pitch?: number; volume?: number }): void {
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

    if (options?.pitch) {
      source.playbackRate.value = options.pitch;
    }

    gainNode.connect(this.getBusGain(soundId));

    if (soundId === SoundId.Explosion || soundId === SoundId.ShootShotgun || soundId === SoundId.ShootSniper) {
      this.duckAmbience(0.25);
    }

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
    panner.maxDistance = 260;
    panner.rolloffFactor = 0.8;
    panner.positionX.setValueAtTime(position.x, this.ctx.currentTime);
    panner.positionY.setValueAtTime(position.y, this.ctx.currentTime);
    panner.positionZ.setValueAtTime(position.z, this.ctx.currentTime);

    // Distance-based low-pass filter: distant sounds lose high frequencies
    const dx = position.x - this.listenerPos.x;
    const dy = position.y - this.listenerPos.y;
    const dz = position.z - this.listenerPos.z;
    const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const cutoff = Math.max(800, Math.min(22000, 22000 - distance * 180));

    const distanceFilter = this.ctx.createBiquadFilter();
    distanceFilter.type = 'lowpass';
    distanceFilter.frequency.value = cutoff;
    distanceFilter.Q.value = 0.7;

    gainNode.connect(distanceFilter);
    distanceFilter.connect(panner);
    panner.connect(this.getBusGain(soundId));

    if (soundId === SoundId.Explosion || soundId === SoundId.ShootShotgun || soundId === SoundId.ShootSniper) {
      this.duckAmbience(0.25);
    }

    source.start();
    if (!config.loop) {
      this.scheduleCleanup(soundId, source, duration);
    }
  }

  /** Update the listener position and orientation for spatial audio. */
  updateListener(position: Vec3, forward: Vec3, up: Vec3): void {
    if (!this.ctx) return;

    this.listenerPos.x = position.x;
    this.listenerPos.y = position.y;
    this.listenerPos.z = position.z;

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

    this.updateDuck();
  }

  /** Set mix bus volumes (0-1). Omitted keys keep current values. */
  setMix(values: { master?: number; weapons?: number; ui?: number; ambience?: number; sfx?: number }): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    if (values.master !== undefined && this.masterGain) this.masterGain.gain.setValueAtTime(values.master, t);
    if (values.weapons !== undefined && this.weaponsGain) this.weaponsGain.gain.setValueAtTime(values.weapons, t);
    if (values.ui !== undefined && this.uiGain) this.uiGain.gain.setValueAtTime(values.ui, t);
    if (values.ambience !== undefined && this.ambienceGain) {
      this.ambienceBaseGain = values.ambience;
      this.ambienceGain.gain.setValueAtTime(values.ambience, t);
    }
    if (values.sfx !== undefined && this.sfxGain) this.sfxGain.gain.setValueAtTime(values.sfx, t);
  }

  /** Start a loop if not already active. */
  startLoop(soundId: SoundId, options?: { volume?: number }): void {
    if (!this.ctx) return;
    if (this.loops.has(soundId)) return;
    const config = SOUND_CONFIGS[soundId];
    if (!config?.loop) return;

    const nodes = this.createSource(soundId);
    if (!nodes) return;
    const { source, gainNode } = nodes;
    gainNode.gain.value = options?.volume ?? config.volume;

    const busGain = this.getBusGain(soundId);
    gainNode.connect(busGain);
    source.start();
    this.loops.set(soundId, { source, gainNode });
  }

  /** Stop a loop if active. */
  stopLoop(soundId: SoundId): void {
    const loop = this.loops.get(soundId);
    if (!loop) return;
    try {
      loop.source.stop();
    } catch {
      // ignored
    }
    this.loops.delete(soundId);
  }

  /** Trigger temporary ambience ducking under loud events. */
  duckAmbience(seconds = 0.22): void {
    if (!this.ctx || !this.ambienceGain) return;
    const now = this.ctx.currentTime;
    this.ambienceDuckUntil = Math.max(this.ambienceDuckUntil, now + seconds);
    this.ambienceGain.gain.cancelScheduledValues(now);
    this.ambienceGain.gain.setTargetAtTime(Math.max(0.25, this.ambienceBaseGain * 0.45), now, 0.02);
  }

  // ── Private helpers ─────────────────────────────────────────────

  private getBusGain(soundId: SoundId): GainNode {
    const bus = SOUND_CONFIGS[soundId]?.bus ?? 'sfx';
    if (bus === 'weapons') return this.weaponsGain ?? this.masterGain!;
    if (bus === 'ui') return this.uiGain ?? this.masterGain!;
    if (bus === 'ambience') return this.ambienceGain ?? this.masterGain!;
    return this.sfxGain ?? this.masterGain!;
  }

  private updateDuck(): void {
    if (!this.ctx || !this.ambienceGain) return;
    const now = this.ctx.currentTime;
    if (now > this.ambienceDuckUntil) {
      this.ambienceGain.gain.setTargetAtTime(this.ambienceBaseGain, now, 0.18);
    }
  }

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
      case SoundId.ShootMechanical:
        return this.makeNoiseBurst(0.018, 2600, 'bandpass', 1.4);
      case SoundId.ShootTail:
        return this.makeNoiseBurst(0.3, 300, 'lowpass', 0.4);
      case SoundId.ShootTailNear:
        return this.makeNoiseBurst(0.36, 450, 'lowpass', 0.42);
      case SoundId.ShootTailFar:
        return this.makeNoiseBurst(0.5, 260, 'lowpass', 0.35);
      case SoundId.ShootBass:
        return this.makeBassThump(0.08);
      case SoundId.RocketFire:
        return this.makeRocketLaunch();
      case SoundId.BulletCrack:
        return this.makeBulletCrack();
      case SoundId.Reload:
        return this.makeNoiseBurst(0.05, 1500, 'bandpass', 0.6);
      case SoundId.ReloadDone:
        return this.makeSineTone(900, 0.06);
      case SoundId.DryFire:
        return this.makeNoiseBurst(0.02, 2200, 'bandpass', 1.1);
      case SoundId.FootstepGrass:
        return this.makeNoiseBurst(0.02, 600, 'lowpass', 0.5);
      case SoundId.FootstepStone:
        return this.makeNoiseBurst(0.02, 1200, 'lowpass', 0.6);
      case SoundId.FootstepConcrete:
        return this.makeNoiseBurst(0.02, 1400, 'bandpass', 0.75);
      case SoundId.FootstepWood:
        return this.makeNoiseBurst(0.024, 900, 'bandpass', 0.7);
      case SoundId.FootstepMetal:
        return this.makeNoiseBurst(0.016, 2200, 'bandpass', 0.95);
      case SoundId.FootstepWater:
        return this.makeNoiseBurst(0.03, 500, 'lowpass', 0.55);
      case SoundId.FootstepSprint:
        return this.makeNoiseBurst(0.018, 1100, 'bandpass', 0.85);
      case SoundId.Jump:
        return this.makeNoiseBurst(0.03, 800, 'lowpass', 0.5);
      case SoundId.Land:
        return this.makeNoiseBurst(0.04, 500, 'lowpass', 0.7);
      case SoundId.Explosion:
        return this.makeExplosion();
      case SoundId.ImpactDirt:
        return this.makeNoiseBurst(0.022, 700, 'lowpass', 0.7);
      case SoundId.ImpactConcrete:
        return this.makeNoiseBurst(0.022, 1800, 'bandpass', 0.85);
      case SoundId.ImpactWood:
        return this.makeNoiseBurst(0.024, 1000, 'bandpass', 0.75);
      case SoundId.ImpactMetal:
        return this.makeNoiseBurst(0.02, 2600, 'bandpass', 0.9);
      case SoundId.Ricochet:
        return this.makeBulletCrack();
      case SoundId.HitConfirmDing:
        return this.makeHitDing();
      case SoundId.GrenadeBounce:
        return this.makeNoiseBurst(0.03, 2000, 'bandpass', 0.5);
      case SoundId.AmbientWind:
        return this.makeAmbientWind();
      case SoundId.AmbientBattle:
        return this.makeAmbientBattle();
      case SoundId.AmbientSiren:
        return this.makeAmbientSiren();
      case SoundId.UiLowHealthLoop:
        return this.makeLowHealthLoop();
      case SoundId.UiDownedLoop:
        return this.makeDownedLoop();
      case SoundId.UiReviveStart:
        return this.makeSineTone(560, 0.1);
      case SoundId.UiReviveTick:
        return this.makeSineTone(760, 0.07);
      case SoundId.UiReviveComplete:
        return this.makeSineTone(1050, 0.14);
      case SoundId.UiGadgetReady:
        return this.makeSineTone(820, 0.08);
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

  private makeAmbientBattle(): {
    source: AudioBufferSourceNode;
    gainNode: GainNode;
    duration: number;
  } {
    const ctx = this.ctx!;
    const duration = 3.0;
    const sampleRate = ctx.sampleRate;
    const length = Math.ceil(sampleRate * duration);
    const buffer = ctx.createBuffer(1, length, sampleRate);
    const data = buffer.getChannelData(0);

    for (let i = 0; i < length; i++) {
      const t = i / sampleRate;
      const base = (Math.random() * 2 - 1) * 0.18;
      const rumble = Math.sin(2 * Math.PI * (38 + 8 * Math.sin(t * 0.7)) * t) * 0.08;
      const pulse = Math.sin(2 * Math.PI * 0.25 * t) * 0.03;
      data[i] = (base + rumble + pulse) * 0.8;
    }

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;

    const low = ctx.createBiquadFilter();
    low.type = 'lowpass';
    low.frequency.value = 380;

    const gainNode = ctx.createGain();
    source.connect(low);
    low.connect(gainNode);

    return { source, gainNode, duration };
  }

  private makeAmbientSiren(): {
    source: AudioBufferSourceNode;
    gainNode: GainNode;
    duration: number;
  } {
    const ctx = this.ctx!;
    const duration = 4.0;
    const sampleRate = ctx.sampleRate;
    const length = Math.ceil(sampleRate * duration);
    const buffer = ctx.createBuffer(1, length, sampleRate);
    const data = buffer.getChannelData(0);

    for (let i = 0; i < length; i++) {
      const t = i / sampleRate;
      const lfo = 0.5 + 0.5 * Math.sin(2 * Math.PI * 0.28 * t);
      const freq = 550 + lfo * 250;
      const env = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(2 * Math.PI * 0.13 * t));
      data[i] = Math.sin(2 * Math.PI * freq * t) * env * 0.25;
    }

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;

    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = 950;
    band.Q.value = 0.8;

    const gainNode = ctx.createGain();
    source.connect(band);
    band.connect(gainNode);

    return { source, gainNode, duration };
  }

  private makeLowHealthLoop(): {
    source: AudioBufferSourceNode;
    gainNode: GainNode;
    duration: number;
  } {
    const ctx = this.ctx!;
    const duration = 1.2;
    const sampleRate = ctx.sampleRate;
    const length = Math.ceil(sampleRate * duration);
    const buffer = ctx.createBuffer(1, length, sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) {
      const t = i / sampleRate;
      const beat = Math.max(0, Math.sin(2 * Math.PI * 1.3 * t));
      const tone = Math.sin(2 * Math.PI * 78 * t) * beat;
      const air = (Math.random() * 2 - 1) * 0.03;
      data[i] = tone * 0.25 + air;
    }
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    const gainNode = ctx.createGain();
    source.connect(gainNode);
    return { source, gainNode, duration };
  }

  private makeDownedLoop(): {
    source: AudioBufferSourceNode;
    gainNode: GainNode;
    duration: number;
  } {
    const ctx = this.ctx!;
    const duration = 1.6;
    const sampleRate = ctx.sampleRate;
    const length = Math.ceil(sampleRate * duration);
    const buffer = ctx.createBuffer(1, length, sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) {
      const t = i / sampleRate;
      const pulse = Math.max(0, Math.sin(2 * Math.PI * 0.9 * t));
      const tone = Math.sin(2 * Math.PI * 62 * t) * pulse;
      data[i] = tone * 0.33 + (Math.random() * 2 - 1) * 0.02;
    }
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    const gainNode = ctx.createGain();
    source.connect(gainNode);
    return { source, gainNode, duration };
  }
}

export const soundManager = new SoundManager();
