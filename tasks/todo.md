# Clawfield - Task Tracking

## Active Task: Server-authoritative placement destruction

### Checklist
- [x] Extend shared placement collider/message types for destructible placement events.
- [x] Add server projectile-vs-placement-disc collision and authoritative destroy event broadcast.
- [x] Persist destroyed placement IDs server-side and include them in welcome sync for late joiners.
- [x] Wire client store to consume `placement_destroyed` and queue visual events.
- [x] Hook placement destruction view to server events and placement registration IDs.

### Review
- [ ] Run targeted server/client typecheck for touched files.
- [ ] Validate in two clients that destroyed rocks stop blocking movement and stay destroyed after rejoin.

## Active Task: Integrate GLB weapon models on soldiers

### Checklist
- [x] Audit available weapon GLB assets and map them to gameplay weapon ids.
- [x] Add client weapon model type/config layer (weapon id -> model path + hand offsets).
- [x] Attach active weapon models to soldier hand so local and remote players render correct guns.
- [x] Integrate grenade/smoke grenade GLB visuals into grenade renderer.
- [x] Ensure default soldier loadout renders with a rifle in hand.
- [x] Run client typecheck/build verification.

### Review
- [x] Weapon-model mapping and integration notes documented.
- [x] Verification commands and outcomes documented.

Notes:
- Added weapon visual types + mappings in `apps/client/src/player/weapon-visuals.ts`, including fallback aliases (`"Rifle"` -> assault rifle) and per-weapon hand offsets.
- Added GLB copies to `apps/client/public/models/weapons/` for assault rifle, shotgun, SMGs, sniper, DMR, carbine, PDW, pistol, frag grenade, and smoke grenade.
- `SoldierModel` now mounts the active weapon model to the right-hand bone for both local and remote players via `weaponName`.
- `GrenadeRenderer` now asynchronously loads frag/smoke grenade GLB templates with cube fallback if loading fails.
- Added viewer weapon-fit workflow: enable "Weapon fit mode" in `viewer.html`, then use "Auto Arrange + Save Fit" to auto-fit and export a `.weapon-fit.json` suggestion.

Verification:
- `pnpm --filter client build` fails due to pre-existing unrelated type errors in other files (`src/world/*`, `src/ui/*`, etc.), not in touched weapon files.
- `pnpm --filter client exec tsc --noEmit --pretty false 2>&1 | rg "SoldierModel|weapon-visuals|grenade-renderer|PlayerController|RemotePlayerEntity|weapons/"` returned no matches (no TS errors in modified files).

## Active Task: Add God Rays + Bloom post-processing

### Checklist
- [x] Add scene post-processing pipeline component using `@react-three/postprocessing`.
- [x] Add a dedicated sun light-source mesh for `GodRays`.
- [x] Add global post-processing parameters in client store for weather-driven tuning.
- [x] Expose key controls for iteration (God Rays and Bloom) in debug Leva panel.
- [x] Verify touched files are free of targeted TypeScript errors.

### Review
- Added `apps/client/src/world/PostProcessing.tsx` with `EffectComposer`, `GodRays`, and `Bloom` for a soft summer look.
- Mounted post FX in gameplay experience (`apps/client/src/world/Experience.tsx`) after world rendering.
- Added `postProcessingParameters` in `apps/client/src/stores/useStore.tsx` so weather/game systems can drive visual intensity.
- Added `Post FX` control group in `apps/client/src/world/Controls.tsx` for live tuning.
- Targeted check passed: `pnpm --filter client exec tsc --noEmit --pretty false 2>&1 | rg "PostProcessing|postProcessingParameters|Controls.tsx|Experience.tsx"`.

## Active Task: Add new France AI GLBs and normalize scale

### Checklist
- [x] Copy new GLBs into runtime public model directory.
- [x] Register new `france-ai-*` catalog entries for editor usage.
- [x] Add bake factors for new assets and apply in-place scale baking.
- [x] Preserve existing tuned default scales while baking new assets.
- [x] Validate catalog JSON and texture metadata for new GLBs.

