# Clawfield - Product Requirements Document

**Version:** 0.1.0
**Last Updated:** 2025-02-08
**Status:** Draft
**Author:** Engineering Team

---

## 1. Vision & Overview

**Clawfield** is a browser-based voxel battlefield game for 24v24 players, inspired by Ravenfield's accessible, casual battlefield gameplay. What sets Clawfield apart is an **AI Game Master** powered by LLMs (OpenClaw/Claude) that reads the battle state and real-world context to dynamically generate world events during matches — airstrikes, weather shifts, supply drops, objective changes, and more.

### Core Pillars

1. **Accessible Warfare** — Casual Battlefield feel. Easy to pick up, satisfying to master. Not milsim, not twitch-arcade.
2. **AI-Driven Chaos** — An LLM game master that watches the match and creates dramatic, fair, game-changing events.
3. **Voxel Aesthetic** — Chunky, readable art style (Ravenfield-tier fidelity). Architecturally designed for future destructibility.
4. **Browser-Native** — No downloads. Click a link, join a fight. WebGL/WebGPU rendering.
5. **Multiplayer-First** — 24v24 from day one. Cloud-hosted, low-latency sessions.

---

## 2. Target Audience

- **Primary:** Casual FPS players who enjoy Battlefield-lite experiences (Ravenfield, BattleBit Remastered, early Battlefield fans)
- **Secondary:** Players interested in AI-driven game experiences and emergent gameplay
- **Platform:** Modern desktop browsers (Chrome, Firefox, Edge, Safari). Mobile is out of scope for MVP.

---

## 3. Game Design

### 3.1 Gameplay Feel

**Reference:** Ravenfield — the low-poly, accessible Battlefield. Clawfield should feel like Ravenfield with real humans and an AI director.

- **Time-to-kill (TTK):** Medium (2-5 hits depending on weapon/range). Forgiving enough for casual play, punishing enough for skill expression.
- **Movement speed:** Brisk. Sprint, crouch, prone. No slide-canceling meta. Simple, readable movement.
- **Weapon handling:** Hitscan for close-mid range, projectile for long range/explosives. Moderate recoil, learnable patterns.
- **Player count:** 24v24 (48 total). Scalable to 32v32 later.

### 3.2 Class System

Four infantry classes at launch. Each has a primary weapon, secondary, gadget, and class ability.

| Class | Role | Primary Weapons | Gadgets | Class Ability |
|-------|------|-----------------|---------|---------------|
| **Assault** | Frontline fighter | ARs, SMGs | Frag grenades, smoke grenades | Sprint boost (short burst of extra speed) |
| **Medic** | Team sustain | SMGs, Shotguns | Medkit, bandages | Heal aura (small AOE heal over time) |
| **Engineer** | Utility/support | Carbines, PDWs | Ammo box, repair tool | Deploy cover (place a temporary voxel wall) |
| **Recon** | Long-range intel | Sniper rifles, DMRs | Spotting scope, claymores | Mark targets (tagged enemies visible to team) |

**Design notes:**
- Engineer's "deploy cover" is the first hint at the future destruction/construction system
- Classes should feel distinct but not hard-locked. Any class can fight; specialties are additive.
- Loadout customization (weapon attachments, skins) is post-MVP

### 3.3 Game Modes

#### 3.3.1 Team Deathmatch (TDM)
- Two teams, ticket pool per team
- Kills deplete enemy tickets
- First team to 0 tickets loses
- Small-medium map areas
- AI events: lower frequency, focused on map hazards and power weapon drops

#### 3.3.2 Rush
- Attackers must destroy objectives (M-COM stations) in sequential zones
- Defenders protect objectives
- Attackers have limited tickets; defenders have unlimited
- Map opens up zone-by-zone as attackers succeed
- AI events: escalate as attackers advance (defenders get reinforcement events, attackers get support events)

#### 3.3.3 Incursion (AI-Driven Mode) — *Signature Mode*
- Conquest-style control point map
- Teams capture and hold points for score
- **The AI Game Master actively shapes the match:**
  - Spawns dynamic objectives ("Capture the supply cache at grid B4 within 90 seconds for bonus tickets")
  - Creates environmental events (fog rolls in, artillery bombardment on a zone, bridge collapses)
  - Adjusts the battlefield based on score differential (losing team gets subtle advantages)
  - Introduces real-world-flavored events (weather patterns inspired by actual local weather, time-of-day shifts)
- First to score threshold or highest score when time expires wins
- This mode is the flagship differentiator

### 3.4 Map Design Philosophy

**Reference:** Ravenfield maps — multi-lane, varied elevation, infantry-focused with vehicle paths for later.

#### Map Characteristics
- **Size:** Medium-large (comparable to Battlefield Rush maps). ~500m x 500m playable area.
- **Verticality:** Multi-story buildings (2-4 floors), elevated terrain, watchtowers
- **Underground:** Tunnel networks connecting key areas. Flanking routes.
- **Bridges:** Elevated crossings over rivers/canyons. Key chokepoints.
- **Lanes:** 3-lane structure with crossover points. No single dominant sightline.
- **Spawn areas:** Protected spawn zones with multiple exit paths

#### Launch Maps (MVP: 1 map, Target: 3 maps)

**Map 1: "Shoreline" (MVP)**
- Coastal town with a harbor
- Multi-story buildings along the waterfront
- Tunnel system under the main road
- Bridge connecting two hills overlooking the town
- Open beach flank route
- Fits all three game modes

**Map 2: "Ridgeline"**
- Mountain village with terraced buildings
- Cave network through the mountain
- Rope bridges between peaks
- Vertical-heavy gameplay

