import { useMemo } from 'react'
import { useGLTF } from '@react-three/drei'
import { SkeletonUtils } from 'three-stdlib'
import useStore from '../stores/useStore'
import assetCatalog from '../editor/asset-catalog.json'
import type { MapdefPlacement } from '../editor/editor-types'

function PlacedAsset({ placement }: { placement: MapdefPlacement }) {
    const entry = assetCatalog.find((a) => a.id === placement.componentId)
    if (!entry) return null
    return <PlacedGLB path={entry.path} placement={placement} />
}

function PlacedGLB({ path, placement }: { path: string; placement: MapdefPlacement }) {
    const { scene } = useGLTF(path)
    const cloned = useMemo(() => SkeletonUtils.clone(scene), [scene])

    return (
        <group
            position={placement.position}
            rotation={placement.rotation}
            scale={placement.scale}
        >
            <primitive object={cloned} />
        </group>
    )
}

export default function MapPlacements() {
    const placements = useStore((s) => s.mapPlacements)

    if (!placements.length) return null

    return (
        <>
            {placements.map((p, i) => (
                <PlacedAsset key={`${p.componentId}-${i}`} placement={p} />
            ))}
        </>
    )
}
