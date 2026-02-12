import useEditorStore from './useEditorStore'
import PlacedObject from './PlacedObject'

export default function PlacedObjectsLayer() {
  const placements = useEditorStore((s) => s.placements)
  const selectedId = useEditorStore((s) => s.selectedPlacementId)

  return (
    <group>
      {placements.map((p) => (
        <PlacedObject key={p.id} placement={p} selected={p.id === selectedId} />
      ))}
    </group>
  )
}
