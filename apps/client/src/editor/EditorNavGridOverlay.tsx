import { useMemo } from 'react'
import { buildPlacementColliders, type PlacementLike } from '@clawfield/shared'
import useEditorStore from './useEditorStore'
import { getTerrainHeight } from './EditorTerrain'

interface Cell {
  key: string
  x: number
  y: number
  z: number
  walkable: boolean
}

export default function EditorNavGridOverlay() {
  const showNavGrid = useEditorStore((s) => s.showNavGrid)
  const navGridCellSize = useEditorStore((s) => s.navGridCellSize)
  const navGridRadius = useEditorStore((s) => s.navGridRadius)
  const [cx, , cz] = useEditorStore((s) => s.cameraTarget)
  const placements = useEditorStore((s) => s.placements)

  const colliders = useMemo(() => {
    const placementLike: PlacementLike[] = placements.map((p) => ({
      componentId: p.assetId,
      position: p.position,
      scale: p.scale,
      metadata: p.metadata,
    }))
    return buildPlacementColliders(placementLike)
  }, [placements])

  const cells = useMemo<Cell[]>(() => {
    if (!showNavGrid) return []

    const cell = Math.max(0.5, navGridCellSize)
    const radius = Math.max(6, navGridRadius)
    const centerX = Math.round(cx / cell) * cell
    const centerZ = Math.round(cz / cell) * cell

    const out: Cell[] = []
    for (let ix = -radius; ix <= radius; ix++) {
      for (let iz = -radius; iz <= radius; iz++) {
        const x = centerX + ix * cell
        const z = centerZ + iz * cell
        const y = getTerrainHeight(x, z)

        const hx = Math.abs(getTerrainHeight(x + cell * 0.45, z) - y)
        const hz = Math.abs(getTerrainHeight(x, z + cell * 0.45) - y)
        const slope = Math.max(hx, hz) / Math.max(0.01, cell * 0.45)

        let blocked = false
        for (const c of colliders) {
          const dx = x - c.x
          const dz = z - c.z
          const rr = c.r + cell * 0.33
          if (dx * dx + dz * dz <= rr * rr) {
            blocked = true
            break
          }
        }

        const walkable = !blocked && slope <= 0.85
        out.push({
          key: `${ix},${iz}`,
          x,
          y: y + 0.025,
          z,
          walkable,
        })
      }
    }

    return out
  }, [showNavGrid, navGridCellSize, navGridRadius, cx, cz, colliders])

  if (!showNavGrid || cells.length === 0) return null

  const cellSize = Math.max(0.5, navGridCellSize)

  return (
    <group renderOrder={840}>
      {cells.map((cell) => (
        <mesh key={cell.key} position={[cell.x, cell.y, cell.z]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[cellSize * 0.92, cellSize * 0.92]} />
          <meshBasicMaterial
            color={cell.walkable ? '#4fd48a' : '#f75e5e'}
            transparent
            opacity={cell.walkable ? 0.16 : 0.22}
            depthWrite={false}
            toneMapped={false}
          />
        </mesh>
      ))}
    </group>
  )
}
