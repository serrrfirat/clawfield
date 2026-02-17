import { useMemo } from 'react'
import useEditorStore from './useEditorStore'
import type { CoverType } from '@clawfield/shared'

type CoverBand = 'full' | 'half' | 'none'

function inferCoverTypeFromAsset(assetId: string, tags: string[]): CoverType {
  const hay = `${assetId} ${tags.join(' ')}`.toLowerCase()
  if (hay.includes('bush') || hay.includes('hedge') || hay.includes('shrub') || hay.includes('fence')) return 'soft'
  if (hay.includes('wall') || hay.includes('sandbag') || hay.includes('barrier') || hay.includes('rock') || hay.includes('stone')) return 'half'
  return 'hard'
}

function toCoverBand(coverType: CoverType, h: number): CoverBand {
  if (coverType === 'soft') return 'none'
  if (coverType === 'half') return 'half'
  if (h >= 1.6) return 'full'
  if (h >= 0.95) return 'half'
  return 'none'
}

function colorForBand(band: CoverBand): string {
  if (band === 'full') return '#5be37a'
  if (band === 'half') return '#f6c847'
  return '#ff5f5f'
}

export default function EditorCoverVisualizer() {
  const showCoverVisualizer = useEditorStore((s) => s.showCoverVisualizer)
  const placements = useEditorStore((s) => s.placements)
  const assets = useEditorStore((s) => s.assets)

  const entries = useMemo(() => {
    return placements.map((p) => {
      const asset = assets.find((a) => a.id === p.assetId)
      const sx = Math.abs(p.scale[0] ?? 1)
      const sy = Math.abs(p.scale[1] ?? 1)
      const sz = Math.abs(p.scale[2] ?? 1)

      const colliderScale = Number(p.metadata?.colliderScale ?? asset?.colliderScale ?? 0.5)
      const radius = Math.max(0.22, Math.max(sx, sz) * Math.max(0.25, colliderScale) * 0.95)

      const metaCoverHeight = Number(p.metadata?.coverHeight)
      const h = Number.isFinite(metaCoverHeight)
        ? Math.max(0.35, metaCoverHeight)
        : Math.max(0.35, sy * (asset?.category === 'structures' ? 1.8 : asset?.category === 'vegetation' ? 1.2 : 1.0))

      const coverType = (p.metadata?.coverType as CoverType | undefined)
        ?? inferCoverTypeFromAsset(p.assetId, asset?.tags ?? [])

      const band = toCoverBand(coverType, h)

      return {
        id: p.id,
        x: p.position[0],
        y: p.position[1],
        z: p.position[2],
        radius,
        h,
        band,
      }
    })
  }, [placements, assets])

  if (!showCoverVisualizer) return null

  return (
    <group renderOrder={850}>
      {entries.map((entry) => (
        <group key={entry.id} position={[entry.x, entry.y, entry.z]}>
          <mesh position={[0, entry.h * 0.5, 0]} scale={[entry.radius, entry.h, entry.radius]}>
            <cylinderGeometry args={[1, 1, 1, 14, 1, true]} />
            <meshBasicMaterial
              color={colorForBand(entry.band)}
              wireframe
              transparent
              opacity={0.68}
              depthWrite={false}
              toneMapped={false}
            />
          </mesh>
          <mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]} scale={[entry.radius * 1.8, entry.radius * 1.8, 1]}>
            <ringGeometry args={[0.72, 1, 18]} />
            <meshBasicMaterial
              color={colorForBand(entry.band)}
              transparent
              opacity={0.22}
              depthWrite={false}
              toneMapped={false}
            />
          </mesh>
        </group>
      ))}
    </group>
  )
}
