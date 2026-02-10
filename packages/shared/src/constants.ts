/** Voxel chunk dimensions (cubed) */
export const CHUNK_SIZE = 16;

/** Size of one voxel in world units (meters) */
export const VOXEL_SIZE = 0.5;

/** Server tick rate in Hz */
export const TICK_RATE = 20;

/** Server tick interval in ms */
export const TICK_INTERVAL = 1000 / TICK_RATE;

/** Gravity acceleration in m/s^2 */
export const GRAVITY = -20;

/** Jump initial velocity in m/s */
export const JUMP_VELOCITY = 8;

/** Player move speed in m/s */
export const MOVE_SPEED = 6;

/** Sprint speed in m/s */
export const SPRINT_SPEED = 8.5;

/** Crouch move speed in m/s */
export const CROUCH_SPEED = 3;

/** Player hitbox dimensions in world units */
export const PLAYER_WIDTH = 0.8;
export const PLAYER_HEIGHT = 1.8;

/** Crouch hitbox height (half of PLAYER_HEIGHT) */
export const CROUCH_HEIGHT = 1.0;

/** Time in seconds after releasing sprint before firing is allowed */
export const SPRINT_FIRE_DELAY = 0.2;

/** Wall climb speed when scrambling up walls (m/s) — slower than jump */
export const CLIMB_SPEED = 4;

/** Maximum pitch angle (radians) */
export const MAX_PITCH = Math.PI / 2 - 0.01;

/** Voxel material IDs */
export const MAT_AIR = 0;
export const MAT_GRASS = 1;
export const MAT_DIRT = 2;
export const MAT_STONE = 3;
export const MAT_WALL = 4;
export const MAT_ROOF = 5;
export const MAT_WATER = 6;
export const MAT_SAND_LIGHT = 7;
export const MAT_SAND_DARK = 8;
export const MAT_GRASS_DARK = 9;
export const MAT_STONE_DARK = 10;
export const MAT_CONCRETE = 11;
export const MAT_CONCRETE_DARK = 12;
export const MAT_WOOD = 13;
export const MAT_WOOD_DARK = 14;
export const MAT_BRICK = 15;
export const MAT_ROOF_TILE = 16;
export const MAT_WATER_DEEP = 17;
export const MAT_ROAD = 18;
export const MAT_WINDOW = 19;
export const MAT_METAL = 20;

// --- Destruction system constants ---

/** Material hardness: how much damage a voxel can resist. Higher = harder to destroy. */
export const MATERIAL_HARDNESS: Record<number, number> = {
  [MAT_AIR]: 0,
  [MAT_GRASS]: 1,
  [MAT_DIRT]: 1,
  [MAT_STONE]: 3,
  [MAT_WALL]: 2,
  [MAT_ROOF]: 2,
  [MAT_WATER]: 0,
};

/** Default hardness for custom palette materials not in MATERIAL_HARDNESS */
export const DEFAULT_MATERIAL_HARDNESS = 2;

/** Returns true if the material can be destroyed by weapons.
 *  Terrain (ground anchors) is indestructible — only structures break. */
export function isDestructible(mat: number): boolean {
  return mat !== MAT_AIR && mat !== MAT_WATER && !isGroundAnchor(mat);
}

/** Grenade destruction radius in voxels */
export const GRENADE_DESTRUCTION_RADIUS = 5;

/** Bullet damage vs material hardness (destroys if >= hardness). Only soft materials. */
export const BULLET_VOXEL_DAMAGE = 2;

/** Max voxels a single bullet can destroy along its path */
export const BULLET_DESTRUCTION_COUNT = 3;

/** Max voxel changes per server tick (budget cap) */
export const MAX_VOXEL_CHANGES_PER_TICK = 600;

/** BFS budget for bullet-triggered connectivity checks (smaller than explosion budget) */
export const STRUCTURAL_BUDGET_BULLET = 2000;

/**
 * Support ratio for structural integrity. Each ground-contact voxel
 * can support up to this many building voxels. If the ratio is exceeded,
 * the structure collapses even though it's technically connected to ground.
 * Example: ratio=50, 1 ground contact can hold 50 voxels but not 200.
 */
