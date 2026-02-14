# Clawfield - Task Tracking

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
- Enabled shadows on canvas in `apps/client/src/index.tsx`.
- Enabled cast/receive shadow flags for placed GLBs in `apps/client/src/world/MapPlacements.tsx`.
- Added tuning params in store (`cloudShadowParameters`, `softShadowParameters`) and wired controls in `apps/client/src/world/Controls.tsx`.

## Active Task: In-game HUD style pass (reference-inspired)

### Checklist
- [x] Add a gameplay HUD overlay component with: top-left mission ribbon, bottom-left weapon/ammo cluster, and bottom-center objective lane bar.
- [x] Style the HUD to fit Clawfield visual language (clean low-poly military look, high readability, soft neutral palette).
- [x] Wire HUD to live store values (ammo, reserve-like count placeholder, tickets/capture-derived progress, objective label fallback).
- [x] Mount HUD only during gameplay phase so loader/lobby screens remain clean.
- [x] Verify no new local type issues from added UI files.

### Review
- [x] Visual parity notes vs reference and what was intentionally adapted.
- Adapted elements: top-left mission banner, bottom-left weapon/ammo cluster, bottom-center objective lane bar with notches, right-side objective count.
- Intentional differences: kept Bebas Neue + Clawfield neutral green accent, used store-driven objective progress, and simplified icons to avoid adding external art assets.

## Active Task: Grenade polish + smoke rollback

### Checklist
- [x] Disable unstable smoke renderer runtime path (remove react-smoke hookup).
- [x] Improve grenade throw arc so smoke grenade does not drop immediately.
- [x] Show grenade model in hand while selecting/throwing throwable.
- [x] Research replacement explosion/smoke VFX libraries and asset sources.

### Review
- Smoke visuals were rolled back to baseline (no deployed smoke cloud renderer) to restore gameplay readability.
- Throwables now use clamped target distance and a minimum arc pitch; smoke uses a higher minimum lob.
- Grenade hand model is visible during grenade selection and briefly during throw commit.

## Active Task: Server-authoritative smoke grenade collision

### Checklist
- [x] Add obstacle-disc collision handling inside server smoke grenade simulation.
- [x] Wire game loop to pass authoritative obstacle discs to smoke grenade manager in heightmap mode.
- [x] Keep client as visual-only (no authoritative collision decisions).
- [x] Verify touched server/client files compile for the changed signatures.

### Review
- [x] Smoke grenades bounce against server obstacle discs (placements + terrain-derived blockers).

## Active Task: Integrate vendored stylized water into map flows

### Checklist
- [x] Build a modular adapter component that imports vendored water shaders unchanged.
- [x] Add stylized water plane to runtime terrain using map/match `waterLevel`.
- [x] Add stylized water plane to editor terrain so map creation shows water directly.
- [x] Verify touched files compile without introducing new targeted errors.

### Review
- Water shader source remains untouched under vendored path and is used through an adapter component.
- Runtime and editor now render stylized water as a map element controlled by map `waterLevel`.

## Active Task: Generate fun playable map with France AI assets

### Checklist
- [x] Import `assets/france/ai_gen` GLBs into public runtime model directory.
- [x] Register AI-generated assets in editor map builder catalog.
- [x] Author a new playable mapdef focused on readable lanes/chokepoints and central objective combat.
- [x] Validate JSON structure for new mapdef and asset catalog.

### Review
- Added `assets/maps/france-ai-frontline.mapdef.json` with lane-based layout, mixed cover densities, and flanking routes.
- Added new `france-ai-*` catalog entries and copied GLBs into `apps/client/public/models/props/france/ai_gen/`.

Follow-up:
- Added pinata-ready collision metadata support (`colliderType`, `colliderScale`, `destructible`, `destructionProfile`) in editor asset and placement types.
- Runtime map placements now support per-placement collider mode (`none`/`cuboid`/`trimesh`) and default to enabled colliders.
- Properties panel now exposes collider type + destructible toggle for authored gameplay metadata.

## Active Task: Implement all 'Now' combat features

