import manifest from './destructible-manifest.generated.json'

interface ManifestEntry {
  assetId: string
  defaultProfile: string
  autoSections: { id: string; profile: string }[]
}

const entries = ((manifest as any)?.destructibles ?? []) as ManifestEntry[]

const byAssetId = new Map<string, ManifestEntry>()
for (const entry of entries) {
  byAssetId.set(entry.assetId, entry)
}

export function getManifestProfile(assetId: string): string | undefined {
  return byAssetId.get(assetId)?.defaultProfile
}

export function getManifestSectionCount(assetId: string): number | undefined {
  const sections = byAssetId.get(assetId)?.autoSections
  if (!sections || sections.length <= 1) return undefined
  return sections.length
}
