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
  /** Active weapon slot: 0 = primary, 1 = secondary (pistol), 2 = special */
  weaponSlot: number;
  /** True when this player fired this tick */
  shooting: boolean;
  /** Display name of the active weapon (for remote gunshot sounds) */
  weaponName: string;
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
  /** Selected grenade type: 0 = frag, 1 = smoke */
  grenadeIndex: number;
  scope: boolean;
  /** Hold to interact (revive downed teammate) */
  interact: boolean;
  /** Active weapon slot: 0 = primary, 1 = secondary (pistol), 2 = special */
  weaponSlot: number;
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

/** Destruction visual event sent to clients for particle/debris feedback */
export interface DestructionEvent {
  position: Vec3;
  kind: 'bullet' | 'explosion' | 'crumble' | 'collapse';
  radius: number;
  /** Palette color index of the destroyed material (for particle tinting) */
  materialColor: number;
  /** Individual voxel world positions (for collapse/crumble: debris falls from each) */
  voxels?: Vec3[];
  /** Per-voxel hex colors (parallel to voxels[]), for falling section rendering */
  voxelColors?: number[];
  /** Per-voxel palette material indices (parallel to voxels[]), for placing rubble back */
  voxelMaterials?: number[];
  /** How far (in voxels) the section drops. >0 triggers falling section animation. */
  dropDistance?: number;
  /** Direction the section tilts toward as it falls (normalized XZ) */
  impactDir?: Vec3;
  /** Duration of the fall animation in seconds */
  fallDuration?: number;
}

/** Smoke grenade state for network sync (in-flight) */
export interface SmokeGrenadeState {
  id: number;
  ownerId: string;
  position: Vec3;
  velocity: Vec3;
  fuseRemaining: number;
}

/** Smoke deploy event sent to clients when smoke activates */
export interface SmokeDeployEvent {
  position: Vec3;
  radius: number;
  duration: number;
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

/** Rocket state for network sync */
export interface RocketState {
  id: number;
  ownerId: string;
  ownerTeam: number;
  position: Vec3;
  velocity: Vec3;
  motorTime: number;
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

// --- Room / Lobby types ---

/** Server phase for the room lifecycle */
export type ServerPhase = 'idle' | 'lobby' | 'in_game' | 'post_game';

/** Player info for the lobby screen */
export interface LobbyPlayer {
  id: string;
  name: string;
  team: number;
  isHost: boolean;
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

/** VoIP signaling data (offer, answer, or ICE candidate) */
export interface VoipSignalData {
  type: 'offer' | 'answer' | 'ice';
  sdp?: string;
  candidate?: string;
  sdpMid?: string | null;
  sdpMLineIndex?: number | null;
}

/** Per-peer proximity entry sent by server to each client */
export interface VoipProximityEntry {
  /** Player ID of the speaker */
  peerId: string;
  /** Gain level 0.0–1.0 based on distance */
  gain: number;
  /** Speaker's world position for spatial panning */
  position: Vec3;
}

export type ClientMessage =
  | { type: 'join'; name: string; classId: string; gameMode: GameMode }
  | { type: 'rejoin'; sessionToken: string }
  | { type: 'input'; seq: number; input: InputState; dt: number }
  | { type: 'select_class'; classId: string }
  | { type: 'deploy'; classId: string; weaponId: string; spawnPointId: string }
  | { type: 'create_room'; name: string }
  | { type: 'join_room'; name: string; roomCode: string }
  | { type: 'lobby_set_team'; team: number }
  | { type: 'lobby_set_mode'; gameMode: GameMode }
  | { type: 'start_game' }
  | { type: 'return_to_menu' }
  | { type: 'voip_signal'; targetId: string; signal: VoipSignalData };

export type ServerMessage =
  | {
      type: 'welcome';
      id: string;
      team: number;
      sessionToken: string;
      mapData: ChunkData[];
      palette?: number[];
      waterIndices?: number[];
      mapName?: string;
      objectives?: MapObjective[];
      objectPlacements?: import('./voxel-object.js').MapObjectPlacement[];
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
  | { type: 'rockets'; rockets: RocketState[] }
  | { type: 'enemy_spotted'; positions: Vec3[]; duration: number }
  | { type: 'voxel_update'; changes: { x: number; y: number; z: number; material: number }[] }
  | { type: 'destruction_event'; events: DestructionEvent[] }
  | { type: 'chunks'; chunks: ChunkData[] }
  | { type: 'smoke_grenades'; grenades: SmokeGrenadeState[] }
  | { type: 'smoke_deploy'; event: SmokeDeployEvent }
  | { type: 'room_created'; roomCode: string; playerId: string }
  | { type: 'room_joined'; roomCode: string; playerId: string; hostId: string }
  | { type: 'room_error'; message: string }
  | { type: 'lobby_state'; players: LobbyPlayer[]; gameMode: GameMode; hostId: string; roomCode: string; phase: ServerPhase }
  | { type: 'game_starting'; countdown: number }
  | { type: 'return_to_lobby' }
  | { type: 'room_closed' }
  | { type: 'voip_signal'; fromId: string; signal: VoipSignalData }
  | { type: 'voip_proximity'; peers: VoipProximityEntry[] };
