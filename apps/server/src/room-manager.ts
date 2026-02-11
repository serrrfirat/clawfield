import type { ClientMessage, GameMode, ServerPhase, LobbyPlayer } from '@clawfield/shared';
import { Team } from '@clawfield/shared';
import { NetworkServer, type Client } from './network.js';
import { GameLoop, type LobbyPlayerInfo } from './game-loop.js';
import { getConfiguredMapName, listAvailableMaps } from './map-loader.js';

/** Maximum players per room */
const MAX_PLAYERS = 10;

/** Seconds to wait in post-game before returning to lobby */
const POST_GAME_DELAY = 15;

/** Characters used for room codes (no I, O to avoid confusion) */
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';

interface RoomPlayer {
  clientId: string;
  name: string;
  team: number;
  isHost: boolean;
}

/**
 * Server state machine managing room lifecycle:
 * IDLE → LOBBY → IN_GAME → POST_GAME → LOBBY
 *
 * Single room at a time. Owns the NetworkServer and delegates
 * to GameLoop only during the IN_GAME phase.
 */
export class RoomManager {
  private network: NetworkServer;
  private phase: ServerPhase = 'idle';
  private roomCode = '';
  private hostId = '';
  private roomPlayers = new Map<string, RoomPlayer>();
  private gameMode: GameMode = 'tdm';
  private selectedMap: string = getConfiguredMapName();
  private availableMaps: { id: string; name: string }[] = listAvailableMaps();
  private gameLoop: GameLoop | null = null;
  private postGameTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(port: number) {
    this.network = new NetworkServer(
      port,
      (client, msg) => this.handleMessage(client, msg),
      (client) => this.handleConnect(client),
      (client) => this.handleDisconnect(client)
    );
    console.log('RoomManager ready (idle)');
  }

  private generateRoomCode(): string {
    let code = '';
    for (let i = 0; i < 4; i++) {
      code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
    }
    return code;
  }

  private handleConnect(_client: Client): void {
    // Nothing until they send create_room or join_room
  }

  private handleDisconnect(client: Client): void {
    if (this.phase === 'in_game' && this.gameLoop) {
      // Delegate to game loop
      this.gameLoop.handleDisconnect(client);
    }

    // Remove from room players
    const player = this.roomPlayers.get(client.id);
    if (!player) return;

    this.roomPlayers.delete(client.id);

    if (this.phase === 'lobby') {
      if (player.isHost) {
        // Host left — close the room
        this.network.broadcast({ type: 'room_closed' });
        this.resetToIdle();
        console.log(`Host ${player.name} disconnected, room closed`);
      } else {
        // Non-host left — broadcast updated lobby state
        this.broadcastLobbyState();
        console.log(`Player ${player.name} left lobby`);
      }
    } else if (this.phase === 'in_game' || this.phase === 'post_game') {
      if (this.roomPlayers.size === 0) {
        // All players left — clean up
        this.cleanupGame();
        this.resetToIdle();
        console.log('All players left, returning to idle');
      }
    }
  }

  private handleMessage(client: Client, msg: ClientMessage): void {
    // During IN_GAME, delegate game messages to GameLoop
    if (this.phase === 'in_game' && this.gameLoop) {
      // These message types are handled by the game loop
      if (msg.type === 'input' || msg.type === 'select_class' || msg.type === 'deploy') {
        this.gameLoop.handleMessage(client, msg);
        return;
      }
    }

    switch (msg.type) {
      case 'create_room': {
        if (this.phase !== 'idle') {
          this.network.send(client, {
            type: 'room_error',
            message: 'A room is already active on this server.',
          });
          return;
        }

        this.roomCode = this.generateRoomCode();
        this.phase = 'lobby';
        this.hostId = client.id;
        client.name = msg.name;

        const player: RoomPlayer = {
          clientId: client.id,
          name: msg.name,
          team: Team.Alpha,
          isHost: true,
        };
        this.roomPlayers.set(client.id, player);

        this.network.send(client, {
          type: 'room_created',
          roomCode: this.roomCode,
          playerId: client.id,
        });

        this.broadcastLobbyState();
        console.log(`Room ${this.roomCode} created by ${msg.name} (${client.id})`);
        break;
      }

      case 'join_room': {
        if (this.phase !== 'lobby') {
          this.network.send(client, {
            type: 'room_error',
            message: this.phase === 'idle'
              ? 'No room exists. Create one first.'
              : 'Game is already in progress.',
          });
          return;
        }

        if (msg.roomCode.toUpperCase() !== this.roomCode) {
          this.network.send(client, {
            type: 'room_error',
            message: 'Invalid room code.',
          });
          return;
        }

        if (this.roomPlayers.size >= MAX_PLAYERS) {
          this.network.send(client, {
            type: 'room_error',
            message: 'Room is full.',
          });
          return;
        }

        client.name = msg.name;

        // Assign team round-robin (balance teams)
        const team = this.getBalancedTeam();
        const player: RoomPlayer = {
          clientId: client.id,
          name: msg.name,
          team,
          isHost: false,
        };
        this.roomPlayers.set(client.id, player);

        this.network.send(client, {
          type: 'room_joined',
          roomCode: this.roomCode,
          playerId: client.id,
          hostId: this.hostId,
        });

        this.broadcastLobbyState();
        console.log(`${msg.name} joined room ${this.roomCode} (team ${team})`);
        break;
      }

      case 'lobby_set_team': {
        if (this.phase !== 'lobby') return;
        const rp = this.roomPlayers.get(client.id);
        if (!rp) return;
        rp.team = msg.team;
        this.broadcastLobbyState();
        break;
      }

      case 'lobby_set_mode': {
        if (this.phase !== 'lobby') return;
        if (client.id !== this.hostId) return; // Only host can change mode
        this.gameMode = msg.gameMode;
        this.broadcastLobbyState();
        console.log(`Game mode set to ${this.gameMode}`);
        break;
      }

      case 'lobby_set_map': {
        if (this.phase !== 'lobby') return;
        if (client.id !== this.hostId) return; // Only host can change map
        // Validate map exists in available maps
        if (!this.availableMaps.some((m) => m.id === msg.mapName)) return;
        this.selectedMap = msg.mapName;
        this.broadcastLobbyState();
        console.log(`Map set to ${this.selectedMap}`);
        break;
      }

      case 'start_game': {
        if (this.phase !== 'lobby') return;
        if (client.id !== this.hostId) return; // Only host can start
        this.startGame();
        break;
      }

      case 'return_to_menu': {
        // Player wants to leave the room
        const rp = this.roomPlayers.get(client.id);
        if (!rp) return;

        if (this.phase === 'lobby' && rp.isHost) {
          // Host leaving closes the room
          this.network.broadcastExcept(client.id, { type: 'room_closed' });
          this.resetToIdle();
        } else if (this.phase === 'lobby') {
          this.roomPlayers.delete(client.id);
          this.broadcastLobbyState();
        }
        break;
      }

      // Ignore join (legacy) during room-managed mode
      case 'join':
        break;
    }
  }

