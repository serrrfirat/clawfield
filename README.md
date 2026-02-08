# Clawfield

Browser-based voxel battlefield game for 24v24 multiplayer. Accessible, casual FPS gameplay with an AI Game Master that dynamically generates world events during matches.

## Tech Stack

- **Language**: TypeScript (strict mode)
- **Client**: Vite + Three.js + Howler.js
- **Server**: Node.js + WebSocket (20Hz authoritative tick)
- **Monorepo**: pnpm workspaces
- **Voxel Tools**: Python + TypeScript converters

## Project Structure

```
apps/
  client/          # Vite + Three.js frontend
  server/          # Node.js authoritative game server
packages/
  shared/          # Shared types, constants, physics, weapon/class definitions
assets/
  vox/             # MagicaVoxel source files
  maps/            # Compiled chunked map data
tools/             # Map generation & conversion utilities
docs/              # PRD, reference docs
```

## Getting Started

### Prerequisites

- Node.js 18+
- pnpm (`npm install -g pnpm`)
- Python 3 (for map generation)

### Development

```bash
# Install dependencies
pnpm install

# Start the game server (port 3000)
pnpm run dev:server

# In another terminal, start the client (port 5173)
pnpm run dev:client
```

Open http://localhost:5173 in your browser. Click to play — WASD to move, mouse to aim, left-click to shoot, Tab for scoreboard.

### Build

```bash
pnpm run build
```

### Map Generation

```bash
# Build the Shoreline map (generate voxels -> convert -> pack)
pnpm run build:shoreline-map

# Convert a .vox file manually
pnpm run convert:map
```

## Gameplay

### Classes

| Class | Primary | Gadgets | Ability |
|-------|---------|---------|---------|
| **Assault** | Assault Rifle / SMG | Frag & Smoke Grenades | Sprint Boost |
| **Medic** | SMG / Shotgun | Medkit / Bandage | Heal Aura (AOE) |
| **Engineer** | Carbine / PDW | Ammo Box / Repair Tool | Deploy Cover |
| **Recon** | Sniper / DMR | Spotting Scope / Claymore | Mark Targets |

### Game Modes

- **TDM** — 75 tickets per team, kills drain enemy tickets
- **Conquest** — Capture and hold 3 flags, earn points over time
- **Rush** — Attackers destroy M-COM stations, defenders hold the line
- **Incursion** (planned) — Conquest + AI Game Master generating dynamic events

### Key Mechanics

- Server-authoritative hit detection with client-side prediction
- Hitscan (close-mid range) and projectile (long range) weapons
- Grenade physics with bounce, fuse timer, and explosion radius
- Chunked voxel world with greedy meshing for efficient rendering
- AI bots with configurable difficulty

## Architecture

```
Client (Browser)               Server (Node.js)
┌──────────────────┐           ┌──────────────────┐
│ Input → Predict  │──WebSocket──▶ Validate & Sim  │
│ Render (Three.js)│◀──────────│ Broadcast State   │
│ Interpolate      │           │ 20Hz Game Loop    │
│ HUD / Audio      │           │ Bot AI            │
└──────────────────┘           └──────────────────┘
        ▲                              ▲
        └──────── shared/ ─────────────┘
          Types, Physics, Constants,
          Weapons, Classes, Combat
```

The server runs at a fixed 20Hz tick rate and is the authority on all game state. Clients send inputs, predict locally, and reconcile with server snapshots. Voxel chunks are streamed to clients based on proximity.

## Development Status

Currently in **Phase 2 (Polish & Content)**. Core gameplay, combat, classes, bots, grenades, capture points, minimap, and the Shoreline map are complete. Sound, gadgets, the AI Game Master (Phase 3), and 24v24 scaling (Phase 4) are upcoming.

See [docs/PRD.md](docs/PRD.md) for the full product spec and [tasks/todo.md](tasks/todo.md) for phase tracking.

## License

Private — all rights reserved.
