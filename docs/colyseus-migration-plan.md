# Colyseus Migration Plan

## Goals
- Replace custom websocket transport with Colyseus rooms.
- Keep authoritative server simulation model.
- Migrate incrementally behind feature flags without breaking current gameplay.

## Feature Flags
- Server: `NETCODE_BACKEND=colyseus`
- Client: `VITE_NETCODE_BACKEND=colyseus`

## Phase 1 (in progress)
- Add Colyseus server/client dependencies.
- Add Colyseus bootstrap path in server entrypoint.
- Add `BattleRoom` skeleton that supports:
  - `join`
  - `deploy`
  - `input`
  - periodic `state` snapshots
- Add client Colyseus transport adapter and wire through `NetworkProvider`.

## Phase 2
- Introduce transport abstraction in server game stack (`RoomManager`/`GameLoop`) so existing authoritative sim can run on either transport.
- Route existing `ClientMessage`/`ServerMessage` contract through Colyseus room channels.
- Preserve current deploy/combat flow and map loading parity.

## Phase 3
- Move high-frequency snapshot paths to Colyseus `Schema` state and keep event messages (`kill`, `explosion`, `director_event`) as room messages.
- Add reconnection and session recovery parity.

## Phase 4
- Remove legacy websocket transport once Colyseus mode reaches functional parity and stability.
- Performance tuning (tick-rate, patch rates, message budget, interpolation knobs).

## Current limitations of Phase 1
- `BattleRoom` is a transport migration scaffold, not full gameplay parity.
- No full map/chunk streaming or full combat systems in Colyseus mode yet.
- Existing default (`ws`) path remains the production path during migration.
