# BattleBit Remastered — Gap Analysis & Feature Roadmap

Reference analysis comparing BattleBit Remastered's feature set against Clawfield's
current state, with a prioritized roadmap toward minimum viable parity.

---

## What Is BattleBit Remastered?

**BattleBit Remastered** is a massively multiplayer FPS (up to 254 players) with a
low-poly art style, built in Unity by three indie developers over seven years.

| Attribute       | Detail                                              |
| --------------- | --------------------------------------------------- |
| Genre           | Massive-scale multiplayer FPS / tactical shooter     |
| Developer       | SgtOkiDoki, Vilaskis, TheLiquidHorse (3 people)     |
| Platform        | Windows (Steam)                                      |
| Engine          | Unity                                                |
| Release         | June 15, 2023 (Early Access)                         |
| Price           | ~$15 USD                                             |
| Max Players     | 254 (127 vs 127)                                     |
| Install Size    | ~2 GB                                                |

**Core concept:** A spiritual successor to classic Battlefield (BF2/BF3/BF4) that
strips away AAA bloat and monetization. Large-scale infantry + vehicle combat with
destructible environments, class-based teamwork, and squad coordination. The low-poly
art style is a deliberate technical decision enabling massive player counts, real-time
destruction, and a tiny install size — all built by three people.

**Commercial performance:** 1.8M copies sold in the first two weeks. All-time peak of
87,323 concurrent players on Steam.

---

## BattleBit Core Features

### Game Modes

| Mode               | Description                                                     | Scale           |
| ------------------ | --------------------------------------------------------------- | --------------- |
| **Conquest**       | Large-scale capture-and-hold across the full map                | Up to 254       |
| **Rush**           | Asymmetric attack/defense — destroy M-COM stations              | 32v32 – 64v64   |
| **Frontline**      | Tug-of-war — sectors shift back and forth                       | 32v32 – 127v127 |
| **Domination**     | Small-scale Conquest, infantry-only, compact map section        | 16v16 – 32v32   |
| **Infantry Conquest** | Large map, transport vehicles only                           | 64v64 – 127v127 |
| **Team Deathmatch**| Standard elimination                                            | 16v16 – 32v32   |
| **Sandbox**        | Fully configurable by server operators                          | Any              |

### Class / Role System (6 Classes)

**Squad Leader**
- Only selectable by squad owner
- Exclusive ability to ping objectives (white = squad, red = team-wide vehicle pings)
- Gadgets: Bino SOFLAM (laser designator), Air Drone, Spawn Beacon
- Dedicated squad leader VOIP channel for cross-squad coordination

**Assault**
- Front-line aggression — assault rifles, riot shield (exclusive)
- Gadgets: Anti-personnel mines, C4, claymore, M320 smoke launcher
- Class bonuses: +25% reload speed, +25% weapon swap, +20% ADS speed (close sights)

**Medic**
- Healer/reviver — assault rifles, SMGs, PDWs
- Medkit heals to 100%, can be placed on ground as healing station
- Carries 20 bandages (others carry 2-3), applies bandages 2x faster
- Can drag wounded teammates to safety

**Engineer**
- Vehicle specialist — most versatile weapon access (ARs, SMGs, PDWs, carbines, DMRs)
- RPGs (3 variants: frag, HEAT, heat explosive), repair tool
- Anti-vehicle/anti-personnel mines
- Access to light, medium, and heavy armor

**Support**
- Ammo provider and suppression — LMGs (exclusive)
- Ammo crate for teammate resupply
- **Instant fortification building** (all other classes build slowly)
- Backbone of sustained defense

**Recon**
- Long-range specialist — sniper rifles (exclusive), marksman rifles
- Gadgets: Fake sniper glint decoy, air drone (can deliver C4), grappling hook
- Cannot wear helmets (vulnerable to headshots)

### Weapon System

- **45+ weapons** across ARs, SMGs, PDWs, carbines, DMRs, snipers, LMGs, pistols
- **Attachment system:** sights, tactical lights, foregrips, suppressors, magazines, barrels
- Attachments unlock per-weapon based on kill count
- Weapons unlock by player rank (rank-gated progression)

### Armor / Equipment System

Gameplay-affecting equipment slots (not cosmetic):
- **Helmet** — head protection (Recon cannot equip)
- **Body armor** — light/medium/heavy, tradeoff between survivability and speed
- **Utility belt** — affects carried munitions
- **Backpack** — affects ammo and supply capacity

### Vehicle System

- **Transport:** ATVs, humvees, trucks
- **Armored:** IFVs, main battle tanks (with spotter seat)
- **Aircraft:** Transport and attack helicopters
- **Watercraft:** Rigid inflatable boats
- Vehicles repairable by engineers

### Destruction System

- **Brick-by-brick destruction:** Individual surface blocks can be demolished with
  sledgehammers or explosives
