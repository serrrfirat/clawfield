import * as THREE from 'three';
import { CloudDome } from './cloud-dome';
import { WeatherParticles, WeatherType } from './weather-particles';
import { setFogUniforms } from '../voxel/world-renderer';

/**
 * Weather states the system can be in.
 * Each state defines target values for clouds, fog, particles, and sky color.
 */
export type WeatherState = 'clear' | 'cloudy' | 'overcast' | 'rain' | 'snow' | 'storm';

interface WeatherPreset {
  /** Cloud coverage 0-1 */
  cloudCoverage: number;
  /** Cloud opacity 0-1 */
  cloudOpacity: number;
  /** Cloud thickness */
  cloudThickness: number;
  /** Cloud bright color */
  cloudColor: THREE.Color;
  /** Cloud dark/shadow color */
  cloudDarkColor: THREE.Color;
  /** Wind speed (cloud drift) */
  windX: number;
  windZ: number;
  /** Fog near distance */
  fogNear: number;
  /** Fog far distance */
  fogFar: number;
  /** Fog color */
  fogColor: THREE.Color;
  /** Height fog density */
  fogHeightDensity: number;
  /** Sky background color */
  skyColor: THREE.Color;
  /** Particle type */
  particleType: WeatherType;
  /** Particle intensity 0-1 */
  particleIntensity: number;
  /** Sun light intensity */
  sunIntensity: number;
  /** Hemisphere light intensity */
  hemiIntensity: number;
}

const PRESETS: Record<WeatherState, WeatherPreset> = {
  clear: {
    cloudCoverage: 0.25,
    cloudOpacity: 0.7,
    cloudThickness: 0.8,
    cloudColor: new THREE.Color(1.0, 1.0, 1.0),
    cloudDarkColor: new THREE.Color(0.7, 0.72, 0.75),
    windX: 0.008,
    windZ: 0.004,
    fogNear: 120,
    fogFar: 320,
    fogColor: new THREE.Color(0xa9c2d0),
    fogHeightDensity: 0.015,
    skyColor: new THREE.Color(0x7ec8e3),
    particleType: 'none',
    particleIntensity: 0,
    sunIntensity: 1.2,
    hemiIntensity: 0.5,
  },
  cloudy: {
    cloudCoverage: 0.55,
    cloudOpacity: 0.85,
    cloudThickness: 1.0,
    cloudColor: new THREE.Color(0.95, 0.95, 0.95),
    cloudDarkColor: new THREE.Color(0.6, 0.62, 0.65),
    windX: 0.012,
    windZ: 0.006,
    fogNear: 100,
    fogFar: 280,
    fogColor: new THREE.Color(0x9ab0bd),
    fogHeightDensity: 0.02,
    skyColor: new THREE.Color(0x6baed0),
    particleType: 'none',
    particleIntensity: 0,
    sunIntensity: 0.9,
    hemiIntensity: 0.45,
  },
  overcast: {
    cloudCoverage: 0.8,
    cloudOpacity: 0.95,
    cloudThickness: 1.2,
    cloudColor: new THREE.Color(0.82, 0.82, 0.82),
    cloudDarkColor: new THREE.Color(0.5, 0.52, 0.55),
    windX: 0.015,
    windZ: 0.008,
    fogNear: 70,
    fogFar: 220,
    fogColor: new THREE.Color(0x8a9eaa),
    fogHeightDensity: 0.03,
    skyColor: new THREE.Color(0x5a8aaa),
    particleType: 'none',
    particleIntensity: 0,
    sunIntensity: 0.6,
    hemiIntensity: 0.35,
  },
  rain: {
    cloudCoverage: 0.85,
    cloudOpacity: 0.95,
    cloudThickness: 1.3,
    cloudColor: new THREE.Color(0.7, 0.7, 0.72),
    cloudDarkColor: new THREE.Color(0.4, 0.42, 0.45),
    windX: 0.02,
    windZ: 0.01,
    fogNear: 40,
    fogFar: 160,
    fogColor: new THREE.Color(0x728a96),
    fogHeightDensity: 0.04,
    skyColor: new THREE.Color(0x4a7a94),
    particleType: 'rain',
    particleIntensity: 1.0,
    sunIntensity: 0.4,
    hemiIntensity: 0.3,
  },
  snow: {
    cloudCoverage: 0.75,
    cloudOpacity: 0.9,
    cloudThickness: 1.1,
    cloudColor: new THREE.Color(0.9, 0.9, 0.92),
    cloudDarkColor: new THREE.Color(0.6, 0.6, 0.65),
    windX: 0.01,
    windZ: 0.008,
    fogNear: 50,
    fogFar: 180,
    fogColor: new THREE.Color(0xb0bec5),
    fogHeightDensity: 0.025,
    skyColor: new THREE.Color(0x8aa8b8),
    particleType: 'snow',
    particleIntensity: 1.0,
    sunIntensity: 0.7,
    hemiIntensity: 0.4,
  },
  storm: {
    cloudCoverage: 0.95,
    cloudOpacity: 1.0,
    cloudThickness: 1.5,
    cloudColor: new THREE.Color(0.5, 0.5, 0.52),
    cloudDarkColor: new THREE.Color(0.25, 0.27, 0.3),
    windX: 0.04,
    windZ: 0.02,
    fogNear: 20,
    fogFar: 100,
    fogColor: new THREE.Color(0x556068),
    fogHeightDensity: 0.06,
    skyColor: new THREE.Color(0x3a5a6a),
    particleType: 'rain',
    particleIntensity: 1.0,
    sunIntensity: 0.2,
    hemiIntensity: 0.2,
  },
};

