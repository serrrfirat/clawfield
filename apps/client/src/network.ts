import type { ClientMessage, ServerMessage, GameMode } from '@clawfield/shared';
import { SERVER_PORT } from '@clawfield/shared';

export type MessageHandler = (msg: ServerMessage) => void;

/**
 * WebSocket client for connecting to the game server.
 */
export class NetworkClient {
  private ws: WebSocket | null = null;
  private handler: MessageHandler;
  private _connected = false;
  private _onConnected: (() => void) | null = null;

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

  connect(): void {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = location.hostname || 'localhost';
    this.ws = new WebSocket(`${protocol}//${host}:${SERVER_PORT}`);

    this.ws.onopen = () => {
      this._connected = true;
      console.log('Connected to server');
      this._onConnected?.();
    };

    this.ws.onmessage = (event) => {
      try {
        const msg: ServerMessage = JSON.parse(event.data as string);
        this.handler(msg);
      } catch {
        console.warn('Failed to parse server message');
      }
    };

    this.ws.onclose = () => {
      this._connected = false;
      console.log('Disconnected from server');
      // Try to reconnect after 2 seconds
      setTimeout(() => this.connect(), 2000);
    };

    this.ws.onerror = (err) => {
      console.error('WebSocket error', err);
    };
  }

  /** Send a join message to the server with the chosen name and game mode. */
  join(name: string, gameMode: GameMode): void {
    this.send({ type: 'join', name, classId: 'assault', gameMode });
  }

  send(msg: ClientMessage): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }
}
