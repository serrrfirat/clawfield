import { Room, type Client as ColyseusClient } from 'colyseus';
import { Team, type ClientMessage, type GameMode, type LobbyPlayer, type MatchConfig, type PlacementCollider, type PlayerState, type ServerPhase } from '@clawfield/shared';
import { TICK_INTERVAL } from '@clawfield/shared';
import { GameLoop, type LobbyPlayerInfo } from '../game-loop.js';
import { ColyseusNetworkAdapter } from './ColyseusNetworkAdapter.js';
import type { Client as ServerClient } from '../network.js';
import { GameState, PlayerSchema, CapturePointSchema } from './schemas.js';

interface RoomPlayer {
  id: string;
  name: string;
  team: number;
  isHost: boolean;
}

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';

function generateRoomCode(): string {
  let code = '';
  for (let i = 0; i < 4; i++) {
    code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  }
  return code;
}

/**
 * Colyseus room running the existing authoritative GameLoop.
 *
 * Uses Colyseus Schema delta sync for player state (positions, health, etc.)
 * and Room messages for events (hit confirms, explosions, projectiles).
 */
export class BattleRoom extends Room<GameState> {
  maxClients = 16;

  private network = new ColyseusNetworkAdapter();
  private gameLoop: GameLoop | null = null;
  private gameMode: GameMode = 'tdm';
  private roomPlayers = new Map<string, RoomPlayer>();
  private phase: ServerPhase = 'lobby';
  private roomCode = generateRoomCode();
  private hostId = '';
  private selectedMap = 'heightmap';
  private matchSeed = 1337;
  private placementColliders: PlacementCollider[] = [];
  private customMatchConfig: MatchConfig | null = null;
  private readonly availableMaps: { id: string; name: string }[] = [];
  private autoMode = false;
  private readonly useSchemaStateSync = process.env.CLAWFIELD_USE_SCHEMA_SYNC === '1';

  onCreate(options?: { auto?: boolean; gameMode?: GameMode; mapName?: string; roomCode?: string; seed?: number }) {
    this.setState(new GameState());
    const patchMsEnv = Number(process.env.CLAWFIELD_SCHEMA_PATCH_MS ?? NaN);
    const patchMs = Number.isFinite(patchMsEnv) && patchMsEnv > 0 ? patchMsEnv : TICK_INTERVAL;
    this.setPatchRate(patchMs);

    this.autoMode = options?.auto === true;
    this.gameMode = options?.gameMode ?? this.gameMode;
    this.selectedMap = options?.mapName ?? this.selectedMap;
    this.matchSeed = options?.seed ?? this.matchSeed;
    this.roomCode = options?.roomCode ?? this.roomCode;
    this.phase = this.autoMode ? 'in_game' : 'lobby';

    this.setMetadata({
      roomCode: this.roomCode,
      phase: this.phase,
      gameMode: this.gameMode,
      mapName: this.selectedMap,
      seed: this.matchSeed,
    });

    // Keep lobby rooms alive while waiting for players.
    this.autoDispose = this.autoMode;

    this.onMessage('client_message', (colyseusClient, msg: ClientMessage) => {
      this.handleClientMessage(colyseusClient, msg);
    });
    console.log(
      `[Colyseus] BattleRoom created (mode=${this.autoMode ? 'auto' : 'lobby'}, roomCode=${this.roomCode}, patchRate=${patchMs.toFixed(2)}ms)`
    );
  }

  onJoin(colyseusClient: ColyseusClient) {
    this.network.registerClient(colyseusClient);

    if (!this.hostId && !this.autoMode) {
      this.hostId = colyseusClient.sessionId;
    }

    this.updateMetadata();
    console.log(`[Colyseus] Client connected: ${colyseusClient.sessionId}`);

    if (!this.autoMode) {
      this.broadcastLobbyState();
    }
  }