### Review
- Added 5 new AI assets into `apps/client/public/models/props/france/ai_gen/` and synced to `assets/models/props/france/ai_gen/`.
- Registered new entries in `apps/client/src/editor/asset-catalog.json`:
  - `france-ai-narrow-townhouse`
  - `france-ai-wedge-stone-building`
  - `france-ai-stone-village-house`
  - `france-ai-water-canal-section`
  - `france-ai-z-ruin`
- Updated `tools/bake-ai-glb-scales.ts` with new factors and removed forced `defaultScale=1` resets so existing hand-tuned sizes stay intact.
- Ran bake script successfully (`Baked AI GLBs: 10`, `Skipped already-baked files: 48`) and confirmed new files still contain textures.

## Active Task: Add cloud shadows and soft shadow filtering

### Checklist
- [x] Enable renderer shadows in runtime canvas.
- [x] Add moving cloud-cookie spotlight (projected texture) driven by configurable parameters.
- [x] Add drei `SoftShadows` integration for softer painterly shadow edges.
- [x] Ensure map placement meshes cast/receive shadows.
- [x] Expose cloud/soft shadow controls in Leva.

### Review
- Updated lighting pipeline in `apps/client/src/world/Lights.tsx`:
  - directional sun shadow
  - projected cloud cookie spotlight using `noiseTexture.png` map
  - animated cookie offset in `useFrame`
  - optional `SoftShadows` via drei
- Added terrain-level moving cloud shadow modulation in `apps/client/src/shaders/terrain/fragment.glsl` + `apps/client/src/materials/TerrainMaterial.tsx` so cloud movement is visible on the ground even with custom terrain shading.

## Active Task: Implement stylized day/night cycle

### Checklist
- [x] Add shared day/night configuration and state to store.
- [x] Implement orbiting sun/moon lights with painterly color interpolation.
- [x] Add sky + stars and dynamic fog blending for day/sunset/night.
- [x] Sync God Rays sun mesh to day/night sun position.
- [x] Expose time-of-day slider and auto-cycle control in debug UI.

### Review
- Implemented full 24h cycle with 4-stage gradient interpolation (Day -> Sunset -> Night -> Sunrise).
- Added star field that fades in at night.
- Connected all lighting/fog/post-processing systems to `dayNightParameters`.
- Verified smooth transition logic in `apps/client/src/world/Lights.tsx`.

## Active Task: Instanced combat VFX foundation (Phase 0 + Gun Smoke)

### Checklist
- [x] Add reusable instanced particle pool utility for low-allocation updates.
- [x] Add gun smoke instanced renderer using pooled particles.
- [x] Hook local fire path to emit gun smoke bursts.
- [x] Verify targeted client typecheck for new VFX files.

### Review
- [x] Confirm no server-authority gameplay behavior changed (visual-only VFX).

## Active Task: Frag grenade full visual lifecycle refactor

### Checklist
- [x] Replace legacy frag projectile/explosion visuals with lifecycle: toss, telegraph, layered detonation, aftermath.
- [x] Add grenade trail and telegraph countdown pulse tied to fuse.
- [x] Add layered explosion VFX: flash, shockwave ring, debris, smoke cloud, scorch mark.
- [x] Keep smoke and flash grenade paths operational after refactor.
- [x] Verify targeted typecheck for touched combat files.

### Review
- [x] Legacy frag-specific explosion sphere code removed from `apps/client/src/combat/grenade-renderer.ts`.

## Active Task: Physics rubble from destruction

### Checklist
- [x] Bridge Rapier world into destruction view.
- [x] Spawn rubble fragments as dynamic rigid bodies with colliders.
- [x] Keep capped lifetime/count for performance.
- [ ] Playtest tuning for collision feel and perf.
