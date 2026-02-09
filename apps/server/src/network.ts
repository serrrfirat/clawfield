import { WebSocketServer, WebSocket } from 'ws';
import type { IncomingMessage } from 'http';
import type { ServerMessage, ClientMessage } from '@clawfield/shared';
import lz4 from 'lz4js';

/** Compression threshold in bytes — messages smaller than this skip compression */
const COMPRESS_THRESHOLD = 4096;

/** Flag bytes for the binary protocol */
const FLAG_RAW = 0x00;
const FLAG_LZ4 = 0x01;

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

/** Reusable hash table for LZ4 block compression (zeroed before each use) */
const lz4HashTable = new Uint32Array(1 << 16);

/**
 * Encode a server message to a binary buffer.
 * Messages < COMPRESS_THRESHOLD: [0x00 flag][JSON UTF-8 bytes]
 * Messages >= COMPRESS_THRESHOLD: [0x01 flag][4-byte LE uncompressed length][LZ4 compressed bytes]
 */
function encodeMessage(msg: ServerMessage): Buffer {
  const json = JSON.stringify(msg);
  const jsonBytes = Buffer.from(json, 'utf-8');

  if (jsonBytes.length < COMPRESS_THRESHOLD) {
    // Small message: flag byte + raw JSON
    const buf = Buffer.allocUnsafe(1 + jsonBytes.length);
    buf[0] = FLAG_RAW;
    jsonBytes.copy(buf, 1);
    return buf;
  }

  // Large message: flag byte + 4-byte LE uncompressed length + LZ4 block compressed
  const maxCompressed = lz4.compressBound(jsonBytes.length);
  const compBuf = Buffer.allocUnsafe(maxCompressed);
  lz4HashTable.fill(0);
  const compLen = lz4.compressBlock(jsonBytes, compBuf, 0, jsonBytes.length, lz4HashTable);
  const buf = Buffer.allocUnsafe(1 + 4 + compLen);
  buf[0] = FLAG_LZ4;
  buf.writeUInt32LE(jsonBytes.length, 1);
  compBuf.copy(buf, 5, 0, compLen);
  return buf;
}

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
          // Client → server messages are always plain JSON strings
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
      client.ws.send(encodeMessage(msg));
    }
  }

  /** Broadcast a message to all connected clients (pre-encodes once) */
  broadcast(msg: ServerMessage): void {
    const data = encodeMessage(msg);
    for (const client of this.clients.values()) {
      if (client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(data);
      }
    }
  }

  /** Broadcast a message to all clients except one (pre-encodes once) */
  broadcastExcept(excludeId: string, msg: ServerMessage): void {
    const data = encodeMessage(msg);
    for (const client of this.clients.values()) {
      if (client.id !== excludeId && client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(data);
      }
    }
  }

  /** Broadcast a message only to clients on a given team (pre-encodes once) */
  broadcastToTeam(team: number, msg: ServerMessage, getTeam: (clientId: string) => number | undefined): void {
    const data = encodeMessage(msg);
    for (const client of this.clients.values()) {
      if (client.ws.readyState === WebSocket.OPEN && getTeam(client.id) === team) {
        client.ws.send(data);
      }
    }
  }

  /** Get all connected clients */
  getClients(): Map<string, Client> {
    return this.clients;
  }
}