/** Lerp helper for numbers */
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * WeatherManager orchestrates the cloud dome, weather particles, fog, and lighting
 * to produce cohesive weather states with smooth transitions.
 */
export class WeatherManager {
  readonly cloudDome: CloudDome;
  readonly weatherParticles: WeatherParticles;

  private scene: THREE.Scene;
  private sunLight: THREE.DirectionalLight;
  private hemiLight: THREE.HemisphereLight | null = null;

  /** Current weather state */
  private currentState: WeatherState = 'clear';
  /** Target weather state we're transitioning to */
  private targetState: WeatherState = 'clear';
  /** Transition progress 0-1 */
  private transitionProgress = 1.0;
  /** Seconds for a full transition */
  private transitionDuration = 5.0;

  /** Current interpolated values */
  private current: WeatherPreset;

  /** Whether underwater (suppresses weather rendering) */
  private underwater = false;

  constructor(scene: THREE.Scene, sunLight: THREE.DirectionalLight) {
    this.scene = scene;
    this.sunLight = sunLight;

    // Find hemisphere light in scene
    scene.traverse((obj: THREE.Object3D) => {
      if (obj instanceof THREE.HemisphereLight) {
        this.hemiLight = obj;
      }
    });

    this.cloudDome = new CloudDome();
    scene.add(this.cloudDome.mesh);

    this.weatherParticles = new WeatherParticles(scene);

    // Initialize to clear
    this.current = { ...PRESETS.clear };
    this.current.cloudColor = PRESETS.clear.cloudColor.clone();
    this.current.cloudDarkColor = PRESETS.clear.cloudDarkColor.clone();
    this.current.fogColor = PRESETS.clear.fogColor.clone();
    this.current.skyColor = PRESETS.clear.skyColor.clone();
    this._applyPreset(this.current);
  }

  /** Get the current weather state */
  get state(): WeatherState {
    return this.transitionProgress >= 1.0 ? this.targetState : this.currentState;
  }

  /** Transition to a new weather state over the given duration (seconds) */
  setWeather(state: WeatherState, duration = 5.0): void {
    if (state === this.targetState && this.transitionProgress >= 1.0) return;
    this.currentState = this.targetState;
    this.targetState = state;
    this.transitionDuration = Math.max(0.1, duration);
    this.transitionProgress = 0;
  }

  /** Set underwater mode (suppresses weather particles and uses underwater fog) */
  setUnderwater(underwater: boolean): void {
    this.underwater = underwater;
  }

