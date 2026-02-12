import useStore from '../stores/useStore'
import RemotePlayerEntity from './RemotePlayerEntity'

export default function RemotePlayers() {
  const remotePlayers = useStore((s) => s.remotePlayers)
  const entries = Array.from(remotePlayers.entries())

  return (
    <>
      {entries.map(([id, state]) => (
        <RemotePlayerEntity
          key={id}
          state={state}
          team={state.team}
        />
      ))}
    </>
  )
}
