import { WeaponId } from './weapons.js';

/** Player class identifiers */
export enum ClassId {
  Assault = 'assault',
  Medic = 'medic',
  Engineer = 'engineer',
  Recon = 'recon',
}

/** Gadget identifiers */
export enum GadgetId {
  FragGrenade = 'frag_grenade',
  SmokeGrenade = 'smoke_grenade',
  Medkit = 'medkit',
  Bandage = 'bandage',
  AmmoBox = 'ammo_box',
  RepairTool = 'repair_tool',
  SpottingScope = 'spotting_scope',
  Claymore = 'claymore',
}

/** Class definition */
export interface ClassDef {
  id: ClassId;
  name: string;
  /** Default primary weapon */
  defaultPrimary: WeaponId;
  /** Alternative primary weapon */
  altPrimary: WeaponId;
  /** Available gadgets (pick one) */
  gadgets: [GadgetId, GadgetId];
  /** Max health */
  maxHealth: number;
  /** Ability description */
  abilityName: string;
  /** Ability cooldown in seconds */
  abilityCooldown: number;
}

/** All class definitions */
export const CLASSES: Record<ClassId, ClassDef> = {
  [ClassId.Assault]: {
    id: ClassId.Assault,
    name: 'Assault',
    defaultPrimary: WeaponId.AssaultRifle,
    altPrimary: WeaponId.SMG_Assault,
    gadgets: [GadgetId.FragGrenade, GadgetId.SmokeGrenade],
    maxHealth: 100,
    abilityName: 'Sprint Boost',
    abilityCooldown: 20,
  },
  [ClassId.Medic]: {
    id: ClassId.Medic,
    name: 'Medic',
    defaultPrimary: WeaponId.SMG_Medic,
    altPrimary: WeaponId.Shotgun,
    gadgets: [GadgetId.Medkit, GadgetId.Bandage],
    maxHealth: 100,
    abilityName: 'Heal Aura',
    abilityCooldown: 25,
  },
  [ClassId.Engineer]: {
    id: ClassId.Engineer,
    name: 'Engineer',
    defaultPrimary: WeaponId.Carbine,
    altPrimary: WeaponId.PDW,
    gadgets: [GadgetId.AmmoBox, GadgetId.RepairTool],
    maxHealth: 100,
    abilityName: 'Deploy Cover',
    abilityCooldown: 30,
  },
  [ClassId.Recon]: {
    id: ClassId.Recon,
    name: 'Recon',
    defaultPrimary: WeaponId.SniperRifle,
    altPrimary: WeaponId.DMR,
    gadgets: [GadgetId.SpottingScope, GadgetId.Claymore],
    maxHealth: 100,
    abilityName: 'Mark Targets',
    abilityCooldown: 15,
  },
};