**Map 3: "Railyard"**
- Industrial area with warehouses and train cars
- Underground service tunnels
- Elevated crane walkways
- Open yard for future vehicle play

### 3.5 Respawn System

- **Ticket-based:** Each team has a ticket pool. Dying costs 1 ticket. Team at 0 loses (TDM/Rush attackers).
- **Respawn timer:** 8 seconds base. Can be reduced by medic proximity.
- **Spawn points:** Base spawn + squad spawn on squad leader (future feature). Captured objectives become spawn points in Incursion.
- **Spawn protection:** 2 seconds of invulnerability after spawning. Removed on firing weapon.

---

## 4. AI Game Master System

This is the core innovation. An LLM-powered system that acts as a real-time game director.

### 4.1 Architecture Overview

```
┌─────────────────────────────────────────────────────┐
│                   Game Server                        │
│                                                      │
│  ┌──────────┐    ┌──────────────┐    ┌───────────┐  │
│  │  Match    │───▶│  State       │───▶│  Event    │  │
│  │  Engine   │    │  Aggregator  │    │  Executor │  │
│  └──────────┘    └──────┬───────┘    └─────▲─────┘  │
│                         │                   │        │
└─────────────────────────┼───────────────────┼────────┘
                          │                   │
                    ┌─────▼───────────────────┴─────┐
                    │       AI Game Master           │
                    │   (OpenClaw / Claude API)      │
                    │                                │
                    │  - Game state analysis          │
                    │  - Event generation             │
                    │  - Balance adjustments          │
                    │  - Real-world context           │
                    └────────────────────────────────┘
```

### 4.2 State Aggregator

Collects and summarizes match state every **60 seconds** (once per minute). Matches are capped at **30 minutes**, giving the AI Game Master up to 30 intervention opportunities per match.

```json
{
  "match_time_elapsed": 342,
  "match_time_remaining": 558,
  "mode": "incursion",
  "score": { "team_a": 320, "team_b": 280 },
  "tickets": { "team_a": 45, "team_b": 52 },
  "control_points": {
    "A": { "owner": "team_a", "contested": false },
    "B": { "owner": "team_b", "contested": true },
    "C": { "owner": "none", "contested": false }
  },
  "player_distribution": {
    "team_a": { "zone_north": 8, "zone_mid": 10, "zone_south": 6 },
    "team_b": { "zone_north": 5, "zone_mid": 12, "zone_south": 7 }
  },
  "recent_events": ["team_a_captured_B", "killing_spree_player_12"],
  "kill_feed_summary": { "team_a_kills_last_60s": 14, "team_b_kills_last_60s": 11 },
  "momentum": "team_a_advancing",
  "real_world_context": {
    "local_weather": "rain",
    "time_of_day": "evening"
  }
}
```

### 4.3 AI Decision Engine

The AI Game Master receives the state summary and a system prompt defining:

1. **Event catalog** — What events are possible (see 4.4)
2. **Balance rules** — Don't stack events against the losing team. Dramatic tension > fairness exploitation.
3. **Pacing rules** — AI checks once per minute. Can issue 0-2 events per check. No forced events — AI can pass.
4. **Narrative coherence** — Events should feel like they belong together. A fog event shouldn't immediately follow a clear-sky airstrike.
5. **Real-world integration** — If it's raining IRL, favor rain/storm events. Evening matches get twilight lighting shifts.

**Response format:**
```json
{
  "events": [
    {
      "type": "artillery_barrage",
      "target_zone": "zone_mid",
      "delay_seconds": 5,
      "duration_seconds": 15,
      "warning": true,
      "flavor_text": "Command reports incoming artillery — clear the railyard!"
    }
  ],
  "narrative_note": "Team B is pushing hard on mid. Artillery to force repositioning and create drama.",
  "next_check_seconds": 20
}
```

### 4.4 Event Catalog

#### Environmental Events
| Event | Description | Duration | Warning |
|-------|-------------|----------|---------|
| **Fog** | Reduces visibility across the map or a zone | 30-60s | 5s |
| **Rain/Storm** | Visual + audio. Slightly reduces weapon accuracy | 60-120s | 10s |
| **Dust Storm** | Severe visibility reduction in open areas | 20-40s | 5s |
| **Night Shift** | Lighting changes to night. Introduces flares/flashlights | 90-180s | 15s |
| **Earthquake** | Screen shake, visual cracks. Precursor to future destruction events | 5-10s | 3s |

#### Tactical Events
| Event | Description | Duration | Warning |
|-------|-------------|----------|---------|
| **Artillery Barrage** | Danger zone in a map area. Lethal if caught | 10-20s | 5s |
| **Supply Drop** | Crate drops in a contested area. Contains power weapons/health | Persistent | 10s |
| **Reinforcement Wave** | Losing team gets instant respawns for N players | Instant | 0s |
| **Objective Shift** | A new temporary capture point appears | 60-90s | 10s |
| **Comms Disruption** | One team temporarily loses minimap | 15-30s | 5s |

#### Dramatic Events
| Event | Description | Duration | Warning |
|-------|-------------|----------|---------|
| **Airstrike** | Targeted bombing run on a small area | 8s | 5s |
| **Bridge Collapse** | A bridge becomes impassable (pre-destruction preview) | Rest of match | 15s |
| **Floodgate** | Water rises in low areas, forcing players to higher ground | 30-60s | 10s |
| **Power Outage** | Interior lighting goes out. Exteriors unaffected | 20-40s | 5s |

### 4.5 Guardrails

The AI Game Master must operate within strict bounds:

- **No pay-to-win:** Events never favor players who paid money
- **Skill-neutral:** Events affect areas, not specific players
- **Cooldowns:** Major events have minimum cooldowns (60s). No event stacking.
- **Veto system:** Server can reject events that would break game state
- **Fallback:** If AI is unreachable, a deterministic event system triggers pre-scripted events based on score differential and time elapsed
- **Latency budget:** AI calls must return within 3 seconds. If slower, use cached/fallback events.
- **Rate limiting:** 1 AI call per minute per match (30 calls max per 30-minute match). Cost-efficient by design.
- **Match duration:** 30 minutes maximum. Time-limited to control AI costs and keep matches focused.

---

## 5. Technical Architecture

### 5.1 Technology Stack

| Layer | Technology | Rationale |
|-------|-----------|-----------|
| **Rendering** | Three.js (WebGL2, WebGPU-ready) | Most mature browser 3D library. Voxel-friendly. |
| **UI** | HTML/CSS overlay + React | HUD, menus, chat. Separate from 3D canvas. |
| **Client Language** | TypeScript | Type safety, tooling, team scalability |
| **Physics (Movement)** | Custom AABB vs voxel grid | Tight FPS feel. Direct voxel lookup, no collider objects. Same code on client+server. |
| **Physics (Dynamic)** | Rapier.js (WASM+SIMD) | Grenades, future vehicles, ragdolls. Native voxel collider (`ColliderDesc.voxels`). Cross-platform deterministic. |
| **Networking** | WebSocket + WebRTC DataChannels | WS for reliable (chat, events), WebRTC for unreliable (positions, inputs) |
| **Server** | Node.js (game logic) | JS/TS isomorphism with client. Shared types/validation. |
| **Server Framework** | Custom ECS game loop | Entity-Component-System for game state. Not a web framework. |
| **AI Backend** | Claude API / OpenClaw | LLM game master. HTTP calls from server. |
| **Map Authoring** | MagicaVoxel + custom .vox pipeline | Hand-craft assets in MagicaVoxel, parse .vox directly into chunk data. |
| **Map Pipeline CLI** | Vengi voxconvert | Batch format conversion, Lua scripting for asset transforms. |
| **Infrastructure** | Cloud VMs (fly.io / Railway / AWS) | Auto-scaling game server instances |
| **Database** | PostgreSQL (persistent) + Redis (session) | Player accounts, match history. Redis for matchmaking/lobby. |
| **CDN** | Cloudflare | Static assets, voxel map data |
| **Auth** | JWT + OAuth (Google/Discord) | Passwordless preferred |

### 5.2 Client Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        Browser Client                        │
│                                                              │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────────┐  │
│  │  Renderer     │  │  Game State  │  │  Network Manager  │  │
│  │  (Three.js)   │  │  (ECS)       │  │  (WS + WebRTC)    │  │
│  │              │  │              │  │                   │  │
│  │  - Voxel mesh │  │  - Entities  │  │  - Input sending  │  │
│  │  - Lighting   │  │  - Components│  │  - State receiving│  │
│  │  - Particles  │  │  - Systems   │  │  - Interpolation  │  │
│  │  - Camera     │  │  - Prediction│  │  - Prediction     │  │
│  └──────┬───────┘  └──────┬───────┘  └────────┬──────────┘  │
│         │                 │                     │             │
│  ┌──────▼─────────────────▼─────────────────────▼──────────┐ │
│  │                    Game Loop (60fps)                      │ │
│  │  1. Process inputs                                       │ │
│  │  2. Apply network updates                                │ │
│  │  3. Run prediction                                       │ │
│  │  4. Update ECS                                           │ │
│  │  5. Render frame                                         │ │
│  └──────────────────────────────────────────────────────────┘ │
│                                                              │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────────┐  │
│  │  Input        │  │  Audio       │  │  UI (React)       │  │
│  │  Manager      │  │  Manager     │  │  HUD, menus,      │  │
│  │  KB+M, touch  │  │  Spatial,    │  │  scoreboard,      │  │
│  │              │  │  ambient     │  │  events feed       │  │
│  └──────────────┘  └──────────────┘  └───────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

### 5.3 Server Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      Game Server Instance                     │
│                     (One per active match)                    │
│                                                              │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────────┐  │
│  │  Authoritative│  │  AI Game     │  │  Network          │  │
│  │  Game State   │  │  Master      │  │  Layer            │  │
│  │  (ECS)        │  │  Interface   │  │                   │  │
│  │              │  │              │  │  - Client conns   │  │
│  │  - Physics    │  │  - State agg │  │  - State broadcast│  │
│  │  - Collision  │  │  - LLM calls │  │  - Input process  │  │
│  │  - Damage     │  │  - Event exec│  │  - Anti-cheat     │  │
│  │  - Scoring    │  │  - Fallback  │  │                   │  │
│  └──────────────┘  └──────────────┘  └───────────────────┘  │
│                                                              │
│  ┌──────────────────────────────────────────────────────────┐│
│  │              Server Game Loop (20 tick/s)                 ││
│  │  1. Receive + validate client inputs                     ││
│  │  2. Simulate game state (physics, damage, scoring)       ││
│  │  3. Check AI Game Master for events                      ││
│  │  4. Execute events                                       ││
│  │  5. Broadcast state delta to clients                     ││
│  └──────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────┘
```

### 5.4 Voxel Engine Design

#### 5.4.1 Voxel Representation

**Chunk-based system** (like Minecraft but tuned for combat):

- **Voxel size:** 0.5m x 0.5m x 0.5m (human = ~4 voxels tall)
- **Chunk size:** 16x16x16 voxels
- **Map size:** ~64x16x64 chunks = 512x128x512 voxels = 256m x 64m x 256m per map section
- **Voxel data:** 1 byte per voxel (material ID, 0 = air). Compact.

```typescript
interface Chunk {
  position: { x: number; y: number; z: number }; // chunk coords
  voxels: Uint8Array; // 16*16*16 = 4096 bytes
  mesh: THREE.Mesh | null; // generated mesh, cached
  dirty: boolean; // needs remeshing
}