  /** Call every frame */
  update(dt: number, cameraPos: { x: number; y: number; z: number }): void {
    // Advance transition
    if (this.transitionProgress < 1.0) {
      this.transitionProgress = Math.min(
        1.0,
        this.transitionProgress + dt / this.transitionDuration,
      );
      this._interpolatePresets();
    }

    // Update cloud dome
    this.cloudDome.update(dt, cameraPos);

    // Update weather particles (skip when underwater)
    if (this.underwater) {
      this.weatherParticles.weatherType = 'none';
    }
    this.weatherParticles.update(dt, cameraPos);

    // Update sun direction on the cloud dome
    const sunDir = this.sunLight.position.clone().sub(this.sunLight.target.position).normalize();
    this.cloudDome.setSunDirection(sunDir);
  }

  /** Interpolate between current and target presets and apply */
  private _interpolatePresets(): void {
    const from = PRESETS[this.currentState];
    const to = PRESETS[this.targetState];
    // Smooth ease-in-out
    const t =
      this.transitionProgress < 0.5
        ? 2 * this.transitionProgress * this.transitionProgress
        : 1 - Math.pow(-2 * this.transitionProgress + 2, 2) / 2;

    this.current.cloudCoverage = lerp(from.cloudCoverage, to.cloudCoverage, t);
    this.current.cloudOpacity = lerp(from.cloudOpacity, to.cloudOpacity, t);
    this.current.cloudThickness = lerp(from.cloudThickness, to.cloudThickness, t);
    this.current.cloudColor.lerpColors(from.cloudColor, to.cloudColor, t);
    this.current.cloudDarkColor.lerpColors(from.cloudDarkColor, to.cloudDarkColor, t);
    this.current.windX = lerp(from.windX, to.windX, t);
    this.current.windZ = lerp(from.windZ, to.windZ, t);
    this.current.fogNear = lerp(from.fogNear, to.fogNear, t);
    this.current.fogFar = lerp(from.fogFar, to.fogFar, t);
    this.current.fogColor.lerpColors(from.fogColor, to.fogColor, t);
    this.current.fogHeightDensity = lerp(from.fogHeightDensity, to.fogHeightDensity, t);
    this.current.skyColor.lerpColors(from.skyColor, to.skyColor, t);
    this.current.particleIntensity = lerp(from.particleIntensity, to.particleIntensity, t);
    this.current.sunIntensity = lerp(from.sunIntensity, to.sunIntensity, t);
    this.current.hemiIntensity = lerp(from.hemiIntensity, to.hemiIntensity, t);

    // Switch particle type at the halfway point
    this.current.particleType = t < 0.5 ? from.particleType : to.particleType;

    this._applyPreset(this.current);
  }

  /** Apply a preset's values to all subsystems */
  private _applyPreset(p: WeatherPreset): void {
    // Cloud dome
    this.cloudDome.coverage = p.cloudCoverage;
    this.cloudDome.opacity = p.cloudOpacity;
    this.cloudDome.thickness = p.cloudThickness;
    this.cloudDome.setColors(p.cloudColor, p.cloudDarkColor);
    this.cloudDome.setWind(p.windX, p.windZ);

    // Fog (only when not underwater — underwater fog is handled by main.ts)
    if (!this.underwater) {
      setFogUniforms({
        color: p.fogColor,
        near: p.fogNear,
        far: p.fogFar,
        heightDensity: p.fogHeightDensity,
      });
      (this.scene.background as THREE.Color).copy(p.skyColor);
    }

    // Weather particles
    this.weatherParticles.weatherType = p.particleType;
    this.weatherParticles.intensity = p.particleIntensity;

    // Lighting
    this.sunLight.intensity = p.sunIntensity;
    if (this.hemiLight) {
      this.hemiLight.intensity = p.hemiIntensity;
    }
  }

  dispose(): void {
    this.scene.remove(this.cloudDome.mesh);
    this.cloudDome.dispose();
    this.weatherParticles.dispose();
  }
}
