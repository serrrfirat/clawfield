import { useEffect } from 'react'
import { useRapier } from '@react-three/rapier'
import { placementDestructionView } from './placement-destruction-view'

export default function DestructionPhysicsBridge() {
  const { world, rapier } = useRapier()

  useEffect(() => {
    placementDestructionView.setPhysicsWorld(world, rapier)
    return () => {
      placementDestructionView.setPhysicsWorld(null, null)
    }
  }, [world, rapier])

  return null
}