interface VoxelWorld {
  chunks: Map<string, Chunk>; // key = "x,y,z"
  materials: VoxelMaterial[]; // palette of materials (grass, stone, metal, etc.)
}
```

#### 5.4.2 Rendering Pipeline

1. **Greedy meshing** — Combine adjacent same-material faces into larger quads. Critical for performance.
2. **Face culling** — Only generate faces between solid and air voxels. Interior faces are invisible.
3. **Chunk LOD** — Distant chunks use simplified meshes (1/4 resolution).
4. **Frustum culling** — Only render chunks in camera view.
5. **Instanced rendering** — For repeated decorative elements (grass tufts, debris).
6. **Texture atlas** — Single texture with all voxel material UVs. One draw call per chunk.

**Target:** 60fps with 48 players on mid-range hardware (GTX 1060 / integrated GPU equivalent).

#### 5.4.3 Destruction-Ready Architecture

Even though MVP is static, the voxel system must support future destruction:

- **Voxel modification API:** `setVoxel(x, y, z, materialId)` exists from day 1
- **Chunk dirty flag:** Triggers remeshing when voxels change
- **Structural integrity system:** (Deferred) Placeholder interfaces for checking if a structure should collapse
- **Debris particle system:** (Deferred) Placeholder for spawning voxel debris on destruction
- **Network sync:** Voxel changes are events that can be broadcast to all clients

```typescript
// Future-proofing interfaces (not implemented in MVP)
interface DestructionEvent {
  chunks_affected: string[];
  voxels_destroyed: { x: number; y: number; z: number; material: number }[];
  debris_particles: { position: Vector3; velocity: Vector3; material: number }[];
}

interface StructuralIntegrity {
  checkSupport(chunk: Chunk): boolean;
  propagateCollapse(origin: Vector3, radius: number): DestructionEvent;
}
```

### 5.5 Physics Architecture (Hybrid)

Two-layer physics system: custom AABB for movement, Rapier.js for dynamic objects.

#### Layer 1: Custom AABB (Player Movement + Hitscan)

- **Player-vs-world collision:** AABB swept against voxel grid. Direct lookup into chunk arrays — O(1) per axis. No collider objects to create/destroy.
- **Hitscan weapons:** DDA (Digital Differential Analyzer) raycasting through voxel grid. Faster and more precise than general-purpose physics raycasting for grid-aligned worlds.
- **Step-up:** Players can step onto voxels ≤1 voxel high without jumping (staircase feel).
- **Slope handling:** Voxel terrain is inherently blocky — no slope math needed.
- **Runs identically on client and server:** Pure TypeScript, no WASM dependency for this layer. Deterministic by construction.

Reference implementation: [voxel-physics-engine](https://github.com/fenomas/voxel-physics-engine)

#### Layer 2: Rapier.js (Dynamic Objects)

- **Grenades:** Projectile arcs with bounce, friction, and explosion radius.
- **Future vehicles:** Wheel physics, suspension springs.
- **Terrain collider:** Uses Rapier's native `ColliderDesc.voxels` shape (added v0.16.0, April 2025). Updated via `Collider.setVoxel()` when terrain changes.
- **Packages:**
  - Client: `@dimforge/rapier3d-simd` (SIMD-accelerated, best performance)
  - Server: `@dimforge/rapier3d-deterministic` (cross-platform deterministic)
- **Note:** Rapier's voxel support is experimental — shape-casting on voxels and voxel-vs-voxel collision are not yet supported. This is fine for MVP (grenades-vs-terrain only).

### 5.6 Map Authoring Pipeline

#### Workflow

```
MagicaVoxel (hand-craft)     TypeScript (procedural)
        │                            │
        ▼                            ▼
    .vox files                   .vox files
        │                            │
        └──────────┬─────────────────┘
                   │
                   ▼
        Custom .vox Parser (TypeScript)
                   │
                   ▼
        Map Definition File (JSON)
        ┌─────────────────────────────┐
        │  {                          │
        │    "name": "Shoreline",     │
        │    "chunks": [...],         │
        │    "spawn_points": [...],   │
        │    "objectives": [...],     │
        │    "assets": [              │
        │      { "file": "building_a.vox", "pos": [10,0,5] },  │
        │      { "file": "bridge.vox", "pos": [30,0,20] }      │
        │    ]                        │
        │  }                          │
        └─────────────────────────────┘
                   │
                   ▼
        Build step → Compressed binary chunks (.bin)
                   │
                   ▼
        CDN → Client streams chunks on load
```

#### MagicaVoxel Capabilities & Limits

- **Per-model max:** 256x256x256 voxels
- **World editor:** 2000x2000x1000 total (tiles multiple models)
- **Our map size:** ~1000x128x1000 voxels → fits as 4x1x4 = 16 tiles of 256x128x256
- **Supports:** Multi-story buildings, tunnels, bridges, complex interiors — all confirmed
- **Scripting:** GLSL shaders for procedural generation (noise, mazes, patterns) — GUI-only, no CLI
- **Export:** OBJ, PLY, QB, XRAW. No native glTF (use Vengi voxconvert for conversion)

#### .vox Parser Strategy

The .vox format is simple (RIFF-style chunks). We write our own parser:

```typescript
// Core .vox reading — no dependency on MagicaVoxel at runtime
interface VoxModel {
  size: { x: number; y: number; z: number };
  voxels: Array<{ x: number; y: number; z: number; colorIndex: number }>;
  palette: Uint8Array; // 256 * 4 (RGBA)
}