- **Building collapse:** Cumulative damage triggers full structural collapse
- **Partial destruction:** Holes in walls, blown floors, destroyed staircases create
  evolving cover and sightlines
- **Tactical use:** Blow open entry points, remove cover, collapse sniper positions

### Building / Fortification System

- Activated via build menu (middle mouse)
- Costs **squad points** (shared resource earned through squad play)
- Available structures: walls, Hesco cubes, sandbags, concrete barriers, barricades
- **Support class builds instantly**; all other classes hold interact and build slowly
- Creative uses: block doorways, build cover around downed teammates, improvised
  watchtowers, stepping-stone structures for vertical mobility

### Medical / Revive System

- **Bandages:** All classes carry 2-3 (Medic carries 20). Stops bleeding, enables
  revive. Does NOT restore full HP.
- **Medkits:** Medic-exclusive. Heals to 100%. Can be dropped as a persistent
  healing station.
- **Reviving:** Every class can revive using bandages. Revived players return at
  very low HP. Medics apply bandages 2x faster.
- **Dragging:** Press interact on a downed ally to drag them to cover before reviving.

### Communication Tools

**Three-channel VOIP:**
1. **Proximity (V)** — Heard by anyone nearby, *including enemies*. Shows speaker
   name and distance.
2. **Squad (B)** — Private to your squad.
3. **Squad Leader (N)** — Cross-squad strategic coordination, leaders only.

**Pinging:**
- Quick-press to place a marker
- Squad leaders can ping objectives (white = squad, red = team-wide vehicle tracking)

### Squad Mechanics

- 8-player squads (16 for clans)
- Squad points (shared resource for fortifications)
- Squad spawning (spawn on squad mates)
- Squad leader directs movement and coordinates with other leaders

### Progression System

- Max level 200 (~150 hours to level 150)
- Weapons/gear/cosmetics unlock at rank thresholds
- Per-weapon attachment progression via kill counts
- Optional prestige system at max level (resets equipment, rewards exclusive skins)

---

## Feature Comparison

| Feature                  | BattleBit                                      | Clawfield                              | Gap        |
| ------------------------ | ---------------------------------------------- | -------------------------------------- | ---------- |
| **Destruction**          | Brick-by-brick, building collapse              | None                                   | Critical   |
| **Building/Fortify**     | Full build menu, squad points, Support instant  | Basic "deploy cover" gadget            | Major      |
| **Vehicles**             | Tanks, IFVs, helicopters, boats, ATVs          | None                                   | Major      |
| **Squad System**         | 8-player squads, leader role, squad VOIP        | Teams only, no squads                  | Major      |
| **Revive/Medical**       | Any class revives, drag wounded, medkit heal    | Medkit gadget only                     | Significant|
| **VOIP / Comms**         | 3-channel VOIP, pinging system                  | None                                   | Significant|
| **Classes**              | 6 (+ Squad Leader, Support)                     | 4 (Assault, Medic, Engineer, Recon)    | Moderate   |
| **Weapon Attachments**   | Sights, grips, suppressors, mags, barrels       | None                                   | Moderate   |
| **Armor/Loadout**        | Helmet, armor, belt, backpack (gameplay stats)  | None                                   | Moderate   |
| **Game Modes**           | Conquest, Rush, Frontline, Domination, TDM      | Conquest, TDM (Rush planned)           | Moderate   |
| **Progression**          | Rank 1-200, weapon unlocks, prestige            | None                                   | Lower      |
| **Map Count**            | 15+ maps                                        | 1 (Shoreline)                          | Content    |
| **Player Scale**         | 254 players                                     | 48 players                             | Acceptable |
| **Pinging**              | Squad leader + vehicle pings                    | Spotting scope (Recon only)            | Minor      |

---

## Our Unique Advantages

| Advantage                | Why It Matters                                                  |
| ------------------------ | --------------------------------------------------------------- |
| **True voxel destruction** | Every single block removable — more granular than BattleBit   |
| **Browser-based**        | Zero install, instant play — no Steam required                  |
| **AI Game Master**       | Dynamic world events mid-match — BattleBit has nothing like it  |
| **Voxel building**       | Place individual blocks, not just prefab fortifications          |

Our voxel engine is the key differentiator. BattleBit's destruction is impressive but
constrained by mesh-based rendering. Our voxel grid supports destruction *natively* —
every block is independently addressable. This should be our headline feature.

---

## Prioritized MV Roadmap

### Tier 1 — Core Differentiators (Implement First)

These features have the highest gameplay impact and play to our voxel engine strengths.

**1. Voxel Destruction**
- Explosions (grenades, RPGs) remove voxels from the world in a blast radius
- Weapons deal minor voxel damage (shotguns chip walls, snipers punch through)
- Structural integrity check: unsupported blocks collapse under gravity
- Buildings degrade and eventually collapse when too much structure is removed
- Dust/debris particle effects on destruction
- *Why first:* Our engine is built for this. It's the single most transformative feature.

