import { Client as ColyseusClient, Room } from 'colyseus.js'
import type { ClientMessage, GameMode, ServerMessage } from '@clawfield/shared'
import { SERVER_PORT } from '@clawfield/shared'
import type { MessageHandler } from './network-client'

export class ColyseusNetworkClient {
  private client: ColyseusClient | null = null
  private room: Room | null = null
  private handler: MessageHandler
  private _connected = false
  private _onConnected: (() => void) | null = null
  private _onConnectionFailed: (() => void) | null = null

  constructor(handler: MessageHandler) {
    this.handler = handler
  }

  get connected(): boolean {
    return this._connected
  }

  set onConnected(cb: (() => void) | null) {
    this._onConnected = cb
  }

  set onConnectionFailed(cb: (() => void) | null) {
    this._onConnectionFailed = cb
  }

  async connect(): Promise<void> {
    if (this.room) return

    const serverUrl = import.meta.env.VITE_SERVER_URL
    const endpoint = serverUrl
      ? this.normalizeEndpoint(serverUrl)
      : this.getDefaultHttpEndpoint()

    try {
      this.client = new ColyseusClient(endpoint)
      this.room = await this.client.joinOrCreate('battle')

      this.room.onMessage('server_message', (msg: ServerMessage) => {
        this.handler(msg)
      })

      this.room.onLeave(() => {
        this._connected = false
        this.room = null
      })

      this._connected = true
      const cb = this._onConnected
      this._onConnected = null
      cb?.()
    } catch (error) {
      console.error('[Colyseus] Failed to connect', error)
      this._onConnectionFailed?.()
      this._onConnected = null
    }
  }

  disconnect(): void {
    if (this.room) {
      void this.room.leave()
    }
    this.room = null
    this._connected = false
  }

  join(name: string, gameMode: GameMode): void {
    this.send({ type: 'join', name, classId: 'assault', gameMode })
  }

  rejoin(token: string): void {
    this.send({ type: 'rejoin', sessionToken: token })
  }

  send(msg: ClientMessage): void {
    this.room?.send('client_message', msg)
  }

  private getDefaultHttpEndpoint(): string {
    const protocol = location.protocol === 'https:' ? 'https:' : 'http:'
    const host = location.hostname || 'localhost'
    return `${protocol}//${host}:${SERVER_PORT}`
  }

  private normalizeEndpoint(url: string): string {
    if (url.startsWith('ws://')) return `http://${url.slice('ws://'.length)}`
    if (url.startsWith('wss://')) return `https://${url.slice('wss://'.length)}`
    return url
  }
}
