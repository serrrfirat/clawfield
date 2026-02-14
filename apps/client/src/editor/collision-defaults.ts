import type { AssetEntry, EditorPlacement, ColliderType } from './editor-types'

const SOFT_VEGETATION_KEYWORDS = [
  'flower',
  'bush',
  'grass',
  'fern',
  'plant',
  'mushroom',
  'lavender',
  'sunflower',
  'decorative',
  'ground-cover',
]

export function getDefaultCollidableForAsset(asset: AssetEntry | undefined): boolean {
  if (!asset) return true
  if (typeof asset.collidable === 'boolean') return asset.collidable

  const id = asset.id.toLowerCase()
  const name = asset.name.toLowerCase()
  const tags = (asset.tags ?? []).map((t) => t.toLowerCase())

  if (asset.category !== 'vegetation') return true

  const haystack = `${id} ${name} ${tags.join(' ')}`
  for (const kw of SOFT_VEGETATION_KEYWORDS) {
    if (haystack.includes(kw)) return false
  }

  return true
}

export function getPlacementCollidable(placement: EditorPlacement, asset: AssetEntry | undefined): boolean {
  const explicit = placement.metadata?.collidable
  if (typeof explicit === 'boolean') return explicit
  return getDefaultCollidableForAsset(asset)
}

export function getDefaultSuppressGrassForAsset(asset: AssetEntry | undefined): boolean {
  if (!asset) return false

  if (asset.category === 'structures' || asset.category === 'props' || asset.category === 'vehicles') {
    return true
  }

  // Vegetation: only larger, collidable vegetation should clear grass by default
  return getDefaultCollidableForAsset(asset)
}

export function getPlacementSuppressGrass(placement: EditorPlacement, asset: AssetEntry | undefined): boolean {
  const explicit = placement.metadata?.suppressGrass
  if (typeof explicit === 'boolean') return explicit
  return getDefaultSuppressGrassForAsset(asset)
}

export function getDefaultGrassSuppressRadius(asset: AssetEntry | undefined, scale: [number, number, number] | undefined): number {
  const s = scale ?? [1, 1, 1]
  const base = Math.max(0.5, Math.max(s[0], s[2]))
  if (!asset) return base * 2.2

  if (asset.category === 'structures') return base * 4.5
  if (asset.category === 'vehicles') return base * 2.8
  if (asset.category === 'props') return base * 2.0
  return base * 1.2
}

export function getPlacementGrassSuppressRadius(placement: EditorPlacement, asset: AssetEntry | undefined): number {
  const explicit = placement.metadata?.grassSuppressRadius
  if (typeof explicit === 'number' && Number.isFinite(explicit)) {
    return Math.max(0.2, explicit)
  }
  return getDefaultGrassSuppressRadius(asset, placement.scale)
}

export function getDefaultColliderType(asset: AssetEntry | undefined): ColliderType {
  if (!asset) return 'cuboid'
  if (asset.colliderType) return asset.colliderType

  if (asset.category === 'structures') return 'trimesh'

  if (asset.category === 'vegetation') {
    return getDefaultCollidableForAsset(asset) ? 'cuboid' : 'none'
  }

  return 'cuboid'
}

export function getPlacementColliderType(placement: EditorPlacement, asset: AssetEntry | undefined): ColliderType {
  const collidable = getPlacementCollidable(placement, asset)
  if (!collidable) return 'none'

  const explicit = placement.metadata?.colliderType
  if (explicit === 'none' || explicit === 'cuboid' || explicit === 'trimesh') {
    return explicit
  }

  return getDefaultColliderType(asset)
}

export function getDefaultColliderScale(asset: AssetEntry | undefined): number {
  if (!asset) return 0.5
  if (typeof asset.colliderScale === 'number') return asset.colliderScale
  if (asset.category === 'structures') return 0.5
  if (asset.category === 'vehicles') return 0.45
  if (asset.category === 'props') return 0.42
  return 0.35
}
