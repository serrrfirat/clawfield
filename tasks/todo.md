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
