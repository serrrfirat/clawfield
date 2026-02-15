export interface DestructionProfile {
  id: string
  fragmentMin: number
  fragmentMax: number
  fragmentScale: number
  impactRadiusMul: number
}

const PROFILES: Record<string, DestructionProfile> = {
  'stone-small': { id: 'stone-small', fragmentMin: 8, fragmentMax: 22, fragmentScale: 9, impactRadiusMul: 0.7 },
  'stone-medium': { id: 'stone-medium', fragmentMin: 12, fragmentMax: 34, fragmentScale: 11, impactRadiusMul: 0.85 },
  'wood-tree': { id: 'wood-tree', fragmentMin: 10, fragmentMax: 28, fragmentScale: 10, impactRadiusMul: 0.8 },
  'prop-generic': { id: 'prop-generic', fragmentMin: 8, fragmentMax: 26, fragmentScale: 10, impactRadiusMul: 0.75 },
  'structure-wall': { id: 'structure-wall', fragmentMin: 10, fragmentMax: 24, fragmentScale: 9, impactRadiusMul: 0.8 },
  'structure-house': { id: 'structure-house', fragmentMin: 14, fragmentMax: 30, fragmentScale: 10, impactRadiusMul: 0.9 },
  'terrain-static': { id: 'terrain-static', fragmentMin: 0, fragmentMax: 0, fragmentScale: 0, impactRadiusMul: 0.75 },
}

const DEFAULT_PROFILE: DestructionProfile = {
  id: 'prop-generic',
  fragmentMin: 8,
  fragmentMax: 28,
  fragmentScale: 10,
  impactRadiusMul: 0.75,
}

export function getDestructionProfile(profileId?: string): DestructionProfile {
  if (!profileId) return DEFAULT_PROFILE
  return PROFILES[profileId] ?? DEFAULT_PROFILE
}

export function inferDestructionProfileFromComponentId(componentId: string): string {
  const id = componentId.toLowerCase()
  if (id.includes('rock') || id.includes('stone') || id.includes('boulder')) return 'stone-medium'
  if (id.includes('tree') || id.includes('pine') || id.includes('birch') || id.includes('maple')) return 'wood-tree'
  if (id.includes('house') || id.includes('building')) return 'structure-house'
  if (id.includes('wall')) return 'structure-wall'
  return 'prop-generic'
}
