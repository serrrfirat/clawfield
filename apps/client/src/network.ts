import type { ClientMessage, ServerMessage, GameMode } from '@clawfield/shared';
import { SERVER_PORT } from '@clawfield/shared';
import lz4 from 'lz4js';

/** Flag bytes matching server protocol */
const FLAG_RAW = 0x00;
const FLAG_LZ4 = 0x01;

export type MessageHandler = (msg: ServerMessage) => void;

/**
 * Decode a binary message from the server.
 * Supports both the new binary protocol (flag byte + optional LZ4) and
 * legacy plain JSON strings for backward compatibility.
 */
function decodeMessage(data: ArrayBuffer): ServerMessage {
  const view = new Uint8Array(data);
  const flag = view[0];

  if (flag === FLAG_RAW) {
    // Raw JSON after flag byte
    const decoder = new TextDecoder();
    const json = decoder.decode(view.subarray(1));
    return JSON.parse(json);
  }

  if (flag === FLAG_LZ4) {
    // LZ4 compressed: [flag][4-byte LE uncompressed length][compressed data]
    const uncompressedLen =
      view[1] | (view[2] << 8) | (view[3] << 16) | (view[4] << 24);
    const compressed = view.subarray(5);
    const decompressed = new Uint8Array(uncompressedLen);
    lz4.decompressBlock(compressed, decompressed, 0, compressed.length, 0);
    const decoder = new TextDecoder();
    const json = decoder.decode(decompressed);
    return JSON.parse(json);
  }

  // Unknown flag — try parsing the whole thing as JSON (legacy fallback)
  const decoder = new TextDecoder();
  return JSON.parse(decoder.decode(view));
}

/**
 * WebSocket client for connecting to the game server.
 */
export class NetworkClient {
  private ws: WebSocket | null = null;
  private handler: MessageHandler;
  private _connected = false;
  private _onConnected: (() => void) | null = null;
  private _onConnectionFailed: (() => void) | null = null;
  private _autoReconnect = false;

  /** Session token for reconnection (set after welcome) */
  sessionToken: string | null = null;

  constructor(handler: MessageHandler) {
    this.handler = handler;
  }

  get connected(): boolean {
    return this._connected;
  }

  /** Register a callback fired once after the WebSocket connection opens. */
  set onConnected(cb: (() => void) | null) {
    this._onConnected = cb;
  }

  /** Register a callback fired when connection attempt fails. */
  set onConnectionFailed(cb: (() => void) | null) {
    this._onConnectionFailed = cb;
  }

  connect(): void {
    // VITE_SERVER_URL can be set to e.g. "wss://clawfield-server.up.railway.app"
    const serverUrl = import.meta.env.VITE_SERVER_URL;
    let wsUrl: string;
    if (serverUrl) {
      wsUrl = serverUrl;
    } else {
      const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
      const host = location.hostname || 'localhost';
      wsUrl = `${protocol}//${host}:${SERVER_PORT}`;
    }
    this.ws = new WebSocket(wsUrl);
    // Request binary frames so we can handle the flag-byte protocol
    this.ws.binaryType = 'arraybuffer';

    this.ws.onopen = () => {
      this._connected = true;
      this._autoReconnect = true;
      console.log('Connected to server');
      const cb = this._onConnected;
      this._onConnected = null;
      cb?.();
    };

    this.ws.onmessage = (event) => {
      try {
        let msg: ServerMessage;
        if (event.data instanceof ArrayBuffer) {
          msg = decodeMessage(event.data);
        } else {
          // Legacy string message fallback
          msg = JSON.parse(event.data as string);
        }
        this.handler(msg);
      } catch {
        console.warn('Failed to parse server message');
      }
    };

    this.ws.onclose = () => {
      const wasConnected = this._connected;
      this._connected = false;

      if (!wasConnected) {
        // Connection attempt failed (never opened)
        console.log('Failed to connect to server');
        this._onConnectionFailed?.();
        this._onConnected = null;
        return;
      }

      console.log('Disconnected from server');
      // Auto-reconnect only if we were previously connected
      if (this._autoReconnect) {
        setTimeout(() => this.connect(), 2000);
      }
    };

    this.ws.onerror = (_err) => {
      // onerror always fires before onclose; onclose handles the logic
    };
  }

  /** Send a join message to the server with the chosen name and game mode. */
  join(name: string, gameMode: GameMode): void {
    this.send({ type: 'join', name, classId: 'assault', gameMode });
  }

  /** Send a rejoin message to reconnect to an existing session. */
  rejoin(token: string): void {
    this.send({ type: 'rejoin', sessionToken: token });
  }

  /** Client → server messages are always plain JSON strings */
  send(msg: ClientMessage): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }
}
