import { useEffect, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import { Smoke } from 'react-smoke'
import * as THREE from 'three'

import type { SmokeDeployEvent } from '@clawfield/shared'
import useStore from '../stores/useStore'

type ActiveSmokeCloud = {
  id: number
  event: SmokeDeployEvent
  expiresAt: number
}

const SMOKE_RENDERER_ENABLED = ((import.meta as any).env?.VITE_SMOKE_RENDERER ?? 'react-smoke') === 'react-smoke'

export default function SmokeClouds() {
  const [clouds, setClouds] = useState<ActiveSmokeCloud[]>([])
  const cloudsRef = useRef<ActiveSmokeCloud[]>([])
  const nextIdRef = useRef(1)
  const smokeColor = useRef(new THREE.Color('#c9ced3'))

  useEffect(() => {
    cloudsRef.current = clouds
  }, [clouds])

  useFrame(() => {
    if (!SMOKE_RENDERER_ENABLED) return

    const now = performance.now()
    const deploys = (useStore.getState() as any).consumeSmokeDeploys() as SmokeDeployEvent[]

    let next = cloudsRef.current
    let changed = false

    if (deploys.length > 0) {
      next = [...next]
      for (const deploy of deploys) {
        next.push({
          id: nextIdRef.current++,
          event: deploy,
          expiresAt: now + deploy.duration * 1000,
        })
      }
      changed = true
    }

    const alive = next.filter((cloud) => cloud.expiresAt > now)
    if (alive.length !== next.length) {
      next = alive
      changed = true
    }

    if (changed) {
      cloudsRef.current = next
      setClouds(next)
    }
  })

  if (!SMOKE_RENDERER_ENABLED) return null

  return (
    <>
      {clouds.map((cloud) => {
        const { event } = cloud
        const r = Math.max(1.5, event.radius)
        return (
          <group
            key={cloud.id}
            position={[event.position.x, event.position.y + 0.85, event.position.z]}
          >
            <Smoke
              color={smokeColor.current}
              opacity={0.2}
              density={68}
              size={[0.95, 0.95, 0.95]}
              minBounds={[-r, -0.6, -r]}
              maxBounds={[r, r * 1.8, r]}
              maxVelocity={[1.4, 0.75, 1.4]}
              velocityResetFactor={5}
              enableWind
              windDirection={[0.9, 0, 0.5]}
              windStrength={[0.04, 0.015, 0.04]}
              enableTurbulence
              turbulenceStrength={[0.025, 0.02, 0.025]}
              enableRotation
              rotation={[0, 0, 0.04]}
              enableFrustumCulling
            />
          </group>
        )
      })}
    </>
  )
}
