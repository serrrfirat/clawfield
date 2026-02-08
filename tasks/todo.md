# Clawfield - Task Tracking

## Current Phase: Phase 2 - Polish & Modes

### Phase 0: Foundation - COMPLETE
- [x] Project scaffolding (pnpm monorepo: client + server + shared)
- [x] Shared types, constants, voxel data structures
- [x] Voxel chunk meshing (greedy mesher) + Three.js renderer
- [x] Test map (flat ground + 3 buildings)
- [x] Player entity (WASD, mouse look, jumping, AABB physics)
- [x] WebSocket networking (client ↔ server)
- [x] Server-authoritative position sync (game loop, prediction, reconciliation)
- [x] Full build verification

### Phase 1: Combat Core - COMPLETE
- [x] Hitscan → projectile weapon system (server-authoritative)
- [x] Health, death, respawn (5s timer, tickets)
- [x] TDM mode (ticket-based, game over on 0)
- [x] HUD (health bar, ammo, crosshair, kill feed, hit marker, death/game over overlays)
- [x] Class system (Assault, Medic, Engineer, Recon with different weapons)
- [x] Smart AI bots (Ravenfield-ported: targeting, aim sway, fire rectangle, patrol, sprint)
- [x] Sprint / Crouch / Recoil system (Shift/C keys, weapon-specific recoil)
- [x] Projectile gravity (arc trajectory on server + client)
- [x] Client-predicted projectiles (instant visual feedback for local player)

### Phase 1.5: Ravenfield Ports - COMPLETE
- [x] Capture Points system (gradual control, score multipliers, 3 flags on test map)
- [x] Grenade system (throw physics, bounce, fuse timer, explosion with damage falloff)
- [x] Minimap (canvas-based, player dots, capture point markers, rotating view)
- [x] Capture-point spawning (respawn at owned flags)
- [x] Conquest scoring (flags * SCORE_PER_TICK, 200-point victory threshold)

### Phase 2: Polish & Content
- [ ] Sound effects (gunfire, explosions, footsteps, ambient)
- [ ] Scoreboard overlay (Tab key - player list with KDA stats)
- [x] Shoreline map integration (MagicaVoxel MCP generation + .vox -> chunked .map pipeline)
- [ ] Texture atlas for voxel materials (better visual variety)
- [ ] Chunk LOD (Level of Detail) for distant terrain
- [ ] Class gadgets (medkit, ammo box, spotting scope, deploy cover)
- [ ] Damage indicators (directional damage arrows)
- [ ] Death cam / killcam

### Phase 3: AI Game Master
- [ ] State aggregator (collects match state every 60s)
- [ ] LLM integration (Claude/OpenClaw API calls)
- [ ] Event catalog (fog, artillery, supply drops, etc.)
- [ ] Event executor (server applies AI decisions to game world)
- [ ] Incursion game mode (conquest + AI Game Master)

### Phase 4: Scale & Deploy
- [ ] Scale to 24v24 (bot filling, performance optimization)
- [ ] Matchmaking & lobby system
- [ ] Authentication (guest + account)
- [ ] Cloud deployment (one server per match)
- [ ] Binary protocol (replace JSON for bandwidth)

### Reference Sources
- [x] Ravenfield Beta 5 decompilation (cloned, extracted design data)
- [ ] OpenSpades (https://github.com/yvt/openspades) - voxel FPS reference
