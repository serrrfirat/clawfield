import { Room, type Client as ColyseusClient } from 'colyseus';
import { Team, type ClientMessage, type GameMode, type PlayerState } from '@clawfield/shared';
import { TICK_INTERVAL } from '@clawfield/shared';
import { GameLoop, type LobbyPlayerInfo } from '../game-loop.js';
import { ColyseusNetworkAdapter } from './ColyseusNetworkAdapter.js';
import type { Client as ServerClient } from '../network.js';
import { GameState, PlayerSchema, CapturePointSchema } from './schemas.js';

interface RoomPlayer {
  id: string;
  name: string;
  team: number;
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

  onCreate() {
    this.setState(new GameState());
    const patchMsEnv = Number(process.env.CLAWFIELD_SCHEMA_PATCH_MS ?? NaN);
    const patchMs = Number.isFinite(patchMsEnv) && patchMsEnv > 0 ? patchMsEnv : TICK_INTERVAL;
    this.setPatchRate(patchMs);

    this.onMessage('client_message', (colyseusClient, msg: ClientMessage) => {
      this.handleClientMessage(colyseusClient, msg);
    });
    console.log(`[Colyseus] BattleRoom created (Schema delta sync enabled, patchRate=${patchMs.toFixed(2)}ms)`);
  }

  onJoin(colyseusClient: ColyseusClient) {
    this.network.registerClient(colyseusClient);
    console.log(`[Colyseus] Client connected: ${colyseusClient.sessionId}`);
  }

  onLeave(colyseusClient: ColyseusClient) {
    const serverClient = this.getServerClient(colyseusClient.sessionId);
    if (serverClient && this.gameLoop) {
      this.gameLoop.handleDisconnect(serverClient);
    }

    // Remove from Schema
    this.state.players.delete(colyseusClient.sessionId);

    this.roomPlayers.delete(colyseusClient.sessionId);
    this.network.unregisterClient(colyseusClient.sessionId);

    // Destroy loop when no players remain.
    if (this.roomPlayers.size === 0 && this.gameLoop) {
      this.gameLoop.destroy();
      this.gameLoop = null;
      console.log('[Colyseus] GameLoop destroyed (room empty)');
    }
  }

  onDispose() {
    this.gameLoop?.destroy();
    this.gameLoop = null;
  }

  private handleClientMessage(colyseusClient: ColyseusClient, msg: ClientMessage) {
    const serverClient = this.getServerClient(colyseusClient.sessionId);
    if (!serverClient) return;

    if (msg.type === 'join') {
      this.handleJoinMessage(serverClient, msg);
      return;
    }

    if (this.gameLoop) {
      this.gameLoop.handleMessage(serverClient, msg);
    }
  }

  /** Wire up the game loop's state callback to populate Schema */
  private wireStateSync(): void {
    if (!this.gameLoop) return;

    // Suppress JSON state broadcast — Schema handles it
    this.gameLoop.suppressStateBroadcast = true;

    this.gameLoop.onStateComputed = (players: PlayerState[], tick: number) => {
      this.state.tick = tick;

      // Update player schemas
      const activeIds = new Set<string>();
      for (const p of players) {
        activeIds.add(p.id);

        let schema = this.state.players.get(p.id);
        if (!schema) {
          schema = new PlayerSchema();
          this.state.players.set(p.id, schema);
        }

        schema.name = p.name;
        schema.x = p.position.x;
        schema.y = p.position.y;
        schema.z = p.position.z;
        schema.yaw = p.yaw;
        schema.pitch = p.pitch;
        schema.health = p.health;
        schema.alive = p.alive;
        schema.downed = p.downed;
        schema.grounded = p.grounded;
        schema.inWater = p.inWater;
        schema.reloading = p.reloading;
        schema.shooting = p.shooting;
        schema.team = p.team;
        schema.classId = p.classId;
        schema.ammo = p.ammo;
        schema.maxAmmo = p.maxAmmo;
        schema.weaponSlot = p.weaponSlot;
        schema.weaponName = p.weaponName;
      }

      // Remove players that are no longer in the state
      this.state.players.forEach((_schema, id) => {
        if (!activeIds.has(id)) {
          this.state.players.delete(id);
        }
      });

      // Update capture points
      const cpStates = this.gameLoop!.getCapturePoints();
      for (const cp of cpStates) {
        let cpSchema = this.state.capturePoints.get(cp.id);
        if (!cpSchema) {
          cpSchema = new CapturePointSchema();
          this.state.capturePoints.set(cp.id, cpSchema);
        }
        cpSchema.x = cp.position.x;
        cpSchema.y = cp.position.y;
        cpSchema.z = cp.position.z;
        cpSchema.control = cp.control;
        cpSchema.owner = cp.owner;
        cpSchema.contested = cp.contested;
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

  private handleJoinMessage(serverClient: ServerClient, msg: Extract<ClientMessage, { type: 'join' }>) {
    serverClient.name = msg.name;

    if (!this.gameLoop) {
      this.gameMode = msg.gameMode;
      const team = this.getBalancedTeam();
      this.roomPlayers.set(serverClient.id, {
        id: serverClient.id,
        name: msg.name,
        team,
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
      );

      this.wireStateSync();
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
      });
      this.gameLoop.hotJoinPlayer(serverClient, msg.name, team);
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