  onLeave(colyseusClient: ColyseusClient) {
    const serverClient = this.getServerClient(colyseusClient.sessionId);
    if (serverClient && this.gameLoop && this.phase === 'in_game') {
      this.gameLoop.handleDisconnect(serverClient);
    }

    // Remove from Schema
    this.state.players.delete(colyseusClient.sessionId);

    const leavingPlayer = this.roomPlayers.get(colyseusClient.sessionId);
    this.roomPlayers.delete(colyseusClient.sessionId);
    this.network.unregisterClient(colyseusClient.sessionId);

    if (!this.autoMode && this.phase === 'lobby') {
      if (leavingPlayer?.isHost) {
        this.broadcastServerMessage({ type: 'room_closed' });
        this.disconnect();
        return;
      }
      this.broadcastLobbyState();
    }

    // Destroy loop when no players remain.
    if (this.roomPlayers.size === 0 && this.gameLoop) {
      this.gameLoop.destroy();
      this.gameLoop = null;
      console.log('[Colyseus] GameLoop destroyed (room empty)');
    }

    this.updateMetadata();
  }

  onDispose() {
    this.gameLoop?.destroy();
    this.gameLoop = null;
  }

  private handleClientMessage(colyseusClient: ColyseusClient, msg: ClientMessage) {
    const serverClient = this.getServerClient(colyseusClient.sessionId);
    if (!serverClient) return;

    switch (msg.type) {
      case 'join': {
        this.handleJoinMessage(serverClient, msg);
        return;
      }
      case 'create_room': {
        this.handleCreateRoom(serverClient, msg.name);
        return;
      }
      case 'join_room': {
        this.handleJoinRoom(serverClient, msg.name, msg.roomCode);
        return;
      }
      case 'lobby_set_team': {
        this.handleLobbySetTeam(serverClient.id, msg.team);
        return;
      }
      case 'lobby_set_mode': {
        this.handleLobbySetMode(serverClient.id, msg.gameMode);
        return;
      }
      case 'lobby_set_map': {
        this.handleLobbySetMap(serverClient.id, msg.mapName);
        return;
      }
      case 'lobby_set_seed': {
        this.handleLobbySetSeed(serverClient.id, msg.seed);
        return;
      }
      case 'lobby_set_match_config': {
        this.handleLobbySetMatchConfig(serverClient.id, msg.matchConfig);
        return;
      }
      case 'lobby_set_placement_colliders': {
        this.handleLobbySetPlacementColliders(serverClient.id, msg.colliders);
        return;
      }
      case 'start_game': {
        this.handleStartGame(serverClient.id);
        return;
      }
      case 'return_to_menu': {
        this.handleReturnToMenu(serverClient.id);
        return;
      }
      default:
        break;
    }

    if (this.phase === 'in_game' && this.gameLoop) {
      this.gameLoop.handleMessage(serverClient, msg);
    }
  }

