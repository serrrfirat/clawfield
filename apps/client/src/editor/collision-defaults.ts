import type { AssetEntry, EditorPlacement } from './editor-types'

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