  private getBalancedTeam(): number {
    let alpha = 0;
    let bravo = 0;
    for (const p of this.roomPlayers.values()) {
      if (p.team === Team.Alpha) alpha++;
      else bravo++;
    }
    return alpha <= bravo ? Team.Alpha : Team.Bravo;
  }

  private broadcastLobbyState(): void {
    const players: LobbyPlayer[] = [];
    for (const p of this.roomPlayers.values()) {
      players.push({
        id: p.clientId,
        name: p.name,
        team: p.team,
        isHost: p.isHost,
      });
    }

    this.network.broadcast({
      type: 'lobby_state',
      players,
      gameMode: this.gameMode,
      hostId: this.hostId,
      roomCode: this.roomCode,
      phase: this.phase,
      mapName: this.selectedMap,
      availableMaps: this.availableMaps,
    });
  }

  private startGame(): void {
    console.log(`Starting game in room ${this.roomCode} (${this.gameMode}) with ${this.roomPlayers.size} players`);

    this.phase = 'in_game';

    // Build lobby player list for GameLoop
    const lobbyPlayers: LobbyPlayerInfo[] = [];
    for (const p of this.roomPlayers.values()) {
      lobbyPlayers.push({
        clientId: p.clientId,
        name: p.name,
        team: p.team,
      });
    }

    // Broadcast game starting (clients can show a brief countdown)
    this.network.broadcast({ type: 'game_starting', countdown: 0 });

    // Create game loop with current players and selected map
    try {
      this.gameLoop = new GameLoop(
        this.network,
        lobbyPlayers,
        this.gameMode,
        (winner) => this.onGameOver(winner),
        this.selectedMap
      );
    } catch (err) {
      console.error('[RoomManager] Failed to start game:', err);
      this.network.broadcast({ type: 'room_closed' });
      this.resetToIdle();
    }
  }

  private onGameOver(winner: number): void {
    console.log(`Game over in room ${this.roomCode}, winner: ${winner === Team.Alpha ? 'Alpha' : 'Bravo'}`);
    this.phase = 'post_game';

    // After delay, return everyone to lobby
    this.postGameTimer = setTimeout(() => {
      this.returnToLobby();
    }, POST_GAME_DELAY * 1000);
  }

  private returnToLobby(): void {
    this.cleanupGame();
    this.phase = 'lobby';

    // Broadcast return to lobby
    this.network.broadcast({ type: 'return_to_lobby' });

    // Broadcast updated lobby state
    this.broadcastLobbyState();
    console.log(`Room ${this.roomCode}: returned to lobby`);
  }

  private cleanupGame(): void {
    if (this.gameLoop) {
      this.gameLoop.destroy();
      this.gameLoop = null;
    }
    if (this.postGameTimer) {
      clearTimeout(this.postGameTimer);
      this.postGameTimer = null;
    }
  }

  private resetToIdle(): void {
    this.cleanupGame();
    this.phase = 'idle';
    this.roomCode = '';
    this.hostId = '';
    this.roomPlayers.clear();
    this.gameMode = 'tdm';
    this.selectedMap = getConfiguredMapName();
    console.log('RoomManager reset to idle');
  }
}