  /** Wire up the game loop's state callback to populate Schema */
  private wireStateSync(): void {
    if (!this.gameLoop) return;

    if (!this.useSchemaStateSync) {
      // Stability fallback: keep using GameLoop's JSON `state` messages over
      // `server_message` and avoid Colyseus Schema patch churn.
      this.gameLoop.suppressStateBroadcast = false;
      this.gameLoop.onStateComputed = null;
      console.warn('[Colyseus] Schema state sync disabled (CLAWFIELD_USE_SCHEMA_SYNC!=1); using server_message state broadcast');
      return;
    }

    // Suppress JSON state broadcast — Schema handles it
    this.gameLoop.suppressStateBroadcast = true;

    this.gameLoop.onStateComputed = (players: PlayerState[], tick: number) => {
      this.state.tick = tick;

      // Rebuild map schemas each tick to avoid stale/invalid entries causing
      // Colyseus encoder metadata errors.
      this.state.players.clear();
      this.state.capturePoints.clear();

      // Update player schemas
      for (const p of players) {
        if (!p || typeof p.id !== 'string' || p.id.length === 0) {
          continue;
        }

        const schema = new PlayerSchema();
        this.state.players.set(p.id, schema);

        schema.name = p.name ?? '';
        schema.x = Number.isFinite(p.position?.x) ? p.position.x : 0;
        schema.y = Number.isFinite(p.position?.y) ? p.position.y : 0;
        schema.z = Number.isFinite(p.position?.z) ? p.position.z : 0;
        schema.yaw = Number.isFinite(p.yaw) ? p.yaw : 0;
        schema.pitch = Number.isFinite(p.pitch) ? p.pitch : 0;
        schema.health = Number.isFinite(p.health) ? p.health : 100;
        schema.alive = !!p.alive;
        schema.downed = !!p.downed;
        schema.grounded = !!p.grounded;
        schema.inWater = !!p.inWater;
        schema.reloading = !!p.reloading;
        schema.shooting = !!p.shooting;
        schema.team = Number.isFinite(p.team) ? p.team : 0;
        schema.classId = p.classId ?? 'assault';
        schema.ammo = Number.isFinite(p.ammo) ? p.ammo : 30;
        schema.maxAmmo = Number.isFinite(p.maxAmmo) ? p.maxAmmo : 30;
        schema.weaponSlot = Number.isFinite(p.weaponSlot) ? p.weaponSlot : 0;
        schema.weaponName = p.weaponName ?? '';
      }

      // Update capture points
      const cpStates = this.gameLoop!.getCapturePoints();
      for (const cp of cpStates) {
        if (!cp || typeof cp.id !== 'string' || cp.id.length === 0) {
          continue;
        }

        const cpSchema = new CapturePointSchema();
        this.state.capturePoints.set(cp.id, cpSchema);
        cpSchema.x = Number.isFinite(cp.position?.x) ? cp.position.x : 0;
        cpSchema.y = Number.isFinite(cp.position?.y) ? cp.position.y : 0;
        cpSchema.z = Number.isFinite(cp.position?.z) ? cp.position.z : 0;
        cpSchema.control = Number.isFinite(cp.control) ? cp.control : 0.5;
        cpSchema.owner = Number.isFinite(cp.owner) ? cp.owner : -1;
        cpSchema.contested = !!cp.contested;
      }

      // Update scores and tickets
      const scores = this.gameLoop!.getConquestScores();
      this.state.scoreAlpha = scores.alpha;
      this.state.scoreBravo = scores.bravo;

      const tickets = this.gameLoop!.getTickets();
      this.state.ticketsAlpha = tickets.alpha;
      this.state.ticketsBravo = tickets.bravo;

      // Send per-client ack (not in Schema — it's per-client data)
      for (const client of this.clients) {
        const sim = this.gameLoop!.getPlayerSim(client.sessionId);
        if (sim) {
          client.send('ack', sim.lastAckedSeq);
        }
      }
    };
  }

  private handleCreateRoom(serverClient: ServerClient, name: string): void {
    if (this.autoMode || this.phase !== 'lobby') return;

    serverClient.name = name;
    if (!this.hostId) {
      this.hostId = serverClient.id;
    }

    if (!this.roomPlayers.has(serverClient.id)) {
      this.roomPlayers.set(serverClient.id, {
        id: serverClient.id,
        name,
        team: Team.Alpha,
        isHost: serverClient.id === this.hostId,
      });
    }

    this.sendServerMessage(serverClient.id, {
      type: 'room_created',
      roomCode: this.roomCode,
      playerId: serverClient.id,
    });

    this.broadcastLobbyState();
    this.updateMetadata();
  }

  private handleJoinRoom(serverClient: ServerClient, name: string, roomCode: string): void {
    if (this.autoMode || this.phase !== 'lobby') return;

    if (roomCode.toUpperCase() !== this.roomCode.toUpperCase()) {
      this.sendServerMessage(serverClient.id, { type: 'room_error', message: 'Invalid room code.' });
      return;
    }

    serverClient.name = name;

    if (!this.roomPlayers.has(serverClient.id)) {
      this.roomPlayers.set(serverClient.id, {
        id: serverClient.id,
        name,
        team: this.getBalancedTeam(),
        isHost: false,
      });
    }

    this.sendServerMessage(serverClient.id, {
      type: 'room_joined',
      roomCode: this.roomCode,
      playerId: serverClient.id,
      hostId: this.hostId,
    });

    this.broadcastLobbyState();
    this.updateMetadata();
  }

  private handleLobbySetTeam(clientId: string, team: number): void {
    if (this.autoMode || this.phase !== 'lobby') return;
    const player = this.roomPlayers.get(clientId);
    if (!player) return;
    player.team = team;
    this.broadcastLobbyState();
  }