function parseVox(buffer: ArrayBuffer): VoxModel[] { /* ... */ }
```

Existing libraries for reference: `parse-magica-voxel` (read), `vox-file-generator` (write).

#### Vengi voxconvert (Pipeline Automation)

For batch operations, Vengi's CLI tool handles format conversion and asset transforms:
```bash
# Convert .vox to glTF (if needed for external tools)
voxconvert --input map.vox --output map.gltf

# Apply Lua script effects (snow, grass, etc.)
voxconvert --input building.vox --script add_snow.lua --output building_snow.vox
```

### 5.7 Networking Model

#### 5.7.1 Authority Model
- **Server-authoritative:** Server owns all game state. Client sends inputs, server validates and simulates.
- **Client-side prediction:** Client predicts own movement immediately. Server corrects if wrong.
- **Entity interpolation:** Other players are rendered at slightly delayed positions for smoothness.
- **Lag compensation:** Server rewinds time for hit detection based on client's reported timestamp.

#### 5.7.2 Network Protocol

**Reliable channel (WebSocket):**
- Match state changes (score updates, player joins/leaves)
- AI Game Master events
- Chat messages
- Match lifecycle (start, end, phase transitions)

**Unreliable channel (WebRTC DataChannel):**
- Player position/rotation (20 ticks/sec from server)
- Player input (keyboard/mouse state, sent every frame)
- Projectile states
- Health updates

#### 5.7.3 Bandwidth Budget

Target: **<50 KB/s per player** (both directions)

| Data | Size | Frequency | Bandwidth |
|------|------|-----------|-----------|
| Player position update (all 48) | ~20 bytes x 47 | 20/s | ~18.8 KB/s |
| Own input | ~12 bytes | 60/s | ~0.7 KB/s |
| Game events | ~100 bytes | 2/s | ~0.2 KB/s |
| AI events | ~200 bytes | 0.5/s | ~0.1 KB/s |
| **Total per player** | | | **~20 KB/s** |

Delta compression and binary encoding bring this well within budget.

#### 5.7.4 Tick Rate & Latency

- **Server tick rate:** 20Hz (50ms per tick). Standard for 48-player games.
- **Client render rate:** 60fps (interpolating between server ticks)
- **Target latency:** <100ms for good experience, playable up to 200ms
- **Regions:** Start with US-East, US-West. Expand to EU, Asia based on demand.

### 5.8 Map Data Format

Maps are authored as voxel data and stored as compressed binary:

```
map_name/
  meta.json          # Map metadata (name, size, spawn points, objectives)
  chunks/
    0_0_0.bin        # Compressed voxel data per chunk
    0_0_1.bin
    ...
  lightmap.bin        # Pre-baked ambient occlusion
  navmesh.json        # Navigation data (for future AI bots)
```

- **Loading:** Chunks stream progressively. Nearest chunks first.
- **Size:** ~2-5MB per map compressed (voxel data compresses extremely well)
- **Authoring:** Custom voxel editor (future), or MagicaVoxel export pipeline

---

## 6. Infrastructure & DevOps

### 6.1 Server Hosting

```
                    ┌─────────────────┐
                    │   Load Balancer  │
                    │   (Lobby/Match   │
                    │    making)       │
                    └────────┬────────┘
                             │
              ┌──────────────┼──────────────┐
              │              │              │
       ┌──────▼──────┐ ┌────▼────┐ ┌───────▼─────┐
       │ Game Server │ │  Game   │ │  Game       │
       │ Instance 1  │ │  Server │ │  Server     │
       │ (Match A)   │ │  Inst 2 │ │  Instance N │
       └─────────────┘ └─────────┘ └─────────────┘
```

- **One server process per match.** Isolated. No shared state between matches.
- **Matchmaking service:** Separate process. Creates matches, assigns servers.
- **Auto-scaling:** Spin up server instances on demand. Shut down empty ones.
- **Target:** Each server instance handles 1 match (48 players). ~512MB RAM, 1 vCPU.

### 6.2 Database Schema (Core)

```sql
-- Players
CREATE TABLE players (
  id UUID PRIMARY KEY,
  display_name VARCHAR(32) NOT NULL,
  auth_provider VARCHAR(20), -- 'google', 'discord'
  auth_id VARCHAR(128),
  created_at TIMESTAMP DEFAULT NOW(),
  last_seen TIMESTAMP,
  stats JSONB DEFAULT '{}'
);

-- Match History
CREATE TABLE matches (
  id UUID PRIMARY KEY,
  mode VARCHAR(20) NOT NULL, -- 'tdm', 'rush', 'incursion'
  map_name VARCHAR(64) NOT NULL,
  started_at TIMESTAMP,
  ended_at TIMESTAMP,
  winner VARCHAR(10), -- 'team_a', 'team_b', 'draw'
  final_score JSONB,
  ai_events_log JSONB -- full log of AI game master decisions
);