### Checklist
- [x] Iron sights + hip-fire randomness: bind RMB to ADS, keep hip-fire spread random, and reduce spread when ADS.
- [x] Suppression (server-authoritative): apply suppression on near misses and expose suppression state to clients for feedback.
- [ ] Ammo economy: add reserve ammo pool + strict reload consumption from reserve, resupply via authoritative sources. (Deferred for now)
- [x] Grenade variety: keep frag/smoke and add flashbang with proper throw/select/effect flow.
- [x] HUD updates: display reserve ammo, grenade type, and suppression indicator.
- [x] Validation: run targeted gameplay checks + compile checks to confirm authority path and no regression.

### Implementation plan
- [x] Phase 1 (Input/ADS): move sprint to Shift, use RMB as ADS (`scope=true`) and wire cursor/crosshair behavior.
- [x] Phase 2 (Server firing model): tune `getEffectiveSpread()` and bloom so hip-fire is intentionally less accurate.
- [x] Phase 3 (Suppression): on server shot traces, detect near-miss radius and set `suppressedUntil` on targets.
- [x] Phase 4 (Grenades): add flashbang grenade state/effect pipeline and include in grenade radial selection.
- [x] Phase 5 (Client feedback): camera/HUD suppression response and grenade label/icon update.
- [x] Follow-up planning: AI Game Master architecture and activation plan immediately after these phases.

### Review
- [x] Confirm all collision and gameplay outcomes remain server-authoritative.
- [ ] Confirm ADS/hip-fire feel and suppression intensity are tuned for top-down readability.
- [x] Local projectile visualization now applies spread (with bloom/recovery) instead of always tracing straight to cursor.
- [x] AI Game Master activation architecture documented in `docs/ai-game-master-activation-plan.md` with phased rollout and guardrails.

### Next pass (visibility / LOS)
- [x] Add front-facing FOV visibility for remote player rendering.
- [x] Hide remote players when line-of-sight is blocked by obstacle discs.
- [x] Add subtle rear darkening visual cue (Project Zomboid-style readability aid).
- [x] Verify targeted client typecheck for touched visibility files.

## Completed: BattleBit-Style Visual Enhancement (5 Phases)
- [x] Phase 1: Per-Vertex Ambient Occlusion (mesher.ts, chunk-mesh.ts, world-renderer.ts, viewer.ts, voxel-object-renderer.ts)
- [x] Phase 2: Hi-Res Texture Atlas — 16→32px tiles, LinearFilter + mipmaps (texture-atlas.ts, build-atlas.ts)
- [x] Phase 3: Normal Maps — Sobel-filter normal atlas generation + shader TBN perturbation (build-atlas.ts, world-renderer.ts, texture-atlas.ts)
- [x] Phase 4: Detail Props — grass/rocks/rubble InstancedMesh system (detail-props.ts, world-renderer.ts, main.ts)
- [x] Phase 5: Per-Material PBR & Edge Darkening — materialId vertex attribute, 256x1 PBR lookup texture (roughness/metalness/emissive/edgeDark per material), shader patches for per-material roughness+metalness+emissive, voxel edge darkening for chamfered look, post-processing tuning (bloom threshold 0.80, SSAO radius 2, exposure 0.85)

## Completed: Astroneer-Style Low-Poly Visual Transition
- [x] Phase 0: Playwright test harness (playwright.config.ts, tests/visual-check.spec.ts)
- [x] Phase 1: Enhanced terrain with simplex noise micro-displacement + slope-based coloring (chunk-mesh.ts)
- [x] Phase 2: Surface Nets mesher for buildings — Astroneer-style flat-shaded smooth geometry (surface-nets.ts, voxel-object-renderer.ts, world-renderer.ts)
- [x] Phase 3: Section-based destruction swap — smooth→voxel on damage, 8x8x8 sections (building-section-manager.ts, main.ts)
- [x] Phase 4: Polish — pastelized building palettes, stronger ambient fill, section rebuild cap (voxel-object-renderer.ts, renderer.ts)

## Active Task: Scale Karkand Map to ~600m (1200 voxels)

### Size Comparison
| | Current | Target | BF2 Karkand |
|---|---|---|---|
| Voxels | 300×300 | 1200×1200 | ~1400×1400 equiv |
| World meters | 150m | 600m | ~700m playable |
| VOXEL_SIZE | 0.5m | 0.5m (unchanged) | ~1m |

### Scale Factor: 4×
All X/Z coordinates × 4. Y heights stay the same — buildings are already realistic scale.
Building footprints stay similar. What changes is spacing between landmarks and terrain area.

