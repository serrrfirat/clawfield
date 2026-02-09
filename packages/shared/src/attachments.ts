import type { WeaponStats } from './weapons.js';
import { WeaponId } from './weapons.js';

// ── Attachment slot types ──────────────────────────────────────────

export enum AttachmentSlot {
  Sight = 'sight',
  Barrel = 'barrel',
  Grip = 'grip',
  Magazine = 'magazine',
}

// ── Attachment identifiers ─────────────────────────────────────────

export enum AttachmentId {
  // Sights
  RedDot = 'red_dot',
  Holographic = 'holographic',
  Acog4x = 'acog_4x',
  Scope8x = 'scope_8x',
  // Barrels
  Suppressor = 'suppressor',
  Compensator = 'compensator',
  FlashHider = 'flash_hider',
  HeavyBarrel = 'heavy_barrel',
  // Grips
  VerticalGrip = 'vertical_grip',
  AngledGrip = 'angled_grip',
  StubbyGrip = 'stubby_grip',
  // Magazines
  ExtendedMag = 'extended_mag',
  QuickDrawMag = 'quick_draw_mag',
}

// ── Stat modifier definition ───────────────────────────────────────

/**
 * Stat modifiers applied by an attachment.
 * Additive values are added to the base stat.
 * Multiplicative values multiply the base stat.
 * Only include fields that the attachment actually changes.
 */
export interface AttachmentModifiers {
  // Multiplicative modifiers (applied as base * modifier)
  spreadMultiplier?: number;
  recoilKickMultiplier?: number;
  recoilRandomMultiplier?: number;
  adsSpeedMultiplier?: number;
  adsSpreadMultiplier?: number;
  moveSpeedMultiplier?: number;
  spreadBloomMultiplier?: number;
  spreadRecoveryMultiplier?: number;
  recoilRecoveryMultiplier?: number;
  projectileSpeedMultiplier?: number;
  // Additive modifiers (applied as base + modifier)
  magSizeAdd?: number;
  reloadTimeAdd?: number;
  damageAdd?: number;
  swapTimeAdd?: number;
  aimSwayAdd?: number;
  maxRangeAdd?: number;
  falloffStartAdd?: number;
}

// ── Attachment definition ──────────────────────────────────────────

export interface AttachmentDef {
  id: AttachmentId;
  name: string;
  slot: AttachmentSlot;
  /** Short description shown in loadout UI */
  description: string;
  /** Stat modifiers this attachment applies */
  modifiers: AttachmentModifiers;
}

// ── All attachment definitions ─────────────────────────────────────

