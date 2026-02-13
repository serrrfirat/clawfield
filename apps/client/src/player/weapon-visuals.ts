import { WeaponId } from '@clawfield/shared'

export type WeaponVisualType =
  | 'assault_rifle'
  | 'smg'
  | 'shotgun'
  | 'carbine'
  | 'pdw'
  | 'sniper'
  | 'dmr'
  | 'pistol'
  | 'rocket_launcher'
  | 'frag_grenade'
  | 'smoke_grenade'

export interface WeaponVisualDef {
  type: WeaponVisualType
  path: string
  scale: number
  position: [number, number, number]
  rotation: [number, number, number]
}

const DEFAULT_HAND_WEAPON: WeaponVisualDef = {
  type: 'assault_rifle',
  path: '/models/weapons/assault_rifle.glb',
  scale: 0.138334,
  position: [-1.076019, -0.039139, -0.09],
  rotation: [0, -Math.PI * 0.5, 0],
}

const WEAPON_VISUALS_BY_ID: Partial<Record<WeaponId, WeaponVisualDef>> = {
  [WeaponId.AssaultRifle]: DEFAULT_HAND_WEAPON,
  [WeaponId.SMG_Assault]: {
    type: 'smg',
    path: '/models/weapons/smg_assault.glb',
    scale: 0.1,
    position: [0.03, 0.02, -0.08],
    rotation: [0, -Math.PI * 0.5, 0],
  },
  [WeaponId.SMG_Medic]: {
    type: 'smg',
    path: '/models/weapons/smg_medic.glb',
    scale: 0.1,
    position: [0.03, 0.02, -0.08],
    rotation: [0, -Math.PI * 0.5, 0],
  },
  [WeaponId.Shotgun]: {
    type: 'shotgun',
    path: '/models/weapons/shotgun.glb',
    scale: 0.1,
    position: [0.03, 0.02, -0.09],
    rotation: [0, -Math.PI * 0.5, 0],
  },
  [WeaponId.Carbine]: {
    type: 'carbine',
    path: '/models/weapons/carbine.glb',
    scale: 0.1,
    position: [0.03, 0.02, -0.09],
    rotation: [0, -Math.PI * 0.5, 0],
  },
  [WeaponId.PDW]: {
    type: 'pdw',
    path: '/models/weapons/pdw.glb',
    scale: 0.1,
    position: [0.03, 0.02, -0.08],
    rotation: [0, -Math.PI * 0.5, 0],
  },
  [WeaponId.SniperRifle]: {
    type: 'sniper',
    path: '/models/weapons/sniper_rifle.glb',
    scale: 0.1,
    position: [0.03, 0.02, -0.1],
    rotation: [0, -Math.PI * 0.5, 0],
  },
  [WeaponId.DMR]: {
    type: 'dmr',
    path: '/models/weapons/dmr.glb',
    scale: 0.1,
    position: [0.03, 0.02, -0.09],
    rotation: [0, -Math.PI * 0.5, 0],
  },
  [WeaponId.Pistol]: {
    type: 'pistol',
    path: '/models/weapons/pistol.glb',
    scale: 0.11,
    position: [0.04, 0.01, -0.03],
    rotation: [0, -Math.PI * 0.5, 0],
  },
  [WeaponId.RocketLauncher]: {
    type: 'rocket_launcher',
    path: '/models/weapons/assault_rifle.glb',
    scale: 0.115,
    position: [0.04, 0.02, -0.1],
    rotation: [0, -Math.PI * 0.5, 0],
  },
}

const WEAPON_NAME_TO_ID: Record<string, WeaponId> = {
  rifle: WeaponId.AssaultRifle,
  'assault rifle': WeaponId.AssaultRifle,
  smg: WeaponId.SMG_Assault,
  'medic smg': WeaponId.SMG_Medic,
  shotgun: WeaponId.Shotgun,
  carbine: WeaponId.Carbine,
  pdw: WeaponId.PDW,
  'sniper rifle': WeaponId.SniperRifle,
  dmr: WeaponId.DMR,
  pistol: WeaponId.Pistol,
  'rocket launcher': WeaponId.RocketLauncher,
}

export const FRAG_GRENADE_VISUAL: WeaponVisualDef = {
  type: 'frag_grenade',
  path: '/models/weapons/frag_grenade.glb',
  scale: 0.07,
  position: [0, 0, 0],
  rotation: [0, 0, 0],
}

export const SMOKE_GRENADE_VISUAL: WeaponVisualDef = {
  type: 'smoke_grenade',
  path: '/models/weapons/smoke_grenade.glb',
  scale: 0.09,
  position: [0, 0, 0],
  rotation: [0, 0, 0],
}

export const ALL_WEAPON_MODEL_PATHS = Array.from(
  new Set(Object.values(WEAPON_VISUALS_BY_ID).map((def) => def?.path).filter((path): path is string => Boolean(path))),
)

export function getWeaponVisualForName(weaponName?: string): WeaponVisualDef {
  if (!weaponName) return DEFAULT_HAND_WEAPON
  const normalized = weaponName.trim().toLowerCase()
  const id = WEAPON_NAME_TO_ID[normalized]
  if (!id) return DEFAULT_HAND_WEAPON
  return WEAPON_VISUALS_BY_ID[id] ?? DEFAULT_HAND_WEAPON
}
