/**
 * Sound ID enum and configuration for all game sounds.
 * Each sound has volume, loop, and spatial settings.
 */

export enum SoundId {
  ShootRifle = 'shoot_rifle',
  ShootSmg = 'shoot_smg',
  ShootShotgun = 'shoot_shotgun',
  ShootSniper = 'shoot_sniper',
  ShootMechanical = 'shoot_mechanical',
  /** Distant echo / tail for weapon shots (layered on top of main shot) */
  ShootTail = 'shoot_tail',
  ShootTailNear = 'shoot_tail_near',
  ShootTailFar = 'shoot_tail_far',
  /** Low-frequency bass punch layered on weapon fire */
  ShootBass = 'shoot_bass',
  Reload = 'reload',
  ReloadDone = 'reload_done',
  DryFire = 'dry_fire',
  FootstepGrass = 'footstep_grass',
  FootstepStone = 'footstep_stone',
  FootstepConcrete = 'footstep_concrete',
  FootstepWood = 'footstep_wood',
  FootstepMetal = 'footstep_metal',
  FootstepWater = 'footstep_water',
  FootstepSprint = 'footstep_sprint',
  Jump = 'jump',
  Land = 'land',
  Explosion = 'explosion',
  ImpactDirt = 'impact_dirt',
  ImpactConcrete = 'impact_concrete',
  ImpactWood = 'impact_wood',
  ImpactMetal = 'impact_metal',
  Ricochet = 'ricochet',
  HitConfirmDing = 'hit_confirm_ding',
  GrenadeBounce = 'grenade_bounce',
  AmbientWind = 'ambient_wind',
  AmbientBattle = 'ambient_battle',
  AmbientSiren = 'ambient_siren',
  UiLowHealthLoop = 'ui_low_health_loop',
  UiDownedLoop = 'ui_downed_loop',
  UiReviveStart = 'ui_revive_start',
  UiReviveTick = 'ui_revive_tick',
  UiReviveComplete = 'ui_revive_complete',
  UiGadgetReady = 'ui_gadget_ready',
  CaptureTick = 'capture_tick',
  GadgetMedkit = 'gadget_medkit',
  GadgetAmmo = 'gadget_ammo',
  GadgetSpot = 'gadget_spot',
  GadgetCover = 'gadget_cover',
  GadgetDeploy = 'gadget_deploy',
  /** Rocket launcher fire sound */
  RocketFire = 'rocket_fire',
  /** Bullet whizz/crack when a projectile passes near the player */
  BulletCrack = 'bullet_crack',
}

export interface SoundConfig {
  /** Volume 0-1 */
  volume: number;
  /** Whether this sound loops */
  loop: boolean;
  /** Whether this is a 3D positional sound */
  spatial: boolean;
  /** Mix bus routing */
  bus?: 'weapons' | 'ui' | 'ambience' | 'sfx';
}

/**
 * A sound pack maps SoundIds to audio file paths relative to the pack's base URL.
 * When loaded, file-based sounds override the procedural fallbacks.
 */
export interface SoundPackManifest {
  /** Display name of the sound pack */
  name: string;
  /** Sound files keyed by SoundId value (e.g. "shoot_rifle": "rifle_fire.ogg") */
  sounds: Partial<Record<SoundId, string>>;
}

