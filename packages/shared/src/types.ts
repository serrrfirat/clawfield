/** Available game modes */
export type GameMode = 'tdm' | 'conquest';

/** 3D vector */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** Player state sent from server to clients */
export interface PlayerState {
  id: string;
  name: string;
  position: Vec3;
  yaw: number;
  pitch: number;
  grounded: boolean;
  inWater: boolean;
  health: number;
  alive: boolean;
  /** Player is downed (can be revived) but not yet dead */
  downed: boolean;
  team: number;
  classId: string;
  ammo: number;
  maxAmmo: number;
  reloading: boolean;
}

/** Input state captured on the client each frame */
export interface InputState {
  forward: boolean;
  back: boolean;
  left: boolean;
  right: boolean;
  jump: boolean;
  shoot: boolean;
  reload: boolean;
  sprint: boolean;
  crouch: boolean;
  throwGrenade: boolean;
  useGadget: boolean;
  gadgetIndex: number;
  scope: boolean;
  yaw: number;
  pitch: number;
}

/** Chunk data for network transport */
export interface ChunkData {
  key: string;
  voxels: number[];
}

/** Axis-aligned bounding box */
export interface AABB {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
}

/** Projectile state for network sync */
export interface ProjectileState {
  id: number;
  ownerId: string;
  position: Vec3;
  velocity: Vec3;
  weapon: string; // weapon name for kill feed
}

/** Capture point state for network sync */
export interface CapturePointState {
  id: string;
  position: Vec3;
  /** 0.0 = fully team 0 (Alpha), 1.0 = fully team 1 (Bravo), 0.5 = neutral */
  control: number;
  /** Current owner team: -1 = neutral, 0 = Alpha, 1 = Bravo */
  owner: number;
  /** Whether enemy players are in the radius */
  contested: boolean;
}

/** Map objective marker (from map metadata) */
export interface MapObjective {
  id: string;
  type: string;
  position: Vec3;
}

/** Grenade state for network sync */
export interface GrenadeState {
  id: number;
  ownerId: string;
  ownerTeam: number;
  position: Vec3;
  velocity: Vec3;
  /** Time remaining on fuse (seconds) */
  fuseRemaining: number;
}

/** Explosion event sent to clients */
export interface ExplosionEvent {
  position: Vec3;
  radius: number;
  /** Player who caused the explosion */
  ownerId: string;
}

/** Scoreboard entry for each player */
export interface ScoreboardEntry {
  id: string;
  name: string;
  team: number;
  classId: string;
  kills: number;
  deaths: number;
  assists: number;
  score: number;
}

/** Gadget state for network sync */
export interface GadgetState {
  id: number;
  type: string;
  ownerId: string;
  ownerTeam: number;
  position: Vec3;
  lifetime: number;
}

// --- WebSocket protocol messages ---

/** Kill feed entry */
export interface KillEntry {
  killerId: string;
  killerName: string;
  victimId: string;
  victimName: string;
  weapon: string;
}

/** Spawn point option sent to clients for the deploy screen */
export interface SpawnPointOption {
  id: string;
  name: string;
  position: Vec3;
  /** 'base' = team home spawn, 'flag' = captured point */
  type: 'base' | 'flag';
}

export type ClientMessage =
  | { type: 'join'; name: string; classId: string; gameMode: GameMode }
  | { type: 'input'; seq: number; input: InputState; dt: number }
  | { type: 'select_class'; classId: string }
  | { type: 'deploy'; classId: string; weaponId: string; spawnPointId: string };

export type ServerMessage =
  | {
      type: 'welcome';
      id: string;
      team: number;
      mapData: ChunkData[];
      palette?: number[];
      waterIndices?: number[];
      mapName?: string;
      objectives?: MapObjective[];
      gameMode: GameMode;
    }
  | { type: 'player_joined'; id: string; name: string; team: number }
  | { type: 'player_left'; id: string }
  | { type: 'state'; tick: number; players: PlayerState[]; ack: number }
  | { type: 'hit_confirm'; targetId: string; damage: number; sourcePos: Vec3 }
  | { type: 'kill'; entry: KillEntry }
  | { type: 'death'; killerId: string; respawnTime: number; killerPos: Vec3 }
  | { type: 'downed'; killerId: string; bleedoutTime: number; killerPos: Vec3 }
  | { type: 'revive_progress'; reviverId: string; progress: number }
  | { type: 'revived'; reviverId: string; health: number }
  | { type: 'respawn'; position: Vec3 }
  | { type: 'available_spawns'; spawns: SpawnPointOption[] }
  | { type: 'tickets'; alpha: number; bravo: number }
  | { type: 'projectiles'; projectiles: ProjectileState[] }
  | { type: 'grenades'; grenades: GrenadeState[] }
  | { type: 'explosion'; event: ExplosionEvent }
  | { type: 'capture_points'; points: CapturePointState[] }
  | { type: 'conquest_score'; alpha: number; bravo: number }
  | { type: 'game_over'; winner: number }
  | { type: 'scoreboard'; players: ScoreboardEntry[] }
  | { type: 'gadgets'; gadgets: GadgetState[] }
  | { type: 'enemy_spotted'; positions: Vec3[]; duration: number }
  | { type: 'voxel_update'; changes: { x: number; y: number; z: number; material: number }[] }
  | { type: 'chunks'; chunks: ChunkData[] };