-- Player-Match Junction
CREATE TABLE match_players (
  match_id UUID REFERENCES matches(id),
  player_id UUID REFERENCES players(id),
  team VARCHAR(10),
  class VARCHAR(20),
  kills INT DEFAULT 0,
  deaths INT DEFAULT 0,
  score INT DEFAULT 0,
  PRIMARY KEY (match_id, player_id)
);
```

---

## 7. Milestones & Phasing

### Phase 0: Foundation (Weeks 1-4)
**Goal:** Bare-bones engine proof-of-concept

- [ ] Project scaffolding (monorepo: client + server + shared)
- [ ] Voxel chunk system with greedy meshing
- [ ] Basic Three.js renderer with camera controls
- [ ] Load a test map (flat ground + simple buildings)
- [ ] Player entity: WASD movement, mouse look, jumping
- [ ] WebSocket connection between client and server
- [ ] Server-authoritative position sync for 2 players

**Exit criteria:** Two browser tabs showing two players moving in a voxel world, synced.

### Phase 1: Combat Core (Weeks 5-8)
**Goal:** Shooting works, people can die

- [ ] Hitscan weapon system (assault rifle)
- [ ] Health, damage, death, respawn
- [ ] Ticket system
- [ ] Basic HUD (health, ammo, tickets, killfeed)
- [ ] Class system (4 classes with distinct weapons)
- [ ] Class gadgets (medkit, ammo box, spotting scope, cover deploy)
- [ ] Collision detection (player-world)
- [ ] Client-side prediction + server reconciliation
- [ ] Team Deathmatch mode

**Exit criteria:** 4+ players can play a TDM match in a browser.

### Phase 2: Map & Polish (Weeks 9-12)
**Goal:** A real map that feels good to play on

- [ ] "Shoreline" map — full design with buildings, tunnels, bridges
- [ ] Voxel material system (different block types, textures)
- [ ] Texture atlas for voxel rendering
- [ ] Basic lighting (directional sun + ambient)
- [ ] Chunk LOD for distant terrain
- [ ] Sound effects (gunfire, footsteps, ambient)
- [ ] Scoreboard
- [ ] Player names above heads
- [ ] Minimap

**Exit criteria:** The Shoreline map is playable and visually coherent.

### Phase 3: AI Game Master (Weeks 13-16)
**Goal:** The AI director is live and creating events

- [ ] State Aggregator service (collects match state every 15s)
- [ ] AI Game Master API integration (Claude/OpenClaw)
- [ ] System prompt engineering for the game master
- [ ] Event executor (receives AI decisions, applies to game world)
- [ ] Environmental events: fog, rain, dust storm
- [ ] Tactical events: artillery barrage, supply drop
- [ ] Event HUD notifications ("Warning: Artillery incoming in Zone B!")
- [ ] Fallback deterministic event system
- [ ] Incursion game mode
- [ ] Real-world context feed (weather API integration)

**Exit criteria:** A match of Incursion where the AI creates 5+ distinct events that feel dramatic and fair.

### Phase 4: Scale & Ship (Weeks 17-20)
**Goal:** 24v24, production-ready

- [ ] Scale testing: 48 simultaneous connections
- [ ] Network optimization (delta compression, binary protocol)
- [ ] Matchmaking service (queue, team balancing)
- [ ] Lobby system (waiting room before match)
- [ ] Authentication (Google/Discord OAuth)
- [ ] Player profiles (stats, match history)
- [ ] Rush game mode
- [ ] Anti-cheat basics (server-side validation, rate limiting)
- [ ] Performance profiling and optimization pass
- [ ] Cloud deployment (auto-scaling server instances)

**Exit criteria:** 24v24 match runs smoothly for 15 minutes with AI events.

### Future Phases (Post-MVP)
- Vehicle system (tanks, helicopters, boats)
- Destructible voxel terrain
- Construction system (Engineer class expansion)
- More maps
- Ranked matchmaking
- Weapon attachments & cosmetics
- Replay system
- Spectator mode
- Mobile support
- Mod tools

---

## 8. Performance Budgets

| Metric | Target | Maximum |
|--------|--------|---------|
| Client FPS | 60 | 30 (minimum playable) |
| Server tick rate | 20Hz | 10Hz (degraded) |
| Client memory | <512MB | <1GB |
| Initial load time | <5s | <10s |
| Map download size | <5MB | <10MB |
| Network bandwidth per player | <30 KB/s | <50 KB/s |
| AI Game Master response time | <2s | <3s |
| Client-server latency | <80ms | <200ms |

---

## 9. Security Considerations

### 9.1 Anti-Cheat
- **Server-authoritative:** All game logic runs on server. Client is a dumb terminal for rendering.
- **Input validation:** Server rejects impossible inputs (moving too fast, firing too fast).
- **Position verification:** Server checks client-reported positions against physics simulation.
- **Rate limiting:** Max input rate, max API calls.
- **No client-side hit detection:** Server does all damage calculations.

### 9.2 AI Safety
- **Prompt injection prevention:** AI system prompt is server-only. Player-generated content never enters the AI prompt.
- **Event validation:** Server validates all AI-suggested events against the event catalog. Unknown events are rejected.
- **Rate limiting:** Max events per minute. AI can't overwhelm the game.
- **Fallback:** Deterministic system if AI produces invalid output 3 times in a row.

### 9.3 Infrastructure
- **DDoS protection:** Cloudflare in front of all endpoints.
- **JWT rotation:** Short-lived tokens (15 min) with refresh.
- **Rate limiting:** Per-IP and per-account on all API endpoints.

---

## 10. Success Metrics

### MVP Success (Phase 4 complete)
- [ ] 48 players can complete a 15-minute match without crashes
- [ ] AI Game Master generates at least 5 events per Incursion match
- [ ] Average client FPS > 45 on mid-range hardware
- [ ] Network latency < 150ms for 90% of players in-region
- [ ] 3 game modes playable (TDM, Rush, Incursion)

### Growth Metrics (Post-launch)
- Average match completion rate > 70%
- Player return rate (day 1 retention) > 30%
- Average session length > 20 minutes
- AI event satisfaction (post-match survey) > 3.5/5

---

## 11. Open Questions & Decisions Needed

### Resolved
- ~~Map editor tooling~~ → **MagicaVoxel** with export pipeline to custom .vox loader
- ~~Physics engine~~ → **Hybrid: Custom AABB (movement) + Rapier.js WASM (dynamic objects)**
- ~~Monetization~~ → Deferred. Not a concern for MVP.
- ~~Squads~~ → No squads for MVP. Simple two-team structure.
- ~~Voice chat~~ → Deferred. Players use Discord.
- ~~AI frequency/cost~~ → 1 call per minute, 30-minute match cap = max 30 AI calls per match.

### Still Open
1. **Audio engine:** Web Audio API directly or use Howler.js?
2. **AI model choice:** Claude API vs self-hosted vs hybrid? Cost implications at scale.
3. **MagicaVoxel map pipeline:** Custom .vox parser → chunk data. Vengi voxconvert for batch ops. Pipeline defined in PRD 5.6.

---

## 12. Reference System Catalog

Design and technical systems extracted from reference games for future porting into Clawfield. Two primary references: **Ravenfield** (gameplay/design) and **OpenSpades** (voxel engine/netcode).

### 12.1 Ravenfield Systems

Source: Ravenfield Beta 5 decompilation. Design-focused reference.

#### Already Ported
| System | Status | Key Parameters |
|--------|--------|----------------|
| **Capture Points** | Ported (Phase 1.5) | Gradual control (0.0-1.0 float), 0.05/s per player, 10m radius, contested=frozen |
| **Conquest Scoring** | Ported (Phase 1.5) | 1 pt/tick per flag owned, 200-point difference to win |
| **Grenades** | Ported (Phase 1.5) | 18 m/s throw, 3s fuse, per-axis bounce (0.25), 200 dmg at center, 10m blast radius, linear falloff |
| **AI Bots** | Ported (Phase 1) | Fire rectangle targeting, aim sway (sinusoidal), patrol waypoints, sprint AI |
| **Sprint/Crouch** | Ported (Phase 1) | Sprint = 1.6x speed, crouch = 0.5x speed, weapon-specific recoil patterns |
| **Minimap** | Ported (Phase 1.5) | Canvas-based 150px, rotating player view, capture point markers |

#### Available for Future Porting
| System | Description | Priority | Phase |
|--------|-------------|----------|-------|
| **Vehicles** | Jeeps, helicopters, boats. Wheel physics with suspension springs. Enter/exit system with driver/gunner/passenger seats. | Medium | Post-MVP |
| **Hitboxes** | Multi-part hitbox system — head (2x damage), body (1x), limbs (0.75x). Per-bone collision for ragdoll on death. | Medium | Phase 2 |
| **Squad Coordination** | Squad-based spawning (spawn on squad leader), squad orders (attack/defend markers), squad voice proximity. | Low | Phase 4 |
| **Loadout UI** | Pre-spawn weapon selection screen. Primary, secondary, gadget slots. Per-class weapon pool restrictions. | Medium | Phase 2 |
| **Weapon Attachments** | Scope zoom levels, silencers (reduced audio range + no minimap ping), extended mags, foregrip (reduced recoil). | Low | Post-MVP |
| **Vehicle Weapons** | Mounted MGs, tank shells (projectile with splash), helicopter rockets. Separate ammo pools. | Low | Post-MVP |
| **Kill Streaks/Scoring** | Multi-kill bonuses, objective score multipliers, MVP system at match end. | Low | Phase 2 |

#### Ravenfield Design Constants (Reference)
```
Player run speed:        6.0 m/s
Player sprint speed:     9.6 m/s (1.6x)
Player crouch speed:     3.0 m/s (0.5x)
Jump velocity:           5.0 m/s
Gravity:                 -9.8 m/s²
Step-up height:          0.5 voxels

