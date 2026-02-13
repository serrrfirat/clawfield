import { Room, type Client as ColyseusClient } from 'colyseus';
import { Team, type ClientMessage, type GameMode } from '@clawfield/shared';
import { GameLoop, type LobbyPlayerInfo } from '../game-loop.js';
import { ColyseusNetworkAdapter } from './ColyseusNetworkAdapter.js';
import type { Client as ServerClient } from '../network.js';

interface RoomPlayer {
  id: string;
  name: string;
  team: number;
}

/**
 * Colyseus room running the existing authoritative GameLoop.
 *
 * This is a migration bridge: transport moves to Colyseus while gameplay
 * simulation remains in existing server systems.
 */
export class BattleRoom extends Room {
  maxClients = 16;

  private network = new ColyseusNetworkAdapter();
  private gameLoop: GameLoop | null = null;
  private gameMode: GameMode = 'tdm';
  private roomPlayers = new Map<string, RoomPlayer>();

  onCreate() {
    this.onMessage('client_message', (colyseusClient, msg: ClientMessage) => {
      this.handleClientMessage(colyseusClient, msg);
    });
    console.log('[Colyseus] BattleRoom created');
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
