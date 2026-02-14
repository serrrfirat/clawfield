import React, { createContext, useContext, useRef, useEffect } from 'react'
import { NetworkClient } from './network-client'
import { ColyseusNetworkClient } from './colyseus-network-client'
import useStore from '../stores/useStore'
import type { MatchConfig, PlacementCollider } from '@clawfield/shared'

type TransportClient = {
  connect: () => void | Promise<void>
  disconnect: () => void
  join: (name: string, gameMode: 'tdm' | 'conquest' | 'incursion') => void
  createRoom?: (name: string, gameMode?: 'tdm' | 'conquest' | 'incursion') => Promise<void>
  joinRoom?: (name: string, roomCode: string) => Promise<void>
  startGame?: () => void
  setLobbyTeam?: (team: number) => void
  setLobbyMode?: (gameMode: 'tdm' | 'conquest' | 'incursion') => void
  setLobbyMap?: (mapName: string) => void
  setLobbySeed?: (seed: number) => void
  setLobbyMatchConfig?: (matchConfig: MatchConfig) => void
  setLobbyPlacementColliders?: (colliders: PlacementCollider[]) => void
  returnToMenu?: () => void
  send: (msg: any) => void
  onConnected: (() => void) | null
}

const NetworkContext = createContext<TransportClient | null>(null)

const NETCODE_BACKEND = (import.meta.env.VITE_NETCODE_BACKEND ?? 'colyseus').toLowerCase()

export function useNetwork(): TransportClient | null {
  return useContext(NetworkContext)
}

export function NetworkProvider({ children }: { children: React.ReactNode }) {
  const handleServerMessage = useStore((s) => s.handleServerMessage)
  const clientRef = useRef<TransportClient | null>(null)

  if (!clientRef.current) {
    clientRef.current = NETCODE_BACKEND === 'colyseus'
      ? new ColyseusNetworkClient(handleServerMessage)
      : new NetworkClient(handleServerMessage)
  }

  useEffect(() => {
    const client = clientRef.current!
    // No implicit matchmaking join on connection.
    // Loader UI actions (quick play / create room / join room) drive room flow.
    client.onConnected = () => {}
    void client.connect()

    return () => {
      client.disconnect()
    }
  }, [])

  // Auto-deploy when connected (welcome received)
  useEffect(() => {
    const unsub = useStore.subscribe(
      (s: any) => s.connected,
      (connected: boolean) => {
        if (connected) {
          clientRef.current?.send({ type: 'deploy', classId: 'assault', weaponId: 'rifle', spawnPointId: 'base' })
        }
      }
    )
    return unsub
  }, [])

  return (
    <NetworkContext.Provider value={clientRef.current}>
      {children}
    </NetworkContext.Provider>
  )
}