AR damage:               30 (4-hit kill)
SMG damage:              22 (5-hit kill)
Sniper damage:           90 (2-hit kill, 1-hit headshot)
Shotgun pellet damage:   15 x 8 pellets

Respawn timer:           5 seconds
Ticket pool:             75 per team (TDM)
Capture rate:            0.05/s per player in zone
Capture radius:          10m
```

### 12.2 OpenSpades Systems

Source: [OpenSpades](https://github.com/yvt/openspades) (GPL-3.0, C++). Technical reference for voxel engine, destruction, and netcode.

#### Voxel Destruction with Structural Integrity
The most valuable system from OpenSpades. When voxels are destroyed, a **BFS (Breadth-First Search) connectivity graph** determines if remaining blocks are still connected to the ground. Disconnected clusters collapse as debris.

**Algorithm:**
1. On voxel removal, identify all neighboring solid voxels
2. For each neighbor, run BFS/flood-fill downward toward ground (y=0)
3. If any neighbor cluster cannot reach ground → it's unsupported
4. Unsupported clusters become dynamic debris (falling particles)
5. Optimization: cache connectivity regions, only recheck affected area

**Key Parameters:**
```
Max flood-fill radius:     64 voxels (prevent runaway checks)
Ground connection:         Any voxel touching y=0 plane
Debris lifetime:           3 seconds (fade + remove)
Debris physics:            Simple gravity, no inter-debris collision
Check frequency:           On voxel change only (event-driven, not per-tick)
```

**Clawfield Integration Notes:**
- Implement as `StructuralIntegrity` class in `packages/shared/src/structural.ts`
- Wire into `setVoxel()` — when a voxel is removed, trigger connectivity check
- Keep check radius bounded (max 64 voxels) to prevent frame drops
- Debris particles use existing projectile renderer pattern (small colored cubes)

#### Chunk Rendering with Per-Vertex Ambient Occlusion
OpenSpades pre-computes AO per vertex using an **8-neighbor mask** — for each vertex of a voxel face, check the 3 adjacent solid voxels (corner + 2 edges). This creates the characteristic soft shadows at voxel edges.

**Algorithm:**
```
For each face vertex:
  side1 = is_solid(neighbor in direction A)
  side2 = is_solid(neighbor in direction B)
  corner = is_solid(neighbor in direction A+B)

  if side1 AND side2:
    ao = 0  (fully occluded — both sides block)
  else:
    ao = 3 - (side1 + side2 + corner)  // 0-3 scale

  vertex_color *= ao_lookup[ao]  // 1.0, 0.75, 0.5, 0.25