  private handleLobbySetMode(clientId: string, gameMode: GameMode): void {
    if (this.autoMode || this.phase !== 'lobby') return;
    if (clientId !== this.hostId) return;
    this.gameMode = gameMode;
    this.broadcastLobbyState();
    this.updateMetadata();
  }

  private handleLobbySetMap(clientId: string, mapName: string): void {
    if (this.autoMode || this.phase !== 'lobby') return;
    if (clientId !== this.hostId) return;
    if (!this.availableMaps.some((m) => m.id === mapName)) return;
    this.selectedMap = mapName;
    this.broadcastLobbyState();
    this.updateMetadata();
  }

  private handleLobbySetSeed(clientId: string, seed: number): void {
    if (this.autoMode || this.phase !== 'lobby') return;
    if (clientId !== this.hostId) return;
    if (!Number.isFinite(seed)) return;
    this.matchSeed = Math.max(1, Math.floor(seed));
    this.broadcastLobbyState();
    this.updateMetadata();
  }

  private handleLobbySetMatchConfig(clientId: string, matchConfig: MatchConfig): void {
    if (this.autoMode || this.phase !== 'lobby') return;
    if (clientId !== this.hostId) return;
    if (!matchConfig || !Number.isFinite(matchConfig.seed)) return;

    const safeHeightmap = matchConfig.heightmap
      ? {
          cellSize: Number.isFinite(matchConfig.heightmap.cellSize) ? Math.max(0.25, matchConfig.heightmap.cellSize) : 1,
          cells: (matchConfig.heightmap.cells ?? [])
            .filter((c) => Number.isFinite(c.x) && Number.isFinite(c.z) && Number.isFinite(c.h))
            .slice(0, 25000),
        }
      : undefined;

    this.customMatchConfig = {
      ...matchConfig,
      terrain: {
        scale: Number.isFinite(matchConfig.terrain?.scale) ? matchConfig.terrain.scale : 0.05,
        amplitude: Number.isFinite(matchConfig.terrain?.amplitude) ? matchConfig.terrain.amplitude : 2,
        waterLevel: Number.isFinite(matchConfig.terrain?.waterLevel as number) ? matchConfig.terrain.waterLevel : undefined,
      },
      heightmap: safeHeightmap,
    };

    this.matchSeed = this.customMatchConfig.seed;
    this.broadcastLobbyState();
    this.updateMetadata();
  }

  private handleLobbySetPlacementColliders(clientId: string, colliders: PlacementCollider[]): void {
    if (this.autoMode || this.phase !== 'lobby') return;
    if (clientId !== this.hostId) return;
    const safe = (colliders ?? [])
      .filter((c) => c && Number.isFinite(c.x) && Number.isFinite(c.z) && Number.isFinite(c.r) && c.r > 0)
      .slice(0, 2000)
      .map((c, i) => ({ id: c.id || `c-${i}`, x: c.x, z: c.z, r: c.r }));
    this.placementColliders = safe;
    this.broadcastLobbyState();
  }

  private handleStartGame(clientId: string): void {
    if (this.autoMode || this.phase !== 'lobby') return;
    if (clientId !== this.hostId || this.roomPlayers.size === 0) return;

    this.phase = 'in_game';
    this.lock();

    const lobbyPlayers: LobbyPlayerInfo[] = Array.from(this.roomPlayers.values()).map((p) => ({
      clientId: p.id,
      name: p.name,
      team: p.team,
    }));

    this.gameLoop = new GameLoop(
      this.network as any,
      lobbyPlayers,
      this.gameMode,
      (winner) => {
        this.network.broadcast({ type: 'game_over', winner });
      },
      this.selectedMap,
      this.matchSeed,
      this.placementColliders,
      this.customMatchConfig ?? undefined,
    );

    this.wireStateSync();
    this.broadcastServerMessage({ type: 'placement_colliders', colliders: this.placementColliders });
    this.broadcastServerMessage({ type: 'game_starting', countdown: 0 });
    this.updateMetadata();
  }