export const STRUCTURAL_SUPPORT_RATIO = 50;

/** Minimum group size to trigger rigid-body rubble drop (smaller = visual debris only) */
export const RUBBLE_DROP_MIN_SIZE = 5;

/** Damage dealt to players crushed under falling rubble (100 HP = full health) */
export const CRUSH_DAMAGE = 200;

/** Gravity for falling sections (slower than gameplay gravity for dramatic effect) */
export const SECTION_FALL_GRAVITY = 5;

/** Min/max duration for falling section animation (seconds) */
export const SECTION_FALL_MIN_DURATION = 1.5;
export const SECTION_FALL_MAX_DURATION = 3.0;

/**
 * Runtime-configurable ground anchor materials.
 * Voxels made of these materials (or resting on them) are considered grounded
 * for structural connectivity checks. Defaults to terrain materials.
 * Maps with custom palettes override via setGroundAnchors().
 */
const _groundAnchors = new Set<number>([MAT_GRASS, MAT_DIRT, MAT_STONE]);

/** Check if a material acts as a ground anchor (terrain that never collapses) */
export function isGroundAnchor(mat: number): boolean {
  return _groundAnchors.has(mat);
}

/** Set which palette indices act as ground anchors (called on map load) */
export function setGroundAnchors(indices: number[]): void {
  _groundAnchors.clear();
  for (const i of indices) _groundAnchors.add(i);
}

/**
 * Runtime-configurable water indices.
 * Defaults to MAT_WATER (6) and MAT_WATER_DEEP (17).
 * Maps with custom palettes can override via setWaterIndices().
 */
const _waterIndices = new Set<number>([MAT_WATER, MAT_WATER_DEEP]);

/** Check if a voxel value is a water material */
export function isWater(voxel: number): boolean {
  return _waterIndices.has(voxel);
}

/** Set which palette indices count as water (called on map load) */
export function setWaterIndices(indices: number[]): void {
  _waterIndices.clear();
  for (const i of indices) _waterIndices.add(i);
}

/** Material colors (hex). Populated at runtime for map palette. */
export const MATERIAL_COLORS: Record<number, number> = {
  [MAT_GRASS]: 0x4a8c3f,
  [MAT_DIRT]: 0x7a5c3a,
  [MAT_STONE]: 0x888888,
  [MAT_WALL]: 0xa0a0a0,
  [MAT_ROOF]: 0x555555,
  [MAT_WATER]: 0x2389da,
  [MAT_SAND_LIGHT]: 0xd4b896,
  [MAT_SAND_DARK]: 0xc4a67a,
  [MAT_GRASS_DARK]: 0x4a7a33,
  [MAT_STONE_DARK]: 0x666666,
  [MAT_CONCRETE]: 0xa0a0a0,
  [MAT_CONCRETE_DARK]: 0x808080,
  [MAT_WOOD]: 0x8b6914,
  [MAT_WOOD_DARK]: 0x6b4f10,
  [MAT_BRICK]: 0xa05228,
  [MAT_ROOF_TILE]: 0x8b4513,
  [MAT_WATER_DEEP]: 0x1a4c80,
  [MAT_ROAD]: 0x555555,
  [MAT_WINDOW]: 0x87ceeb,
  [MAT_METAL]: 0x708090,
};

// --- Water physics constants ---

/** Movement speed in water (m/s) */
export const WATER_MOVE_SPEED = 3.5;

/** Vertical swim speed when pressing jump in water (m/s) */
export const WATER_SWIM_UP_SPEED = 4;

/** Vertical sink speed when pressing crouch in water (m/s) */
export const WATER_SINK_SPEED = 3;

/** Gravity multiplier when submerged (buoyancy counteracts gravity) */
export const WATER_GRAVITY = -4;

/** Drag applied to vertical velocity in water (per second, multiplicative) */
export const WATER_DRAG = 5;

/**
 * Load a 256-entry palette (hex colors) into MATERIAL_COLORS.
 * Called when the client receives the map palette from the server.
 */
