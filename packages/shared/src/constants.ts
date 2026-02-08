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

/** Maximum pitch angle (radians) */
export const MAX_PITCH = Math.PI / 2 - 0.01;

/** Voxel material IDs */
export const MAT_AIR = 0;
export const MAT_GRASS = 1;
export const MAT_DIRT = 2;
export const MAT_STONE = 3;
export const MAT_WALL = 4;
export const MAT_ROOF = 5;

/** Material colors (hex). Populated at runtime for map palette. */
export const MATERIAL_COLORS: Record<number, number> = {
  [MAT_GRASS]: 0x4a8c3f,
  [MAT_DIRT]: 0x7a5c3a,
  [MAT_STONE]: 0x888888,
  [MAT_WALL]: 0xa0a0a0,
  [MAT_ROOF]: 0x555555,
};

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
export const GRENADE_DAMAGE = 200;

/** Frag grenade explosion damage radius in meters */
export const GRENADE_DAMAGE_RADIUS = 10;

/** Frag grenade knockback force */
export const GRENADE_FORCE = 700;

/** Max grenades a player can carry */
export const GRENADE_MAX_COUNT = 2;

/** Grenade cooldown between throws (seconds) */
export const GRENADE_COOLDOWN = 1.0;

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

/** Gadget cooldown in seconds */
export const GADGET_COOLDOWN = 15;

/** Scoreboard broadcast interval in ticks (5 seconds at 20Hz) */
export const SCOREBOARD_BROADCAST_INTERVAL = 100;
