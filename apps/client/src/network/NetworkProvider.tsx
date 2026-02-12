import React, { createContext, useContext, useRef, useEffect } from 'react'
import { NetworkClient } from './network-client'
import useStore from '../stores/useStore'

const NetworkContext = createContext<NetworkClient | null>(null)

export function useNetwork(): NetworkClient | null {
  return useContext(NetworkContext)
}

export function NetworkProvider({ children }: { children: React.ReactNode }) {
  const handleServerMessage = useStore((s) => s.handleServerMessage)
  const clientRef = useRef<NetworkClient | null>(null)

  if (!clientRef.current) {
    clientRef.current = new NetworkClient(handleServerMessage)
  }

  useEffect(() => {
    const client = clientRef.current!
    // Auto-join on connect
    client.onConnected = () => {
      client.join('Player', 'tdm')
    }
    client.connect()
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
