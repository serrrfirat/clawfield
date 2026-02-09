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

  // --- Handling / weapon feel ---

  /** ADS (aim-down-sight) transition speed multiplier (higher = faster). Default ~1.0 */
  adsSpeed: number;
  /** Spread multiplier while aiming down sights (lower = tighter). 0-1 */
  adsSpreadMultiplier: number;
  /** Movement speed multiplier while holding this weapon (1.0 = no penalty) */
  moveSpeedMultiplier: number;
  /** Weapon swap/draw time in seconds */
  swapTime: number;
  /** Aim sway amplitude in radians (idle weapon drift when scoped/ADS) */
  aimSway: number;
  /** View bob intensity multiplier while walking (higher = more bounce) */
  bobIntensity: number;
  /** Recoil recovery speed — how fast crosshair returns to center (rad/s) */
  recoilRecovery: number;
  /** Spread increase per shot (bloom). Radians added per bullet fired */
  spreadBloom: number;
  /** Spread recovery rate (rad/s) — how fast bloom settles back to base spread */
  spreadRecovery: number;
  /** Sprint-to-fire delay in seconds (time after releasing sprint before firing) */
  sprintToFireTime: number;
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
    rpm: 650,
    magSize: 30,
    reloadTime: 2.2,
    spread: 0.012,
    pellets: 1,
    projectileSpeed: 120,
    primary: true,
    // BattleBit-style: noticeable but controllable recoil
    recoilKick: 0.022,
    recoilRandom: 0.004,
    adsSpeed: 1.0,
    adsSpreadMultiplier: 0.3,
    moveSpeedMultiplier: 0.92,
    swapTime: 0.6,
    aimSway: 0.002,
    bobIntensity: 1.0,
    recoilRecovery: 5.0,
    spreadBloom: 0.004,
    spreadRecovery: 7.0,
    sprintToFireTime: 0.2,
  },
  [WeaponId.SMG_Assault]: {
    id: WeaponId.SMG_Assault,
    name: 'SMG',
    damage: 20,
    maxRange: 30,
    falloffStart: 15,
    falloffEnd: 0.4,
    rpm: 850,
    magSize: 25,
    reloadTime: 1.8,
    spread: 0.02,
    pellets: 1,
    projectileSpeed: 100,
    primary: true,
    // Fast-firing, lower per-shot recoil but higher random
    recoilKick: 0.014,
    recoilRandom: 0.007,
    adsSpeed: 1.4,
    adsSpreadMultiplier: 0.45,
    moveSpeedMultiplier: 0.97,
    swapTime: 0.4,
    aimSway: 0.001,
    bobIntensity: 0.8,
    recoilRecovery: 7.0,
    spreadBloom: 0.005,
    spreadRecovery: 9.0,
    sprintToFireTime: 0.12,
  },
  [WeaponId.SMG_Medic]: {
    id: WeaponId.SMG_Medic,
    name: 'Medic SMG',
    damage: 18,
    maxRange: 28,
    falloffStart: 14,
    falloffEnd: 0.4,
    rpm: 780,
    magSize: 30,
    reloadTime: 1.9,
    spread: 0.018,
    pellets: 1,
    projectileSpeed: 100,
    primary: true,
    // Controllable support weapon — steady recoil, fast recovery
    recoilKick: 0.013,
    recoilRandom: 0.006,
    adsSpeed: 1.3,
    adsSpreadMultiplier: 0.4,
    moveSpeedMultiplier: 0.96,
    swapTime: 0.45,
    aimSway: 0.001,
    bobIntensity: 0.85,
    recoilRecovery: 6.5,
    spreadBloom: 0.004,
    spreadRecovery: 8.0,
    sprintToFireTime: 0.14,
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
    // Massive kick — you FEEL each pump shot
    recoilKick: 0.045,
    recoilRandom: 0.012,
    adsSpeed: 0.8,
    adsSpreadMultiplier: 0.7,
    moveSpeedMultiplier: 0.90,
    swapTime: 0.65,
    aimSway: 0.003,
    bobIntensity: 1.3,
    recoilRecovery: 2.5,
    spreadBloom: 0.0,
    spreadRecovery: 0.0,
    sprintToFireTime: 0.25,
  },
  [WeaponId.Carbine]: {
    id: WeaponId.Carbine,
    name: 'Carbine',
    damage: 28,
    maxRange: 50,
    falloffStart: 25,
    falloffEnd: 0.5,
    rpm: 520,
    magSize: 20,
    reloadTime: 2.0,
    spread: 0.01,
    pellets: 1,
    projectileSpeed: 110,
    primary: true,
    // Precise mid-range — moderate kick, tight grouping
    recoilKick: 0.02,
    recoilRandom: 0.004,
    adsSpeed: 1.1,
    adsSpreadMultiplier: 0.3,
    moveSpeedMultiplier: 0.93,
    swapTime: 0.55,
    aimSway: 0.0025,
    bobIntensity: 0.95,
    recoilRecovery: 5.5,
    spreadBloom: 0.003,
    spreadRecovery: 6.0,
    sprintToFireTime: 0.18,
  },
  [WeaponId.PDW]: {
    id: WeaponId.PDW,
    name: 'PDW',
    damage: 19,
    maxRange: 25,
    falloffStart: 12,
    falloffEnd: 0.35,
    rpm: 950,
    magSize: 35,
    reloadTime: 2.0,
    spread: 0.025,
    pellets: 1,
    projectileSpeed: 95,
    primary: true,
    // Bullet hose — fast, jittery, hard to control at range
    recoilKick: 0.012,
    recoilRandom: 0.009,
    adsSpeed: 1.5,
    adsSpreadMultiplier: 0.5,
    moveSpeedMultiplier: 0.98,
    swapTime: 0.35,
    aimSway: 0.001,
    bobIntensity: 0.7,
    recoilRecovery: 8.0,
    spreadBloom: 0.006,
    spreadRecovery: 10.0,
    sprintToFireTime: 0.1,
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
    spread: 0.001,
    pellets: 1,
    projectileSpeed: 200,
    primary: true,
    // Heavy bolt-action — huge single-shot kick, very slow recovery
    recoilKick: 0.055,
    recoilRandom: 0.003,
    adsSpeed: 0.6,
    adsSpreadMultiplier: 0.08,
    moveSpeedMultiplier: 0.85,
    swapTime: 0.8,
    aimSway: 0.005,
    bobIntensity: 1.4,
    recoilRecovery: 1.8,
    spreadBloom: 0.0,
    spreadRecovery: 0.0,
    sprintToFireTime: 0.35,
  },
  [WeaponId.DMR]: {
    id: WeaponId.DMR,
    name: 'DMR',
    damage: 45,
    maxRange: 80,
    falloffStart: 40,
    falloffEnd: 0.6,
    rpm: 220,
    magSize: 10,
    reloadTime: 2.5,
    spread: 0.004,
    pellets: 1,
    projectileSpeed: 150,
    primary: true,
    // Semi-auto precision — strong per-shot kick, decent recovery
    recoilKick: 0.032,
    recoilRandom: 0.004,
    adsSpeed: 0.85,
    adsSpreadMultiplier: 0.15,
    moveSpeedMultiplier: 0.88,
    swapTime: 0.7,
    aimSway: 0.004,
    bobIntensity: 1.2,
    recoilRecovery: 3.5,
    spreadBloom: 0.0,
    spreadRecovery: 0.0,
    sprintToFireTime: 0.28,
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
