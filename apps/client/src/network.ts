import type { ClientMessage, ServerMessage } from '@clawfield/shared';
import { SERVER_PORT } from '@clawfield/shared';

export type MessageHandler = (msg: ServerMessage) => void;

/**
 * WebSocket client for connecting to the game server.
 */
export class NetworkClient {
  private ws: WebSocket | null = null;
  private handler: MessageHandler;
  private _connected = false;

  constructor(handler: MessageHandler) {
    this.handler = handler;
  }

  get connected(): boolean {
    return this._connected;
  }

  connect(): void {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = location.hostname || 'localhost';
    this.ws = new WebSocket(`${protocol}//${host}:${SERVER_PORT}`);

    this.ws.onopen = () => {
      this._connected = true;
      console.log('Connected to server');

      // Send join message — player starts in deploy screen, not yet spawned
      const name = `Player_${Math.floor(Math.random() * 1000)}`;
      this.send({ type: 'join', name, classId: 'assault' });
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

  send(msg: ClientMessage): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }
}