**2. Building / Fortification System**
- Build menu with voxel-based structures (walls, sandbags, barriers)
- Squad points as currency (earned through squad play)
- Support class builds instantly, others build over time
- Placement preview (green transparent ghost)
- Pairs with destruction: the destroy-and-rebuild loop is the core gameplay loop

**3. Revive System**
- Downed state (0 HP = downed, not dead) with bleedout timer
- Any class can revive with bandages (slow, partial HP)
- Medic revives faster and heals to full
- Dragging: reposition downed teammates into cover before reviving
- Smoke grenades for Medic to cover revive attempts

### Tier 2 — Squad & Communication

These features add team coordination depth.

**4. Squad System**
- 4-6 player squads with a designated squad leader
- Spawn on squad leader / squad-owned capture points
- Squad points earned through cooperative play (healing, resupplying, capturing)
- Squad UI overlay showing member status and distance

**5. Pinging System**
- Quick ping: all players can place a contextual marker (enemy spotted, go here)
- Squad leader pings: objective markers visible to full squad
- Auto-decay after 10 seconds
- Minimal UI — ping icon + distance indicator

**6. Rush Game Mode**
- Already planned in PRD
- Linear attack/defense with 2 M-COM objectives per sector
- Sectors advance as objectives are destroyed
- Attackers have limited tickets; defenders have unlimited respawns
- Map zones unlock progressively

### Tier 3 — Depth & Content

These features add variety and progression.

**7. Support Class**
- LMGs (new weapon category: high capacity, suppression, slower movement)
- Ammo crate deployment (teammates interact to resupply)
- Instant fortification building (unique class perk)
- Fills the "sustained defense" role missing from our 4-class system

**8. Weapon Attachments**
- Start with sights/optics (red dot, holographic, 4x scope, 8x scope)
- Then grips (reduce recoil), suppressors (reduce sound/flash, reduce damage range)
- Attachment slots per weapon, UI in deploy screen
- Per-weapon unlock progression (kills with weapon unlock its attachments)

**9. Transport Vehicles**
- ATVs: fast, nimble, 2-seat, no armor
- Trucks: slower, 6-seat, moderate durability
- Physics via Rapier.js (already in project for grenades)
- Driver + passenger seats, enter/exit interaction
- No combat vehicles yet — transport only to match our map scale

**10. Frontline Game Mode**
- Tug-of-war sector control
- Single active capture zone that shifts back and forth
- Great for our current map scale (focused fights)
- Simpler to implement than Rush (no M-COM destruction logic)

### Tier 4 — Long-term

These features add polish and retention.

**11. Armor / Loadout System**
- Equipment slots: helmet, body armor, belt, backpack
- Tradeoffs: heavier armor = more HP but slower movement
- Visible on player models

**12. Progression & Unlocks**
- Player rank (XP from kills, objectives, teamwork)
- Weapons/attachments gated by rank
- Cosmetic unlocks (camo patterns per class)
- Optional prestige system

**13. Additional Maps**
- Ridgeline (mountain village, vertical gameplay) — already planned
- Railyard (industrial, vehicle-friendly) — already planned
- Design maps with destruction and building in mind

**14. Combat Vehicles**
- IFVs / light tanks
- Attack helicopters
- Requires larger maps and balance work
- Spotter/gunner seat mechanics

---

## Design Principles (Learned from BattleBit)

1. **Function over form.** The low-poly/voxel style isn't a limitation — it enables
   destruction, scale, and fast iteration. Lean into it.

2. **Accessible depth.** Position gameplay between arcade (CoD) and simulation (Squad).
   Tactically rewarding without being punishing. Easy to pick up, satisfying to master.

3. **Everyone contributes.** Any class can revive. Squad spawning is available to all.
   Teamwork is rewarded but not required for basic fun.

4. **Destruction reshapes every match.** No two rounds should play the same because the
   physical environment evolves during play.

5. **The destroy-rebuild loop.** Destruction without building leads to empty maps by
   round end. Building without destruction is static. Together they create a dynamic,
   evolving battlefield.

6. **Small team, focused scope.** BattleBit was built by 3 people over 7 years with
   relentless playtesting and iteration. Prioritize the features that create the most
   emergent gameplay per development hour.

---

## MV Parity Target

The minimum feature set that puts Clawfield in the same category as BattleBit while
maintaining our unique identity:

- **Voxel Destruction** + **Building** (our headline differentiator)
- **Revive System** (transforms team play)
- **Squad System** (coordination layer)
- **Rush Game Mode** (second core mode)
- **AI Game Master** (our unique feature — already planned for Phase 3)

These five features, combined with our existing Conquest/TDM, 4-class system, and
8-weapon arsenal, create a complete multiplayer FPS experience that can stand alongside
BattleBit while offering something BattleBit doesn't: browser-based instant play,
true voxel manipulation, and AI-driven dynamic events.
