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
  /** Secondary sidearm weapon (all classes get a pistol) */
  secondary: WeaponId;
  /** Universal grenades available to all classes [frag, smoke] */
  grenades: [GadgetId, GadgetId];
  /** Available gadgets (pick one) */
  gadgets: [GadgetId, GadgetId];
  /** Max health */
  maxHealth: number;
  /** Ability description */
  abilityName: string;
  /** Ability cooldown in seconds */
  abilityCooldown: number;
  /** Optional special weapon (extra slot, press 3 to switch) */
  specialWeapon?: WeaponId;
}

/** All class definitions */
export const CLASSES: Record<ClassId, ClassDef> = {
  [ClassId.Assault]: {
    id: ClassId.Assault,
    name: 'Assault',
    defaultPrimary: WeaponId.AssaultRifle,
    altPrimary: WeaponId.SMG_Assault,
    secondary: WeaponId.Pistol,
    grenades: [GadgetId.FragGrenade, GadgetId.SmokeGrenade],
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
    secondary: WeaponId.Pistol,
    grenades: [GadgetId.FragGrenade, GadgetId.SmokeGrenade],
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
    secondary: WeaponId.Pistol,
    grenades: [GadgetId.FragGrenade, GadgetId.SmokeGrenade],
    gadgets: [GadgetId.AmmoBox, GadgetId.RepairTool],
    specialWeapon: WeaponId.RocketLauncher,
    maxHealth: 100,
    abilityName: 'Deploy Cover',
    abilityCooldown: 30,
  },
  [ClassId.Recon]: {
    id: ClassId.Recon,
    name: 'Recon',
    defaultPrimary: WeaponId.SniperRifle,
    altPrimary: WeaponId.DMR,
    secondary: WeaponId.Pistol,
    grenades: [GadgetId.FragGrenade, GadgetId.SmokeGrenade],
    gadgets: [GadgetId.SpottingScope, GadgetId.Claymore],
    maxHealth: 100,
    abilityName: 'Mark Targets',
    abilityCooldown: 15,
  },
};