export const ATTACHMENTS: Record<AttachmentId, AttachmentDef> = {
  // ── Sights ───────────────────────────────────────────────────────

  [AttachmentId.RedDot]: {
    id: AttachmentId.RedDot,
    name: 'Red Dot Sight',
    slot: AttachmentSlot.Sight,
    description: 'Faster ADS, cleaner sight picture',
    modifiers: {
      adsSpeedMultiplier: 1.1,
      adsSpreadMultiplier: 0.85,
    },
  },
  [AttachmentId.Holographic]: {
    id: AttachmentId.Holographic,
    name: 'Holographic Sight',
    slot: AttachmentSlot.Sight,
    description: 'Wide sight picture, slight ADS penalty',
    modifiers: {
      adsSpeedMultiplier: 0.95,
      adsSpreadMultiplier: 0.8,
      aimSwayAdd: -0.0005,
    },
  },
  [AttachmentId.Acog4x]: {
    id: AttachmentId.Acog4x,
    name: '4x ACOG',
    slot: AttachmentSlot.Sight,
    description: 'Medium zoom optic, slower ADS',
    modifiers: {
      adsSpeedMultiplier: 0.8,
      adsSpreadMultiplier: 0.5,
      aimSwayAdd: 0.001,
    },
  },
  [AttachmentId.Scope8x]: {
    id: AttachmentId.Scope8x,
    name: '8x Scope',
    slot: AttachmentSlot.Sight,
    description: 'Long-range optic, heavy ADS penalty',
    modifiers: {
      adsSpeedMultiplier: 0.6,
      adsSpreadMultiplier: 0.2,
      aimSwayAdd: 0.003,
      moveSpeedMultiplier: 0.95,
    },
  },

  // ── Barrels ──────────────────────────────────────────────────────

  [AttachmentId.Suppressor]: {
    id: AttachmentId.Suppressor,
    name: 'Suppressor',
    slot: AttachmentSlot.Barrel,
    description: 'Hides muzzle flash, reduces range',
    modifiers: {
      maxRangeAdd: -10,
      falloffStartAdd: -5,
      projectileSpeedMultiplier: 0.9,
      adsSpeedMultiplier: 0.95,
      recoilKickMultiplier: 0.9,
    },
  },
  [AttachmentId.Compensator]: {
    id: AttachmentId.Compensator,
    name: 'Compensator',
    slot: AttachmentSlot.Barrel,
    description: 'Reduces vertical recoil, increases hipfire spread',
    modifiers: {
      recoilKickMultiplier: 0.7,
      spreadMultiplier: 1.1,
      recoilRandomMultiplier: 0.85,
    },
  },
  [AttachmentId.FlashHider]: {
    id: AttachmentId.FlashHider,
    name: 'Flash Hider',
    slot: AttachmentSlot.Barrel,
    description: 'Hides muzzle flash, reduces random recoil',
    modifiers: {
      recoilRandomMultiplier: 0.75,
    },
  },
  [AttachmentId.HeavyBarrel]: {
    id: AttachmentId.HeavyBarrel,
    name: 'Heavy Barrel',
    slot: AttachmentSlot.Barrel,
    description: 'Tighter spread and more range, adds recoil',
    modifiers: {
      spreadMultiplier: 0.8,
      maxRangeAdd: 8,
      falloffStartAdd: 4,
      recoilKickMultiplier: 1.15,
      adsSpeedMultiplier: 0.92,
      moveSpeedMultiplier: 0.97,
    },
  },

  // ── Grips ────────────────────────────────────────────────────────

  [AttachmentId.VerticalGrip]: {
    id: AttachmentId.VerticalGrip,
    name: 'Vertical Grip',
    slot: AttachmentSlot.Grip,
    description: 'Reduces recoil, slightly slower ADS',
    modifiers: {
      recoilKickMultiplier: 0.8,
      recoilRandomMultiplier: 0.8,
      adsSpeedMultiplier: 0.93,
    },
  },
  [AttachmentId.AngledGrip]: {
    id: AttachmentId.AngledGrip,
    name: 'Angled Grip',
    slot: AttachmentSlot.Grip,
    description: 'Faster ADS, less recoil recovery',
    modifiers: {
      adsSpeedMultiplier: 1.15,
      recoilRecoveryMultiplier: 0.85,
    },
  },
  [AttachmentId.StubbyGrip]: {
    id: AttachmentId.StubbyGrip,
    name: 'Stubby Grip',
    slot: AttachmentSlot.Grip,
    description: 'Reduces spread bloom while firing',
    modifiers: {
      spreadBloomMultiplier: 0.7,
      spreadRecoveryMultiplier: 1.15,
    },
  },

  // ── Magazines ────────────────────────────────────────────────────

  [AttachmentId.ExtendedMag]: {
    id: AttachmentId.ExtendedMag,
    name: 'Extended Magazine',
    slot: AttachmentSlot.Magazine,
    description: 'More rounds, slower reload',
    modifiers: {
      magSizeAdd: 10,
      reloadTimeAdd: 0.5,
      adsSpeedMultiplier: 0.95,
    },
  },
  [AttachmentId.QuickDrawMag]: {
    id: AttachmentId.QuickDrawMag,
    name: 'Quick-Draw Magazine',
    slot: AttachmentSlot.Magazine,
    description: 'Faster reload and draw',
    modifiers: {
      reloadTimeAdd: -0.4,
      swapTimeAdd: -0.15,
    },
  },
};

// ── Per-weapon attachment compatibility ────────────────────────────

