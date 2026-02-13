import type { ServerMessage } from '@clawfield/shared';
import type { Client as ServerClient } from '../network.js';
import type { Client as ColyseusClient } from 'colyseus';

interface ColyseusBackedClient extends ServerClient {
  colyseus: ColyseusClient;
}

/**
 * Adapts Colyseus room clients to the existing NetworkServer-style API
 * used by GameLoop.
 */
export class ColyseusNetworkAdapter {
  private clients = new Map<string, ColyseusBackedClient>();

  registerClient(colyseusClient: ColyseusClient): ServerClient {
    const client: ColyseusBackedClient = {
      id: colyseusClient.sessionId,
      name: '',
      alive: true,
      colyseus: colyseusClient,
    };
    this.clients.set(client.id, client);
    return client;
  }

  unregisterClient(clientId: string): void {
    this.clients.delete(clientId);
  }

  send(client: ServerClient, msg: ServerMessage): void {
    const wrapped = this.clients.get(client.id);
    wrapped?.colyseus.send('server_message', msg);
  }

  broadcast(msg: ServerMessage): void {
    for (const client of this.clients.values()) {
      client.colyseus.send('server_message', msg);
    }
  }

  broadcastExcept(excludeId: string, msg: ServerMessage): void {
    for (const client of this.clients.values()) {
      if (client.id !== excludeId) {
        client.colyseus.send('server_message', msg);
      }
    }
  }

  broadcastToTeam(team: number, msg: ServerMessage, getTeam: (clientId: string) => number | undefined): void {
    for (const client of this.clients.values()) {
      if (getTeam(client.id) === team) {
        client.colyseus.send('server_message', msg);
      }
    }
  }

  reassignClientId(client: ServerClient, newId: string): void {
    const wrapped = this.clients.get(client.id);
    if (!wrapped) return;
    this.clients.delete(client.id);
    wrapped.id = newId;
    client.id = newId;
    this.clients.set(newId, wrapped);
  }

  getClients(): Map<string, ServerClient> {
    return this.clients as unknown as Map<string, ServerClient>;
  }
}
