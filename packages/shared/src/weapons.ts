/** Weapon identifiers */
export enum WeaponId {
  // Assault
  AssaultRifle = 'assault_rifle',
  SMG_Assault = 'smg_assault',
  // Medic
  SMG_Medic = 'smg_medic',
  Shotgun = 'shotgun',
  // Engineer
  Carbine = 'carbine',
  PDW = 'pdw',
  // Recon
  SniperRifle = 'sniper_rifle',
  DMR = 'dmr',
}

/** Weapon stats */
export interface WeaponStats {
  id: WeaponId;
  name: string;
  damage: number;
  maxRange: number;
  /** Range at which damage starts to fall off */
  falloffStart: number;
  /** Damage multiplier at max range (0-1) */
  falloffEnd: number;
  /** Rounds per minute */
  rpm: number;
  /** Magazine size */
  magSize: number;
  /** Reload time in seconds */
  reloadTime: number;
  /** Spread in radians (0 = perfectly accurate) */
  spread: number;
  /** Number of pellets per shot (1 for non-shotguns) */
  pellets: number;
  /** Projectile speed in m/s */
  projectileSpeed: number;
  /** Whether this is a primary weapon */
  primary: boolean;
  /** Recoil kickback in radians (pushes pitch up) */
  recoilKick: number;
  /** Random recoil deviation in radians (random yaw/pitch offset) */
  recoilRandom: number;
}

/** All weapon definitions */
export const WEAPONS: Record<WeaponId, WeaponStats> = {
  [WeaponId.AssaultRifle]: {
    id: WeaponId.AssaultRifle,
    name: 'Assault Rifle',
    damage: 25,
    maxRange: 60,
    falloffStart: 30,
    falloffEnd: 0.5,
    rpm: 600,
    magSize: 30,
    reloadTime: 2.2,
    spread: 0.015,
    pellets: 1,
    projectileSpeed: 120,
    primary: true,
    recoilKick: 0.015,
    recoilRandom: 0.005,
  },
  [WeaponId.SMG_Assault]: {
    id: WeaponId.SMG_Assault,
    name: 'SMG',
    damage: 20,
    maxRange: 30,
    falloffStart: 15,
    falloffEnd: 0.4,
    rpm: 800,
    magSize: 25,
    reloadTime: 1.8,
    spread: 0.025,
    pellets: 1,
    projectileSpeed: 100,
    primary: true,
    recoilKick: 0.01,
    recoilRandom: 0.008,
  },
  [WeaponId.SMG_Medic]: {
    id: WeaponId.SMG_Medic,
    name: 'Medic SMG',
    damage: 18,
    maxRange: 28,
    falloffStart: 14,
    falloffEnd: 0.4,
    rpm: 750,
    magSize: 30,
    reloadTime: 1.9,
    spread: 0.022,
    pellets: 1,
    projectileSpeed: 100,
    primary: true,
    recoilKick: 0.01,
    recoilRandom: 0.008,
  },
  [WeaponId.Shotgun]: {
    id: WeaponId.Shotgun,
    name: 'Shotgun',
    damage: 15,
    maxRange: 15,
    falloffStart: 5,
    falloffEnd: 0.2,
    rpm: 80,
    magSize: 6,
    reloadTime: 3.0,
    spread: 0.08,
    pellets: 8,
    projectileSpeed: 80,
    primary: true,
    recoilKick: 0.03,
    recoilRandom: 0.015,
  },
  [WeaponId.Carbine]: {
    id: WeaponId.Carbine,
    name: 'Carbine',
    damage: 28,
    maxRange: 50,
    falloffStart: 25,
    falloffEnd: 0.5,
    rpm: 500,
    magSize: 20,
    reloadTime: 2.0,
    spread: 0.012,
    pellets: 1,
    projectileSpeed: 110,
    primary: true,
    recoilKick: 0.015,
    recoilRandom: 0.005,
  },
  [WeaponId.PDW]: {
    id: WeaponId.PDW,
    name: 'PDW',
    damage: 19,
    maxRange: 25,
    falloffStart: 12,
    falloffEnd: 0.35,
    rpm: 900,
    magSize: 35,
    reloadTime: 2.0,
    spread: 0.03,
    pellets: 1,
    projectileSpeed: 95,
    primary: true,
    recoilKick: 0.01,
    recoilRandom: 0.008,
  },
  [WeaponId.SniperRifle]: {
    id: WeaponId.SniperRifle,
    name: 'Sniper Rifle',
    damage: 90,
    maxRange: 150,
    falloffStart: 100,
    falloffEnd: 0.7,
    rpm: 40,
    magSize: 5,
    reloadTime: 3.5,
    spread: 0.002,
    pellets: 1,
    projectileSpeed: 200,
    primary: true,
    recoilKick: 0.04,
    recoilRandom: 0.002,
  },
  [WeaponId.DMR]: {
    id: WeaponId.DMR,
    name: 'DMR',
    damage: 45,
    maxRange: 80,
    falloffStart: 40,
    falloffEnd: 0.6,
    rpm: 200,
    magSize: 10,
    reloadTime: 2.5,
    spread: 0.005,
    pellets: 1,
    projectileSpeed: 150,
    primary: true,
    recoilKick: 0.025,
    recoilRandom: 0.003,
  },
};

/** Calculate damage at a given distance */
export function calcDamage(weapon: WeaponStats, distance: number): number {
  if (distance > weapon.maxRange) return 0;
  if (distance <= weapon.falloffStart) return weapon.damage;

  const falloffRange = weapon.maxRange - weapon.falloffStart;
  const t = (distance - weapon.falloffStart) / falloffRange;
  const multiplier = 1 - t * (1 - weapon.falloffEnd);
  return Math.round(weapon.damage * multiplier);
}

/** Seconds between shots */
export function fireInterval(weapon: WeaponStats): number {
  return 60 / weapon.rpm;
}