export function loadPalette(palette: number[]): void {
  for (let i = 0; i < palette.length; i++) {
    if (palette[i] !== 0) {
      MATERIAL_COLORS[i] = palette[i];
    }
  }
}

// --- Chunk LOD constants ---

/** Number of LOD levels (0 = full detail, 1 = half, 2 = quarter) */
export const LOD_LEVELS = 3;

/** Chunk distance thresholds for each LOD level (in chunk units, squared for fast comparison) */
export const LOD_DISTANCE_SQ = [
  5 * 5,   // LOD 0 → LOD 1 at 5 chunks
  8 * 8,   // LOD 1 → LOD 2 at 8 chunks
] as const;

/** Downsample factor per LOD level: LOD 0 = 1×, LOD 1 = 2×, LOD 2 = 4× */
export const LOD_FACTORS = [1, 2, 4] as const;

/** How often (in frames) the client recalculates LOD levels */
export const LOD_UPDATE_INTERVAL = 30;

/** Chunk streaming radius in chunks (how many chunks around the player to load) */
export const STREAM_RADIUS = 10;

/** How often (in ticks) the server checks for new chunks to stream to players */
export const STREAM_CHECK_INTERVAL = 10; // every 0.5s at 20Hz

/** WebSocket server port */
export const SERVER_PORT = 3000;

/** Interpolation buffer time in ms */
export const INTERPOLATION_DELAY = 100;

// --- Capture Point constants (ported from Ravenfield) ---

/** Radius around capture point where players count for capture */
export const CAPTURE_RADIUS = 10;

/** Capture progress change per player per second (Ravenfield: 0.05) */
export const CAPTURE_RATE_PER_PLAYER = 0.05;

/** How often (in seconds) capture calculation runs on server */
export const CAPTURE_UPDATE_RATE = 1;

/** Victory points needed (score difference) to win Conquest */
export const CONQUEST_VICTORY_POINTS = 200;

/** Score awarded per tick (1 second) - multiplied by flag count */
export const CONQUEST_SCORE_PER_TICK = 1;

// --- Grenade constants (ported from Ravenfield) ---

/** Grenade throw speed in m/s */
export const GRENADE_THROW_SPEED = 18;

/** Grenade fuse time in seconds */
export const GRENADE_FUSE_TIME = 3;

/** Grenade bounce factor (velocity retained on bounce) */
export const GRENADE_BOUNCINESS = 0.25;

/** Grenade bounce drag (velocity lost per bounce) */
export const GRENADE_BOUNCE_DRAG = 0.25;

/** Frag grenade explosion damage at center */
export const GRENADE_DAMAGE = 350;

/** Frag grenade explosion damage radius in meters */
export const GRENADE_DAMAGE_RADIUS = 8;

/** Frag grenade knockback force */
export const GRENADE_FORCE = 1200;

/** Max grenades a player can carry */
export const GRENADE_MAX_COUNT = 999;

/** Grenade cooldown between throws (seconds) */
export const GRENADE_COOLDOWN = 0.1;

// --- Rocket launcher constants ---

/** Rocket projectile speed in m/s */
export const ROCKET_SPEED = 45;

/** Rocket gravity while motor is active (m/s²) — light dropoff */
export const ROCKET_MOTOR_GRAVITY = -5;

/** Rocket motor burn time in seconds */
export const ROCKET_MOTOR_TIME = 1.3;

/** Rocket center damage */
export const ROCKET_DAMAGE = 150;

/** Rocket splash damage radius in meters */
export const ROCKET_DAMAGE_RADIUS = 5;

/** Rocket voxel destruction radius */
export const ROCKET_DESTRUCTION_RADIUS = 4;

/** Rocket max range in meters before despawn */
export const ROCKET_MAX_RANGE = 150;

/** Rocket launcher cooldown in seconds */
export const ROCKET_COOLDOWN = 12;

// --- Smoke grenade constants ---

/** Smoke grenade throw speed in m/s */
export const SMOKE_GRENADE_THROW_SPEED = 16;