/** Which attachments each weapon can equip, keyed by slot */
export const WEAPON_ATTACHMENTS: Record<WeaponId, Partial<Record<AttachmentSlot, AttachmentId[]>>> = {
  [WeaponId.AssaultRifle]: {
    [AttachmentSlot.Sight]: [AttachmentId.RedDot, AttachmentId.Holographic, AttachmentId.Acog4x],
    [AttachmentSlot.Barrel]: [AttachmentId.Suppressor, AttachmentId.Compensator, AttachmentId.FlashHider, AttachmentId.HeavyBarrel],
    [AttachmentSlot.Grip]: [AttachmentId.VerticalGrip, AttachmentId.AngledGrip, AttachmentId.StubbyGrip],
    [AttachmentSlot.Magazine]: [AttachmentId.ExtendedMag, AttachmentId.QuickDrawMag],
  },
  [WeaponId.SMG_Assault]: {
    [AttachmentSlot.Sight]: [AttachmentId.RedDot, AttachmentId.Holographic],
    [AttachmentSlot.Barrel]: [AttachmentId.Suppressor, AttachmentId.Compensator, AttachmentId.FlashHider],
    [AttachmentSlot.Grip]: [AttachmentId.VerticalGrip, AttachmentId.AngledGrip],
    [AttachmentSlot.Magazine]: [AttachmentId.ExtendedMag, AttachmentId.QuickDrawMag],
  },
  [WeaponId.SMG_Medic]: {
    [AttachmentSlot.Sight]: [AttachmentId.RedDot, AttachmentId.Holographic],
    [AttachmentSlot.Barrel]: [AttachmentId.Suppressor, AttachmentId.FlashHider],
    [AttachmentSlot.Grip]: [AttachmentId.VerticalGrip, AttachmentId.StubbyGrip],
    [AttachmentSlot.Magazine]: [AttachmentId.ExtendedMag, AttachmentId.QuickDrawMag],
  },
  [WeaponId.Shotgun]: {
    [AttachmentSlot.Sight]: [AttachmentId.RedDot],
    [AttachmentSlot.Barrel]: [AttachmentId.Suppressor],
    [AttachmentSlot.Magazine]: [AttachmentId.ExtendedMag],
  },
  [WeaponId.Carbine]: {
    [AttachmentSlot.Sight]: [AttachmentId.RedDot, AttachmentId.Holographic, AttachmentId.Acog4x],
    [AttachmentSlot.Barrel]: [AttachmentId.Suppressor, AttachmentId.Compensator, AttachmentId.HeavyBarrel],
    [AttachmentSlot.Grip]: [AttachmentId.VerticalGrip, AttachmentId.AngledGrip, AttachmentId.StubbyGrip],
    [AttachmentSlot.Magazine]: [AttachmentId.ExtendedMag, AttachmentId.QuickDrawMag],
  },
  [WeaponId.PDW]: {
    [AttachmentSlot.Sight]: [AttachmentId.RedDot, AttachmentId.Holographic],
    [AttachmentSlot.Barrel]: [AttachmentId.Suppressor, AttachmentId.Compensator, AttachmentId.FlashHider],
    [AttachmentSlot.Grip]: [AttachmentId.AngledGrip, AttachmentId.StubbyGrip],
    [AttachmentSlot.Magazine]: [AttachmentId.ExtendedMag, AttachmentId.QuickDrawMag],
  },
  [WeaponId.SniperRifle]: {
    [AttachmentSlot.Sight]: [AttachmentId.Scope8x, AttachmentId.Acog4x],
    [AttachmentSlot.Barrel]: [AttachmentId.Suppressor, AttachmentId.HeavyBarrel],
    [AttachmentSlot.Magazine]: [AttachmentId.ExtendedMag],
  },
  [WeaponId.DMR]: {
    [AttachmentSlot.Sight]: [AttachmentId.Acog4x, AttachmentId.Scope8x, AttachmentId.RedDot, AttachmentId.Holographic],
    [AttachmentSlot.Barrel]: [AttachmentId.Suppressor, AttachmentId.Compensator, AttachmentId.HeavyBarrel],
    [AttachmentSlot.Grip]: [AttachmentId.VerticalGrip, AttachmentId.AngledGrip],
    [AttachmentSlot.Magazine]: [AttachmentId.ExtendedMag, AttachmentId.QuickDrawMag],
  },
};

// ── Loadout type ───────────────────────────────────────────────────

/** A player's selected attachments for a weapon (one per slot, all optional) */
export type WeaponLoadout = Partial<Record<AttachmentSlot, AttachmentId>>;

// ── Stat application ───────────────────────────────────────────────

/**
 * Apply a loadout's attachment modifiers to base weapon stats.
 * Returns a new WeaponStats object with all modifiers applied.
 * Multiplicative modifiers stack multiplicatively.
 * Additive modifiers stack additively.
 */