### Checklist
- [ ] mapdef.json: bounds ±150 → ±600, all coords × 4
- [ ] heightAtKarkand(): scale suburb/factory/river params × 4
- [ ] generateKarkandRoads(): waypoints × 4, wider roads, scaled alley grid
- [ ] generateKarkandBuildings(): scaled block grid, same building sizes
- [ ] generateKarkandRiver(): channel × 4, wider
- [ ] All 9 landmarks: center coords × 4, footprints same or +50%
- [ ] generateKarkandCover(): all positions × 4
- [ ] generateKarkandOutskirts(): all positions × 4
- [ ] generateKarkandPerimeter(): L-shaped wall × 4
- [ ] Generate map, verify output
- [ ] Visual check in viewer

## Active Task: Multiplayer players not visible across browsers

### Checklist
- [x] Reproduce with fresh server/client processes
- [x] Trace client->server join and state sync messages
- [x] Identify root cause in networking/room code
- [x] Implement fix with minimal code changes
- [x] Verify in local two-client run and targeted tests

### Review
- [x] Root cause and evidence documented
- [x] Verification commands and outcomes documented

Root causes:
- stale/multiple websocket sessions can be created in client lifecycle (especially dev/HMR/remount scenarios), causing duplicate in-game clients and confusing multiplayer behavior.
- local client player never applied server `respawn.position`, so each tab stayed at local origin while server/remote players were elsewhere.

Verification:
- Fresh run with killed stale server process (`kill 48216`), then started server+client and executed `pnpm playwright test tests/multiplayer-debug.spec.ts --reporter=line`.
- Server/client sync confirmed: both pages receive `state` payloads with non-empty `remotePlayers`; test passes and server logs show join/deploy/state flow.
- Added client-side respawn position plumbing so `PlayerController` teleports to server-authoritative spawn on `respawn`.

Follow-up:
- Replaced remote-player debug boxes with `SoldierModel` instances, with remote yaw alignment and remote animation state derived from movement deltas.
- Added local position reconciliation against server-authoritative `state` snapshots to keep each client's own rendered position aligned with what other clients receive.
- Reduced bounce/jitter by reconciling local player on XZ only (vertical only on major desync) and adding buffered interpolation for remote model transforms.

## Active Task: Colyseus migration (phase 1)

### Migration Plan
- [x] Define migration phases and compatibility strategy
- [x] Add Colyseus dependencies and bootstrap path behind env flag
- [x] Introduce server room scaffold (`BattleRoom`) with message routing parity for join/input/deploy
- [x] Add client Colyseus transport adapter behind env flag
- [ ] Validate dev boot + two-tab connection in Colyseus mode

### Review
- [x] Phase-1 scope documented (what works vs not yet migrated)
- [x] Run commands + outcomes documented

Commands:
- `pnpm --filter server add colyseus @colyseus/schema @colyseus/ws-transport`
- `pnpm --filter client add colyseus.js`
- `pnpm --filter server build`

Outcome:
- Server compiles with Colyseus bridge and can be enabled via `NETCODE_BACKEND=colyseus`.
- Client transport can be switched via `VITE_NETCODE_BACKEND=colyseus`.

Notes:
- Fixed Colyseus protocol mismatch: server now uses `colyseus@0.16.5` to match `colyseus.js@0.16.22` client.
- Colyseus server/client are running for manual validation.

## Active Task: Netcode hit registration improvements

### Checklist
- [x] Add server-side lag compensation position history
- [x] Apply lag-comp rewound positions during projectile hit validation
- [x] Tune interpolation delay for 30Hz snapshot cadence
- [ ] Manual two-client validation of hit feel and desync perception

### Notes
- Added rolling per-player position history in `GameLoop` and rewound target AABBs by 100ms during projectile intersection checks.
- Increased `INTERPOLATION_DELAY` from 85ms to 100ms to stabilize remote render interpolation at 30Hz updates.

## Active Task: Netcode stabilization passes

### Pass Plan
- [x] Pass 1: fix obvious model/collider vertical alignment mismatch (remote floating)
- [ ] Pass 2: add explicit server-shot timestamp + RTT-aware rewind plumbing for hit validation paths
- [ ] Pass 3: tighten client render/interp against authoritative snapshots with debug overlay deltas
- [ ] Pass 4: validate in two real clients and tune constants from observed deltas

### Notes
- Remote model vertical offset now set to match local model anchor (`REMOTE_MODEL_Y_OFFSET = 0`).
