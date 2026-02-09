# Three.js Weather Library Research

## Context

Clawfield uses vanilla Three.js v0.170.0 with the built-in `three/examples/jsm/postprocessing/EffectComposer` pipeline (SSAO, custom god rays, FXAA). The game already has:

- Custom height + distance fog shader (`apps/client/src/voxel/world-renderer.ts`)
- Custom god rays shader pass (`apps/client/src/shaders/god-rays.ts`)
- Pooled GPU-instanced particle system (`apps/client/src/combat/particle-system.ts`)

## Key Finding

There is **no single comprehensive weather system library** for Three.js that bundles volumetric fog + rain + snow + volumetric clouds + dynamic transitions. A complete weather system must be assembled from parts.

## Library Analysis

### Tier 1: Easy Integration (no postprocessing migration)

#### sky-cloud-3d

- **Repo:** https://github.com/xiaxiangfeng/sky-cloud-3d
- **What:** Sky dome + volumetric cloud layer as a plain `THREE.Mesh`
- **Features:** Configurable cloud coverage/height/thickness, wind animation, sun direction API
- **Integration:** `scene.add(skyMesh)` — no postprocessing dependency
- **Tradeoff:** Newer/smaller project, clouds are on a dome mesh (not full raymarching)

#### Complete Sky System (Three.js Forum)

- **Source:** https://discourse.threejs.org/t/complete-sky-system-for-three-js-skybox-sun-moon-day-night-cycle-clouds-stars-lensflares/88311
- **What:** All-in-one sky system targeting game developers
- **Features:** Skybox, sun/moon, day/night cycle, cloud layer, star field, lens flares
- **Integration:** Vanilla Three.js, no postprocessing dependency
- **Tradeoff:** Community-shared (not npm published), clouds likely billboard/sprite-based

#### Existing Clawfield Systems (rain, snow, fog)

- **Rain/Snow:** The existing `ParticleSystem` can emit weather particles with appropriate configs (high count + gravity for rain, gentle spread + low gravity for snow)
- **Dynamic Fog:** The existing height+distance fog shader supports runtime uniform updates — adjust `fogConfig` for storm/clear weather transitions

### Tier 2: Higher Quality (requires postprocessing migration)

All Tier 2 options require migrating from `three/examples/jsm/postprocessing/EffectComposer` to `pmndrs/postprocessing` `EffectComposer`. This means migrating SSAO, god rays, FXAA, and the output pass.

#### @takram/three-clouds + @takram/three-atmosphere

- **Repo:** https://github.com/takram-design-engineering/three-geospatial
- **npm:** `@takram/three-clouds` (v0.6.0)
- **License:** MIT, actively maintained
- **What:** Best-in-class volumetric clouds
- **Features:** Beer Shadow Maps for self-shadowing, temporal upscaling (16x fewer texels), light shafts, haze/aerial perspective, quality presets
- **Tradeoff:** Requires `pmndrs/postprocessing`

#### three-volumetric-pass

- **Repo:** https://github.com/Ameobea/three-volumetric-pass
- **What:** Raymarched screen-space volumetric fog and clouds
- **Tradeoff:** Requires `pmndrs/postprocessing`

#### three-good-godrays

- **Repo:** https://github.com/Ameobea/three-good-godrays
- **What:** Robust god rays implementation (same author as three-volumetric-pass)
- **Tradeoff:** Requires `pmndrs/postprocessing`

### Not Recommended

| Library | Reason |
|---|---|
| **three-nebula** | Unmaintained (12+ months), our particle system is better |
| **@react-three/drei** | Requires React Three Fiber |
| **CK42BB/procedural-clouds** | WebGPU primary, WebGL2 fallback is billboard-only |

## Recommendation

### Phase 1 (Immediate)

Use Tier 1 approach — leverage existing systems + add sky-cloud-3d:

1. Add **sky-cloud-3d** for cloud dome with configurable coverage and wind
2. Extend existing **ParticleSystem** with rain/snow emitter configs
3. Add dynamic **fog density control** via existing shader uniforms
4. Wire all three to a **WeatherManager** that transitions between weather states

### Phase 2 (Future, if needed)

If AAA volumetric clouds are desired:

1. Migrate postprocessing pipeline to `pmndrs/postprocessing`
2. Adopt **@takram/three-clouds** for volumetric clouds
3. Adopt **three-volumetric-pass** for volumetric fog
4. Consider **three-good-godrays** to replace custom god rays