```

**Clawfield Integration Notes:**
- Add to `apps/client/src/voxel/mesher.ts` during face generation
- Encode AO as vertex color brightness multiplier
- Zero runtime cost (baked during mesh generation)
- Dramatic visual improvement for minimal complexity

#### Multiplayer Netcode Optimizations

**Input Bit-Packing:**
All player inputs packed into a single byte:
```
Bit 0: forward
Bit 1: backward
Bit 2: left
Bit 3: right
Bit 4: jump
Bit 5: crouch
Bit 6: shoot
Bit 7: sprint
```
Reduces per-frame input from ~50 bytes (JSON) to 1 byte + rotation (8 bytes total).

**Server Architecture:**
```
Tick rate:           60Hz (OpenSpades) vs our 20Hz
Protocol:            Custom UDP with reliability layer
Delta compression:   Only send changed entity fields
Position encoding:   Fixed-point 16-bit (0.01 unit precision)
Rotation encoding:   Single byte per axis (256 angles = 1.4° precision)
```

**Clawfield Integration Notes (Phase 4: Binary Protocol):**
- Replace JSON serialization with binary ArrayBuffer encoding
- Input: 1 byte bitmask + 2x float16 (yaw, pitch) = 5 bytes vs ~120 bytes JSON
- Position: 3x int16 fixed-point = 6 bytes vs ~60 bytes JSON
- Estimated bandwidth savings: 80-90% reduction

#### Water Rendering with Adaptive Mesh
OpenSpades renders water as a deformable mesh with wave simulation:

**Approach:**
```
Base:       Flat plane at water level
Waves:      Perlin noise displacement on Y axis
LOD:        Near water = high vertex density, far = sparse
Reflection: Screen-space reflection (SSR) on water surface
Refraction: Distorted underwater view through water plane
```

**Clawfield Integration Notes (Post-MVP):**
- Add as shader effect in renderer, not voxel data
- Water level defined per-map in metadata
- Useful for Shoreline map (harbor, beach)
- AI Game Master "Floodgate" event can raise water level dynamically

#### Building/Construction System
Players can place and remove voxels in real-time:

**Rules:**
```
Placement:     Must be adjacent to existing solid voxel
Range:          5 voxels from player
Material:       Team-colored blocks (limited supply)
Block pool:     50 blocks per life (replenished on respawn)
Removal:        Destroy own team's blocks instantly, enemy blocks take 3 hits
```

**Clawfield Integration Notes:**
- Maps to Engineer class "deploy cover" ability
- Use existing `setVoxel()` + chunk dirty flag + remesh pipeline
- Sync via `voxel_change` network event (position + material)
- Structural integrity system prevents floating block exploits

### 12.3 System Priority Matrix

Which reference systems to implement next, ordered by impact/effort:

| Priority | System | Source | Impact | Effort | Target Phase |
|----------|--------|--------|--------|--------|-------------|
| 1 | Per-vertex AO | OpenSpades | High visual lift | Low | Phase 2 |
| 2 | Scoreboard overlay | Ravenfield | Core UX | Low | Phase 2 |
| 3 | Sound effects | Both | Immersion | Medium | Phase 2 |
| 4 | Damage indicators | Ravenfield | Combat feel | Low | Phase 2 |
| 5 | Hitbox system | Ravenfield | Combat depth | Medium | Phase 2 |
| 6 | Binary protocol | OpenSpades | Performance | Medium | Phase 4 |
| 7 | Voxel destruction | OpenSpades | Core feature | High | Post-MVP |
| 8 | Water rendering | OpenSpades | Visual polish | Medium | Post-MVP |
| 9 | Building system | OpenSpades | Engineer class | Medium | Post-MVP |
| 10 | Vehicles | Ravenfield | Content | High | Post-MVP |

---

## 13. Glossary

| Term | Definition |
|------|------------|
| **ECS** | Entity-Component-System — data-oriented architecture for game objects |
| **Greedy Meshing** | Algorithm that combines adjacent voxel faces into larger polygons |
| **Tick** | One server simulation step (50ms at 20Hz) |
| **Chunk** | 16x16x16 group of voxels, the unit of loading and rendering |
| **Client-side Prediction** | Client simulates own movement immediately, server corrects later |
| **Entity Interpolation** | Smoothly moving other players between known server positions |
| **Lag Compensation** | Rewinding server state to account for network latency on hit detection |
| **TTK** | Time-to-kill — how quickly a player can die |
| **Incursion** | Clawfield's signature AI-driven game mode |
| **AI Game Master** | LLM-powered system that generates dynamic events during matches |
| **OpenClaw** | The project's AI agent system (can use Claude API under the hood) |

---

*This is a living document. Update as decisions are made and scope evolves.*
