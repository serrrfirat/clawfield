# Clawfield

Clawfield is a browser-first, AI-directed cell combat sandbox for 24v24 teams. The game is built around readable team FPS action, dynamic terrain, and a strong server-authoritative simulation.

## Current Objective

- Keep the gameplay accessible and tactical while improving battlefield readability.
- Preserve deterministic outcomes through authoritative server logic and bounded client prediction.
- Differentiate with an AI Game Master that creates memorable but fair Incursion match events.
- Maintain a pragmatic web-first stack for fast iteration and stable performance.

## Tech Stack

- **Language**: TypeScript (strict mode)
- **Client**: Vite + Three.js + React
- **Server**: Node.js + WebSocket/WebRTC (20Hz authoritative tick)
- **Monorepo**: pnpm workspaces
- **Cell Tools**: Python + TypeScript map conversion utilities

## Project Structure

```text
apps/
  client/          # Vite + Three.js frontend
  server/          # Node.js authoritative game server
packages/
  shared/          # Shared types, constants, physics, combat, and data contracts
assets/
  vox/             # Source `.vox` files for map import
  maps/            # Compiled chunked map data
tools/             # Map generation & conversion utilities
docs/              # PRD and reference documentation
```

## Getting Started

### Prerequisites

- Node.js 18+
- pnpm (`npm install -g pnpm`)
- Python 3 (for map generation tools)

### Development

```bash
# Install dependencies
pnpm install

# Start server (port 3000)
pnpm run dev:server

# Start client in another terminal (port 5173)
pnpm run dev:client
```

Open `http://localhost:5173` and start a local match.

### Build

```bash
pnpm run build
```

### Map Generation

```bash
# Build Shoreline map assets (`.vox` -> converter -> packed chunks)
pnpm run build:shoreline-map

# Manual conversion helper
pnpm run convert:map
```

Controls: `WASD`, mouse look, left-click to fire, `Tab` opens player list.

## Gameplay

### Classes

| Class | Primary | Gadgets | Signature Ability |
|-------|---------|---------|------------------|
| Assault | Assault Rifle / SMG | Frag, Smoke Grenades | Sprint Burst |
| Medic | SMG / Shotgun | Medkit, Bandage | Heal Aura |
| Engineer | Carbine / PDW | Ammo Box, Repair Tool | Deploy Cover |
| Recon | Sniper / DMR | Spotting Scope, Claymore | Mark Targets |

### Game Modes

- **TDM** — 75 tickets per team, kills drain enemy tickets
- **Conquest** — Capture and hold zones to generate a slow, stable score race
- **Rush** — Attackers destroy objectives, defenders hold territory
- **Incursion** — Conquest baseline with AI Game Master event cadence

### Core Systems

- Server-authoritative combat with client-side prediction
- Hitscan and projectile weapons with local feedback + server reconciliation
- Destructible cell world with chunked streaming
- Grenade physics (bounce, fuse, blast)
- AI bot behaviors and bot difficulty tuning
- Comms / audio cues and HUD-focused combat feedback

## Architecture

```text
Client (Browser)                   Server (Node.js)
┌────────────────────────────┐     ┌───────────────────────────┐
│ Input + Prediction         │ WS  │ Validation + Simulation   │
│ Render (Three.js)          │◀────│ 20Hz Authoritative Tick   │
│ Client interpolation/Audio  │     │ AI Game Master Director   │
└────────────────────────────┘     └───────────────────────────┘
                ▲                              ▲
                └──────────── shared/ ──────────┘
             Types, Physics, Combat, Assets
```

The server is authoritative for game state. Clients run prediction locally and reconcile from periodic server snapshots. Cell chunks are streamed by proximity for performance.

## Development Status

Currently in **Phase 2.5 (AI Vertical Slice Reset)**. Core combat systems, movement, bots, grenades, capture mechanics, minimap, and Shoreline baseline content are complete. Current focus is on stable AI event systems, comms readability, and scaling path toward 24v24.

See [docs/PRD.md](docs/PRD.md) for full specs and [tasks/todo.md](tasks/todo.md) for phase tracking.

## License

Private — all rights reserved.
