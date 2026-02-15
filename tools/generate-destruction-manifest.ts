import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

type AssetCategory = 'structures' | 'vegetation' | 'props' | 'vehicles'

interface AssetEntry {
  id: string
  name: string
  category: AssetCategory
  path: string
  tags?: string[]
}

interface GeneratedSection {
  id: string
  profile: string
  notes: string
}

interface GeneratedDestructible {
  assetId: string
  assetPath: string
  defaultProfile: string
  autoSections: GeneratedSection[]
  reviewRequired: boolean
}

function inferProfile(entry: AssetEntry): string {
  const hay = `${entry.id} ${entry.name} ${(entry.tags ?? []).join(' ')}`.toLowerCase()
  if (hay.includes('rock') || hay.includes('stone') || hay.includes('boulder')) return 'stone-medium'
  if (hay.includes('tree') || hay.includes('pine') || hay.includes('birch') || hay.includes('maple')) return 'wood-tree'
  if (hay.includes('house') || hay.includes('building')) return 'structure-house'
  if (hay.includes('wall')) return 'structure-wall'
  return entry.category === 'structures' ? 'structure-wall' : 'prop-generic'
}

function buildSections(entry: AssetEntry, profile: string): GeneratedSection[] {
  if (entry.category !== 'structures') {
    return [{ id: 'root', profile, notes: 'Auto single-section fallback.' }]
  }

  return [
    { id: 'base', profile, notes: 'Ground/contact section. Confirm pass-through behavior.' },
    { id: 'mid', profile, notes: 'Middle structure mass.' },
    { id: 'top', profile, notes: 'Top section. Consider lower HP for dramatic collapse.' },
  ]
}

function main(): void {
  const rootDir = resolve(__dirname, '..')
  const catalogPath = resolve(rootDir, 'apps/client/src/editor/asset-catalog.json')
  const outPath = resolve(rootDir, 'assets/destruction/destructible-manifest.generated.json')
  const outClientPath = resolve(rootDir, 'apps/client/src/world/destruction/destructible-manifest.generated.json')

  const raw = readFileSync(catalogPath, 'utf8')
  const entries = JSON.parse(raw) as AssetEntry[]

  const generated: GeneratedDestructible[] = entries.map((entry) => {
    const defaultProfile = inferProfile(entry)
    return {
      assetId: entry.id,
      assetPath: entry.path,
      defaultProfile,
      autoSections: buildSections(entry, defaultProfile),
      reviewRequired: entry.category === 'structures' || defaultProfile === 'structure-house',
    }
  })

  const payload = {
    generatedAt: new Date().toISOString(),
    source: 'tools/generate-destruction-manifest.ts',
    count: generated.length,
    destructibles: generated,
  }

  mkdirSync(dirname(outPath), { recursive: true })
  mkdirSync(dirname(outClientPath), { recursive: true })
  writeFileSync(outPath, JSON.stringify(payload, null, 2) + '\n', 'utf8')
  writeFileSync(outClientPath, JSON.stringify(payload, null, 2) + '\n', 'utf8')
  console.log(`Wrote ${generated.length} destructible entries to ${outPath}`)
  console.log(`Wrote ${generated.length} destructible entries to ${outClientPath}`)
}

main()