/** Smoke grenade fuse time before smoke deploys (seconds) */
export const SMOKE_GRENADE_FUSE_TIME = 2;

/** Smoke cloud radius in meters */
export const SMOKE_GRENADE_RADIUS = 12;

/** Smoke cloud duration in seconds */
export const SMOKE_GRENADE_DURATION = 25;

/** Smoke grenade bounce factor */
export const SMOKE_GRENADE_BOUNCINESS = 0.3;

/** Smoke grenade bounce drag */
export const SMOKE_GRENADE_BOUNCE_DRAG = 0.3;

// --- Gadget constants ---

/** Medkit heal radius in meters */
export const GADGET_MEDKIT_RADIUS = 3;

/** Medkit heal rate in HP per second */
export const GADGET_MEDKIT_HEAL_RATE = 5;

/** Medkit duration in seconds */
export const GADGET_MEDKIT_DURATION = 30;

/** Ammo box resupply radius in meters */
export const GADGET_AMMO_RADIUS = 3;

/** Ammo box resupply interval in seconds */
export const GADGET_AMMO_INTERVAL = 3;

/** Ammo box duration in seconds */
export const GADGET_AMMO_DURATION = 30;

/** Spotting scope mark duration in seconds */
export const GADGET_SPOT_DURATION = 10;

/** Spotting scope cone half-angle in radians */
export const GADGET_SPOT_CONE = 0.15;

/** Deploy cover HP */
export const GADGET_COVER_HP = 300;

/** Deploy cover width in voxels */
export const GADGET_COVER_WIDTH = 2;

/** Deploy cover height in voxels */
export const GADGET_COVER_HEIGHT = 2;

/** Deploy cover duration in seconds (auto-remove after this) */
export const GADGET_COVER_DURATION = 45;

/** Deploy cover placement distance from player (meters) */
export const GADGET_COVER_DISTANCE = 2;

/** Deploy cover material ID (uses wall material) */
export const GADGET_COVER_MATERIAL = 4; // MAT_WALL

/** Gadget cooldown in seconds (legacy default) */
export const GADGET_COOLDOWN = 15;

/** Per-gadget cooldowns in seconds */
export const GADGET_COOLDOWNS: Record<string, number> = {
  medkit: 15,
  bandage: 8,
  ammo_box: 15,
  repair_tool: 30,
  spotting_scope: 15,
  claymore: 20,
};

/** Bandage heal amount (instant self-heal) */
export const GADGET_BANDAGE_HEAL = 30;

/** Claymore proximity trigger radius in meters */
export const GADGET_CLAYMORE_RADIUS = 3;

/** Claymore explosion damage */
export const GADGET_CLAYMORE_DAMAGE = 80;

/** Claymore lifetime in seconds */
export const GADGET_CLAYMORE_DURATION = 60;

/** Scoreboard broadcast interval in ticks (5 seconds at 20Hz) */
export const SCOREBOARD_BROADCAST_INTERVAL = 100;

// --- Revive system constants ---

/** Time in seconds before a downed player bleeds out and fully dies */
export const BLEEDOUT_TIME = 15;

/** Time in seconds for a non-medic to revive a downed player */
export const REVIVE_TIME = 5;

/** Time in seconds for a medic to revive a downed player */
export const REVIVE_TIME_MEDIC = 2.5;

/** Radius in meters within which a player can revive a downed teammate */
export const REVIVE_RADIUS = 2.5;

/** Health restored on revive by a non-medic */
export const REVIVE_HEALTH = 30;

/** Health restored on revive by a medic */
export const REVIVE_HEALTH_MEDIC = 75;

/** Movement speed multiplier for downed players (crawling) */
export const DOWNED_SPEED_MULT = 0.15;

// --- VoIP proximity constants ---

/** Distance (meters) within which voice is at full volume */
export const VOICE_FULL_DISTANCE = 10;

/** Distance (meters) beyond which voice is silent */
export const VOICE_MAX_DISTANCE = 50;

/** How often (in server ticks) to recompute voice proximity */
export const VOICE_PROXIMITY_TICKS = 5;