export const SOUND_CONFIGS: Record<SoundId, SoundConfig> = {
  // Weapons: louder base volume for punchier feel
  [SoundId.ShootRifle]: { volume: 0.65, loop: false, spatial: true, bus: 'weapons' },
  [SoundId.ShootSmg]: { volume: 0.6, loop: false, spatial: true, bus: 'weapons' },
  [SoundId.ShootShotgun]: { volume: 0.75, loop: false, spatial: true, bus: 'weapons' },
  [SoundId.ShootSniper]: { volume: 0.7, loop: false, spatial: true, bus: 'weapons' },
  [SoundId.ShootMechanical]: { volume: 0.22, loop: false, spatial: true, bus: 'weapons' },
  // Layered sound components
  [SoundId.ShootTail]: { volume: 0.2, loop: false, spatial: true, bus: 'weapons' },
  [SoundId.ShootTailNear]: { volume: 0.26, loop: false, spatial: true, bus: 'weapons' },
  [SoundId.ShootTailFar]: { volume: 0.18, loop: false, spatial: true, bus: 'weapons' },
  [SoundId.ShootBass]: { volume: 0.35, loop: false, spatial: false, bus: 'weapons' },
  [SoundId.Reload]: { volume: 0.4, loop: false, spatial: true, bus: 'weapons' },
  [SoundId.ReloadDone]: { volume: 0.32, loop: false, spatial: false, bus: 'ui' },
  [SoundId.DryFire]: { volume: 0.25, loop: false, spatial: false, bus: 'ui' },

  // Footsteps: volume 0.3, no loop, spatial
  [SoundId.FootstepGrass]: { volume: 0.3, loop: false, spatial: true, bus: 'sfx' },
  [SoundId.FootstepStone]: { volume: 0.3, loop: false, spatial: true, bus: 'sfx' },
  [SoundId.FootstepConcrete]: { volume: 0.28, loop: false, spatial: true, bus: 'sfx' },
  [SoundId.FootstepWood]: { volume: 0.29, loop: false, spatial: true, bus: 'sfx' },
  [SoundId.FootstepMetal]: { volume: 0.32, loop: false, spatial: true, bus: 'sfx' },
  [SoundId.FootstepWater]: { volume: 0.33, loop: false, spatial: true, bus: 'sfx' },
  [SoundId.FootstepSprint]: { volume: 0.26, loop: false, spatial: true, bus: 'sfx' },

  // Movement: spatial
  [SoundId.Jump]: { volume: 0.3, loop: false, spatial: true, bus: 'sfx' },
  [SoundId.Land]: { volume: 0.35, loop: false, spatial: true, bus: 'sfx' },

  // Explosion: volume 0.7, no loop, spatial
  [SoundId.Explosion]: { volume: 0.7, loop: false, spatial: true, bus: 'weapons' },
  [SoundId.ImpactDirt]: { volume: 0.3, loop: false, spatial: true, bus: 'sfx' },
  [SoundId.ImpactConcrete]: { volume: 0.34, loop: false, spatial: true, bus: 'sfx' },
  [SoundId.ImpactWood]: { volume: 0.31, loop: false, spatial: true, bus: 'sfx' },
  [SoundId.ImpactMetal]: { volume: 0.37, loop: false, spatial: true, bus: 'sfx' },
  [SoundId.Ricochet]: { volume: 0.28, loop: false, spatial: true, bus: 'sfx' },

  // UI sounds: louder hit confirm for BattleBit-style feedback
  [SoundId.HitConfirmDing]: { volume: 0.55, loop: false, spatial: false, bus: 'ui' },
  [SoundId.CaptureTick]: { volume: 0.4, loop: false, spatial: false, bus: 'ui' },
  [SoundId.UiLowHealthLoop]: { volume: 0.15, loop: true, spatial: false, bus: 'ui' },
  [SoundId.UiDownedLoop]: { volume: 0.2, loop: true, spatial: false, bus: 'ui' },
  [SoundId.UiReviveStart]: { volume: 0.34, loop: false, spatial: false, bus: 'ui' },
  [SoundId.UiReviveTick]: { volume: 0.22, loop: false, spatial: false, bus: 'ui' },
  [SoundId.UiReviveComplete]: { volume: 0.36, loop: false, spatial: false, bus: 'ui' },
  [SoundId.UiGadgetReady]: { volume: 0.24, loop: false, spatial: false, bus: 'ui' },

  // Grenade bounce: spatial
  [SoundId.GrenadeBounce]: { volume: 0.35, loop: false, spatial: true, bus: 'sfx' },

  // Ambient: volume 0.15, loop, non-spatial
  [SoundId.AmbientWind]: { volume: 0.15, loop: true, spatial: false, bus: 'ambience' },
  [SoundId.AmbientBattle]: { volume: 0.14, loop: true, spatial: false, bus: 'ambience' },
  [SoundId.AmbientSiren]: { volume: 0.08, loop: true, spatial: false, bus: 'ambience' },

  // Gadget sounds: spatial
  [SoundId.GadgetMedkit]: { volume: 0.5, loop: false, spatial: true, bus: 'sfx' },
  [SoundId.GadgetAmmo]: { volume: 0.5, loop: false, spatial: true, bus: 'sfx' },
  [SoundId.GadgetSpot]: { volume: 0.4, loop: false, spatial: false, bus: 'ui' },
  [SoundId.GadgetCover]: { volume: 0.6, loop: false, spatial: true, bus: 'sfx' },
  [SoundId.GadgetDeploy]: { volume: 0.4, loop: false, spatial: false, bus: 'ui' },

  // Rocket launcher fire
  [SoundId.RocketFire]: { volume: 0.8, loop: false, spatial: true, bus: 'weapons' },

  // Bullet crack: supersonic whizz when projectiles pass near player
  [SoundId.BulletCrack]: { volume: 0.45, loop: false, spatial: true, bus: 'sfx' },
};