export function applyAttachments(base: WeaponStats, loadout: WeaponLoadout): WeaponStats {
  const result = { ...base };

  // Accumulate multipliers and additives
  let spreadMul = 1;
  let recoilKickMul = 1;
  let recoilRandomMul = 1;
  let adsSpeedMul = 1;
  let adsSpreadMul = 1;
  let moveSpeedMul = 1;
  let spreadBloomMul = 1;
  let spreadRecoveryMul = 1;
  let recoilRecoveryMul = 1;
  let projectileSpeedMul = 1;

  for (const slot of Object.values(AttachmentSlot)) {
    const attachId = loadout[slot];
    if (!attachId) continue;
    const attach = ATTACHMENTS[attachId];
    if (!attach) continue;
    const m = attach.modifiers;

    // Multiplicative
    if (m.spreadMultiplier !== undefined) spreadMul *= m.spreadMultiplier;
    if (m.recoilKickMultiplier !== undefined) recoilKickMul *= m.recoilKickMultiplier;
    if (m.recoilRandomMultiplier !== undefined) recoilRandomMul *= m.recoilRandomMultiplier;
    if (m.adsSpeedMultiplier !== undefined) adsSpeedMul *= m.adsSpeedMultiplier;
    if (m.adsSpreadMultiplier !== undefined) adsSpreadMul *= m.adsSpreadMultiplier;
    if (m.moveSpeedMultiplier !== undefined) moveSpeedMul *= m.moveSpeedMultiplier;
    if (m.spreadBloomMultiplier !== undefined) spreadBloomMul *= m.spreadBloomMultiplier;
    if (m.spreadRecoveryMultiplier !== undefined) spreadRecoveryMul *= m.spreadRecoveryMultiplier;
    if (m.recoilRecoveryMultiplier !== undefined) recoilRecoveryMul *= m.recoilRecoveryMultiplier;
    if (m.projectileSpeedMultiplier !== undefined) projectileSpeedMul *= m.projectileSpeedMultiplier;

    // Additive
    if (m.magSizeAdd !== undefined) result.magSize += m.magSizeAdd;
    if (m.reloadTimeAdd !== undefined) result.reloadTime += m.reloadTimeAdd;
    if (m.damageAdd !== undefined) result.damage += m.damageAdd;
    if (m.swapTimeAdd !== undefined) result.swapTime += m.swapTimeAdd;
    if (m.aimSwayAdd !== undefined) result.aimSway += m.aimSwayAdd;
    if (m.maxRangeAdd !== undefined) result.maxRange += m.maxRangeAdd;
    if (m.falloffStartAdd !== undefined) result.falloffStart += m.falloffStartAdd;
  }

  // Apply accumulated multipliers
  result.spread *= spreadMul;
  result.recoilKick *= recoilKickMul;
  result.recoilRandom *= recoilRandomMul;
  result.adsSpeed *= adsSpeedMul;
  result.adsSpreadMultiplier *= adsSpreadMul;
  result.moveSpeedMultiplier *= moveSpeedMul;
  result.spreadBloom *= spreadBloomMul;
  result.spreadRecovery *= spreadRecoveryMul;
  result.recoilRecovery *= recoilRecoveryMul;
  result.projectileSpeed *= projectileSpeedMul;

  // Clamp values to sane ranges
  result.magSize = Math.max(1, Math.round(result.magSize));
  result.reloadTime = Math.max(0.5, result.reloadTime);
  result.spread = Math.max(0, result.spread);
  result.aimSway = Math.max(0, result.aimSway);
  result.swapTime = Math.max(0.1, result.swapTime);

  return result;
}

/**
 * Validate that a loadout is legal for a given weapon.
 * Returns only the valid attachments, stripping any illegal ones.
 */
export function validateLoadout(weaponId: WeaponId, loadout: WeaponLoadout): WeaponLoadout {
  const valid: WeaponLoadout = {};
  const available = WEAPON_ATTACHMENTS[weaponId] ?? {};

  for (const slot of Object.values(AttachmentSlot)) {
    const attachId = loadout[slot];
    if (!attachId) continue;
    const allowed = available[slot];
    if (allowed && allowed.includes(attachId)) {
      valid[slot] = attachId;
    }
  }

  return valid;
}
