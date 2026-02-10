/**
 * Sound ID enum and configuration for all game sounds.
 * Each sound has volume, loop, and spatial settings.
 */

export enum SoundId {
  ShootRifle = 'shoot_rifle',
  ShootSmg = 'shoot_smg',
  ShootShotgun = 'shoot_shotgun',
  ShootSniper = 'shoot_sniper',
  /** Distant echo / tail for weapon shots (layered on top of main shot) */
  ShootTail = 'shoot_tail',
  /** Low-frequency bass punch layered on weapon fire */
  ShootBass = 'shoot_bass',
  Reload = 'reload',
  FootstepGrass = 'footstep_grass',
  FootstepStone = 'footstep_stone',
  Jump = 'jump',
  Land = 'land',
  Explosion = 'explosion',
  HitConfirmDing = 'hit_confirm_ding',
  GrenadeBounce = 'grenade_bounce',
  AmbientWind = 'ambient_wind',
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
  [SoundId.ShootRifle]: { volume: 0.65, loop: false, spatial: true },
  [SoundId.ShootSmg]: { volume: 0.6, loop: false, spatial: true },
  [SoundId.ShootShotgun]: { volume: 0.75, loop: false, spatial: true },
  [SoundId.ShootSniper]: { volume: 0.7, loop: false, spatial: true },
  // Layered sound components
  [SoundId.ShootTail]: { volume: 0.2, loop: false, spatial: true },
  [SoundId.ShootBass]: { volume: 0.35, loop: false, spatial: false },
  [SoundId.Reload]: { volume: 0.4, loop: false, spatial: true },

  // Footsteps: volume 0.3, no loop, spatial
  [SoundId.FootstepGrass]: { volume: 0.3, loop: false, spatial: true },
  [SoundId.FootstepStone]: { volume: 0.3, loop: false, spatial: true },

  // Movement: spatial
  [SoundId.Jump]: { volume: 0.3, loop: false, spatial: true },
  [SoundId.Land]: { volume: 0.35, loop: false, spatial: true },

  // Explosion: volume 0.7, no loop, spatial
  [SoundId.Explosion]: { volume: 0.7, loop: false, spatial: true },

  // UI sounds: louder hit confirm for BattleBit-style feedback
  [SoundId.HitConfirmDing]: { volume: 0.55, loop: false, spatial: false },
  [SoundId.CaptureTick]: { volume: 0.4, loop: false, spatial: false },

  // Grenade bounce: spatial
  [SoundId.GrenadeBounce]: { volume: 0.35, loop: false, spatial: true },

  // Ambient: volume 0.15, loop, non-spatial
  [SoundId.AmbientWind]: { volume: 0.15, loop: true, spatial: false },

  // Gadget sounds: spatial
  [SoundId.GadgetMedkit]: { volume: 0.5, loop: false, spatial: true },
  [SoundId.GadgetAmmo]: { volume: 0.5, loop: false, spatial: true },
  [SoundId.GadgetSpot]: { volume: 0.4, loop: false, spatial: false },
  [SoundId.GadgetCover]: { volume: 0.6, loop: false, spatial: true },
  [SoundId.GadgetDeploy]: { volume: 0.4, loop: false, spatial: false },

  // Rocket launcher fire
  [SoundId.RocketFire]: { volume: 0.8, loop: false, spatial: true },

  // Bullet crack: supersonic whizz when projectiles pass near player
  [SoundId.BulletCrack]: { volume: 0.45, loop: false, spatial: true },
};
