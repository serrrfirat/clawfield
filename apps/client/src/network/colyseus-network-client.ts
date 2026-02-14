import { Client as ColyseusClient, Room } from 'colyseus.js'
import type { ClientMessage, GameMode, MatchConfig, PlacementCollider, ServerMessage, PlayerState } from '@clawfield/shared'
import { SERVER_PORT } from '@clawfield/shared'
import type { MessageHandler } from './network-client'

const USE_SCHEMA_SYNC = (import.meta.env.VITE_USE_SCHEMA_SYNC ?? '0') === '1'

/**
 * Colyseus network client with Schema delta sync.
 *
 * Player state (positions, health, capture points) arrives via binary Schema
 * patches — only changed fields are sent (~10x less bandwidth than JSON).
 *
 * Events (hit confirms, projectiles, grenades, etc.) still arrive as Room
 * messages and are forwarded to the store's handleServerMessage unchanged.
 */
export class ColyseusNetworkClient {
  private client: ColyseusClient | null = null
  private room: Room | null = null
  private handler: MessageHandler
  private _connected = false
  private _onConnected: (() => void) | null = null
  private _onConnectionFailed: (() => void) | null = null
  private _mySessionId: string | null = null
  /** Last ack seq received from the server (for future reconciliation) */
  private _lastAck = 0
  private _pendingJoin: { name: string; gameMode: GameMode } | null = null

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
    if (this.client) return

    const serverUrl = import.meta.env.VITE_SERVER_URL
    const endpoint = serverUrl
      ? this.normalizeEndpoint(serverUrl)
      : this.getDefaultHttpEndpoint()

    try {
      this.client = new ColyseusClient(endpoint)
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
    this._mySessionId = null
    this._pendingJoin = null
  }

  join(name: string, gameMode: GameMode): void {
    this._pendingJoin = { name, gameMode }

    if (this.room) {
      this.send({ type: 'join', name, classId: 'assault', gameMode })
      return
    }

    void this.joinQuickPlayRoom(gameMode)
  }

  rejoin(token: string): void {
    this.send({ type: 'rejoin', sessionToken: token })
  }

  send(msg: ClientMessage): void {
    this.room?.send('client_message', msg)
  }

  async createRoom(name: string, gameMode: GameMode = 'tdm'): Promise<void> {
    try {
      if (!this.client) await this.connect()
      if (!this.client) return

      if (this.room) {
        await this.room.leave()
        this.room = null
        this._mySessionId = null
      }

      const room = await this.client.create('battle_lobby', { auto: false, gameMode })
      this.attachRoom(room)
      this.send({ type: 'create_room', name })
    } catch (error) {
      console.error('[Colyseus] createRoom failed', error)
      this.handler({ type: 'room_error', message: 'Failed to create room. Check server and retry.' })
    }
  }

  async joinRoom(name: string, roomCode: string): Promise<void> {
    try {
      if (!this.client) await this.connect()
      if (!this.client) return

      if (this.room) {
        await this.room.leave()
        this.room = null
        this._mySessionId = null
      }

      const rooms = await (this.client as any).getAvailableRooms('battle_lobby')
      const target = rooms.find((r: any) => (r.metadata?.roomCode ?? '').toUpperCase() === roomCode.toUpperCase())
      if (!target?.roomId) {
        this.handler({ type: 'room_error', message: 'Invalid room code.' })
        return
      }

      const room = await this.client.joinById(target.roomId)
      this.attachRoom(room)
      this.send({ type: 'join_room', name, roomCode })
    } catch (error) {
      console.error('[Colyseus] joinRoom failed', error)
      this.handler({ type: 'room_error', message: 'Failed to join room. Check code/server and retry.' })
    }
  }

  startGame(): void {
    this.send({ type: 'start_game' })
  }

  setLobbyTeam(team: number): void {
    this.send({ type: 'lobby_set_team', team })
  }

  setLobbyMode(gameMode: GameMode): void {
    this.send({ type: 'lobby_set_mode', gameMode })
  }

  setLobbyMap(mapName: string): void {
    this.send({ type: 'lobby_set_map', mapName })
  }

  setLobbySeed(seed: number): void {
    this.send({ type: 'lobby_set_seed', seed })
  }

  setLobbyMatchConfig(matchConfig: MatchConfig): void {
    this.send({ type: 'lobby_set_match_config', matchConfig })
  }

  setLobbyPlacementColliders(colliders: PlacementCollider[]): void {
    this.send({ type: 'lobby_set_placement_colliders', colliders })
  }

  returnToMenu(): void {
    this.send({ type: 'return_to_menu' })
  }

  private async joinQuickPlayRoom(gameMode: GameMode): Promise<void> {
    try {
      if (!this.client) return
      if (this.room) return

      const room = await this.client.joinOrCreate('battle_quick', { auto: true, gameMode })
      this.attachRoom(room)

      if (this._pendingJoin) {
        const { name, gameMode: pendingMode } = this._pendingJoin
        this.send({ type: 'join', name, classId: 'assault', gameMode: pendingMode })
      }
    } catch (error) {
      console.error('[Colyseus] quickplay join failed', error)
      this.handler({ type: 'room_error', message: 'Quick play failed. Check server and retry.' })
    }
  }

  private attachRoom(room: Room): void {
    this.room = room
    this._mySessionId = room.sessionId

    if (USE_SCHEMA_SYNC) {
      room.onStateChange((state: any) => {
        const playerCount = state?.players?.size ?? 0
        if (playerCount > 0) {
          console.log(`[Schema] onStateChange: ${playerCount} players, tick=${state?.tick}`)
        }
        this.synthesizeStateMessage()
      })

      room.onMessage('ack', (seq: number) => {
        this._lastAck = seq
      })
    }

    room.onMessage('server_message', (msg: ServerMessage) => {
      this.handler(msg)
    })

    room.onLeave(() => {
      this.room = null
      this._mySessionId = null
    })
  }

  /**
   * Convert Schema state into the same { type: 'state', players, tick, ack }
   * format that the raw WebSocket path produces. This means the store's existing
   * 'state' case handler works without modification.
   */
  private synthesizeStateMessage(): void {
    if (!this.room?.state) return

    const state = this.room.state as any
    const players: PlayerState[] = []

    // Iterate the MapSchema<PlayerSchema>
    const schemaPlayers = state.players
    if (schemaPlayers) {
      schemaPlayers.forEach((player: any, id: string) => {
        players.push({
          id,
          name: player.name,
          position: { x: player.x, y: player.y, z: player.z },
          yaw: player.yaw,
          pitch: player.pitch,
          health: player.health,
          alive: player.alive,
          downed: player.downed,
          grounded: player.grounded,
          inWater: player.inWater,
          reloading: player.reloading,
          shooting: player.shooting,
          team: player.team,
          classId: player.classId,
          ammo: player.ammo,
          maxAmmo: player.maxAmmo,
          weaponSlot: player.weaponSlot,
          weaponName: player.weaponName,
          suppression: player.suppression ?? 0,
          flash: player.flash ?? 0,
        })
      })
    }

    // Debug: log player count and IDs periodically
    if (players.length > 0 && (state.tick ?? 0) % 100 === 0) {
      console.log(`[Schema→State] tick=${state.tick} myId=${this._mySessionId} players=[${players.map(p => `${p.id}(${p.alive?'alive':'dead'} @${p.position.x.toFixed(1)},${p.position.y.toFixed(1)},${p.position.z.toFixed(1)})`).join(', ')}]`)
    }

    // Dispatch the synthesized state message
    this.handler({
      type: 'state',
      tick: state.tick ?? 0,
      players,
      ack: this._lastAck,
    })
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