  private handleReturnToMenu(clientId: string): void {
    const player = this.roomPlayers.get(clientId);
    if (!player) return;

    this.roomPlayers.delete(clientId);
    if (this.phase === 'lobby') {
      if (player.isHost) {
        this.broadcastServerMessage({ type: 'room_closed' });
        this.disconnect();
        return;
      }
      this.broadcastLobbyState();
      this.updateMetadata();
    }
  }

  private broadcastLobbyState(): void {
    if (this.autoMode || this.phase !== 'lobby') return;

    const players: LobbyPlayer[] = Array.from(this.roomPlayers.values()).map((p) => ({
      id: p.id,
      name: p.name,
      team: p.team,
      isHost: p.isHost,
    }));

    this.broadcastServerMessage({
      type: 'lobby_state',
      players,
      gameMode: this.gameMode,
      hostId: this.hostId,
      roomCode: this.roomCode,
      phase: this.phase,
      mapName: this.selectedMap,
      availableMaps: this.availableMaps,
      seed: this.matchSeed,
      placementColliderCount: this.placementColliders.length,
    });
  }

  private sendServerMessage(clientId: string, message: import('@clawfield/shared').ServerMessage): void {
    const client = this.clients.find((c) => c.sessionId === clientId);
    if (!client) return;
    client.send('server_message', message);
  }

  private broadcastServerMessage(message: import('@clawfield/shared').ServerMessage): void {
    this.broadcast('server_message', message);
  }

  private updateMetadata(): void {
    this.setMetadata({
      roomCode: this.roomCode,
      phase: this.phase,
      gameMode: this.gameMode,
      mapName: this.selectedMap,
      seed: this.matchSeed,
      players: this.roomPlayers.size,
    });
  }

  private handleJoinMessage(serverClient: ServerClient, msg: Extract<ClientMessage, { type: 'join' }>) {
    if (!this.autoMode) {
      // In lobby mode, treat `join` as a convenience alias for create/join behavior.
      if (!this.hostId) {
        this.handleCreateRoom(serverClient, msg.name);
      } else {
        this.handleJoinRoom(serverClient, msg.name, this.roomCode);
      }
      return;
    }

    serverClient.name = msg.name;

    if (!this.gameLoop) {
      this.gameMode = msg.gameMode;
      const team = this.getBalancedTeam();
      if (!this.hostId) this.hostId = serverClient.id;
      this.roomPlayers.set(serverClient.id, {
        id: serverClient.id,
        name: msg.name,
        team,
        isHost: serverClient.id === this.hostId,
      });

      const lobbyPlayers: LobbyPlayerInfo[] = [
        { clientId: serverClient.id, name: msg.name, team },
      ];

      this.gameLoop = new GameLoop(
        this.network as any,
        lobbyPlayers,
        this.gameMode,
        (winner) => {
          this.network.broadcast({ type: 'game_over', winner });
        },
        undefined,
        undefined,
        this.placementColliders,
        this.customMatchConfig ?? undefined,
      );

      this.wireStateSync();
      this.updateMetadata();
      console.log(`[Colyseus] Started game loop (${this.gameMode})`);
      return;
    }

    // Late join while game is running.
    if (!this.roomPlayers.has(serverClient.id)) {
      const team = this.getBalancedTeam();
      this.roomPlayers.set(serverClient.id, {
        id: serverClient.id,
        name: msg.name,
        team,
        isHost: false,
      });
      this.gameLoop.hotJoinPlayer(serverClient, msg.name, team);
      this.sendServerMessage(serverClient.id, { type: 'placement_colliders', colliders: this.placementColliders });
      this.updateMetadata();
      console.log(`[Colyseus] Hot-joined ${msg.name} (${serverClient.id}) team ${team}`);
    }
  }

  private getBalancedTeam(): number {
    let alpha = 0;
    let bravo = 0;

    for (const player of this.roomPlayers.values()) {
      if (player.team === Team.Alpha) alpha++;
      else if (player.team === Team.Bravo) bravo++;
    }

    return alpha <= bravo ? Team.Alpha : Team.Bravo;
  }

  private getServerClient(clientId: string): ServerClient | undefined {
    return this.network.getClients().get(clientId);
  }
}
