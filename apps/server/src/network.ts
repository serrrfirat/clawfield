import { WebSocketServer, WebSocket } from 'ws';
import type { IncomingMessage } from 'http';
import type { ServerMessage, ClientMessage } from '@clawfield/shared';

export interface Client {
  id: string;
  name: string;
  ws: WebSocket;
  alive: boolean;
}

export type ClientMessageHandler = (client: Client, msg: ClientMessage) => void;
export type ClientConnectHandler = (client: Client) => void;
export type ClientDisconnectHandler = (client: Client) => void;

let nextId = 1;

/**
 * WebSocket server managing client connections and message routing.
 */
export class NetworkServer {
  private wss: WebSocketServer;
  private clients = new Map<string, Client>();
  private onMessage: ClientMessageHandler;
  private onConnect: ClientConnectHandler;
  private onDisconnect: ClientDisconnectHandler;

  constructor(
    port: number,
    onMessage: ClientMessageHandler,
    onConnect: ClientConnectHandler,
    onDisconnect: ClientDisconnectHandler
  ) {
    this.onMessage = onMessage;
    this.onConnect = onConnect;
    this.onDisconnect = onDisconnect;

    this.wss = new WebSocketServer({ port });

    this.wss.on('connection', (ws: WebSocket, _req: IncomingMessage) => {
      const id = `p${nextId++}`;
      const client: Client = { id, name: '', ws, alive: true };
      this.clients.set(id, client);

      console.log(`Client connected: ${id}`);
      this.onConnect(client);

      ws.on('message', (data) => {
        try {
          const msg: ClientMessage = JSON.parse(data.toString());
          this.onMessage(client, msg);
        } catch {
          console.warn(`Invalid message from ${id}`);
        }
      });

      ws.on('close', () => {
        console.log(`Client disconnected: ${id}`);
        client.alive = false;
        this.clients.delete(id);
        this.onDisconnect(client);
      });

      ws.on('error', (err) => {
        console.error(`Client ${id} error:`, err);
      });
    });

    console.log(`WebSocket server listening on port ${port}`);
  }

  /** Send a message to a specific client */
  send(client: Client, msg: ServerMessage): void {
    if (client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(JSON.stringify(msg));
    }
  }

  /** Broadcast a message to all connected clients */
  broadcast(msg: ServerMessage): void {
    const data = JSON.stringify(msg);
    for (const client of this.clients.values()) {
      if (client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(data);
      }
    }
  }

  /** Broadcast a message to all clients except one */
  broadcastExcept(excludeId: string, msg: ServerMessage): void {
    const data = JSON.stringify(msg);
    for (const client of this.clients.values()) {
      if (client.id !== excludeId && client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(data);
      }
    }
  }

  /** Get all connected clients */
  getClients(): Map<string, Client> {
    return this.clients;
  }
}
