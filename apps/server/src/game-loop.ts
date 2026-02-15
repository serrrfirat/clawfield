import {
  TICK_INTERVAL,
  TICK_RATE,
  CHUNK_SIZE,
  MAT_GRASS,
  MAT_WALL,
  MAT_ROOF,
  getVoxel,
  setVoxel,
  PLAYER_HEIGHT,
  CROUCH_HEIGHT,
  Team,
  TDM_TICKETS,
  RESPAWN_DELAY,
  SPAWN_POINTS,
  ClassId,
  CLASSES,
  WEAPONS,
  aimDirection,
  calcDamage,
  GRENADE_MAX_COUNT,
  GRENADE_COOLDOWN,
  SCOREBOARD_BROADCAST_INTERVAL,
  GADGET_COOLDOWN,
  GADGET_COOLDOWNS,
  STREAM_RADIUS,
  STREAM_ALL_CHUNKS,
  STREAM_CHECK_INTERVAL,
  CONQUEST_VICTORY_POINTS,
  setWaterIndices,
  setGroundAnchors,
  loadPalette,
  GRENADE_DESTRUCTION_RADIUS,
  ROCKET_DESTRUCTION_RADIUS,
  REVIVE_RADIUS,
  REVIVE_TIME,
  REVIVE_TIME_MEDIC,
  REVIVE_HEALTH,
  REVIVE_HEALTH_MEDIC,
  GadgetId,
  WeaponId,
  INCURSION_TIME_LIMIT,
  INCURSION_SCORE_THRESHOLD,
  INCURSION_DIRECTOR_INTERVAL,
  INCURSION_RUBBERBAND_THRESHOLD,
  INCURSION_OBJECTIVE_BONUS,
  INCURSION_OBJECTIVE_DURATION,
  INCURSION_WFC_WIDTH,
  INCURSION_WFC_DEPTH,
  FLASH_GRENADE_MAX_DURATION,
  SUPPRESSION_MAX_DURATION,
  SUPPRESSION_NEAR_MISS_RADIUS,
} from '@clawfield/shared';
import type { ClientMessage, ChunkData, MapObjective, Vec3, SpawnPointOption, GameMode, DirectorEvent, WeatherState, DynamicObjective, HeightGetter, MatchConfig, PlacementCollider } from '@clawfield/shared';
import { createTerrainHeight, DEFAULT_HEIGHTMAP_CONFIG } from '@clawfield/shared';
import { buildHeightmapObstacleDiscs, resolveDiscObstacleCollision } from '@clawfield/shared';
import { NetworkServer, type Client } from './network.js';
import { PlayerSim } from './player-sim.js';
import { DummyBot } from './bot.js';
import { ProjectileManager } from './projectile-manager.js';
import {
  CapturePointManager,
  DEFAULT_CAPTURE_POINTS,
  type CapturePointConfig,
} from './capture-point-manager.js';
import { GrenadeManager, type GrenadeExplosionResult } from './grenade-manager.js';
import { GadgetManager, type VoxelChange } from './gadget-manager.js';
import { RocketManager } from './rocket-manager.js';
import { DestructionManager } from './destruction-manager.js';
import { SmokeGrenadeManager } from './smoke-grenade-manager.js';
import { FlashGrenadeManager } from './flash-grenade-manager.js';
// Dynamic import — Rapier WASM may not load in all environments (e.g. tsx)
let DebrisPhysicsManager: typeof import('./debris-physics-manager.js').DebrisPhysicsManager | null = null;
let initRapier: (() => Promise<void>) | null = null;
let rapierModuleLoaded = false;

import('./debris-physics-manager.js')
  .then(m => { 
    DebrisPhysicsManager = m.DebrisPhysicsManager; 
    initRapier = m.initRapier;
    rapierModuleLoaded = true;
    console.log('[GameLoop] Debris physics module loaded, will initialize on first explosion');
  })
  .catch((e) => { 
    console.warn('[GameLoop] Debris physics unavailable:', e.message);
  });
import {
  loadBinaryMap,
  getConfiguredMapName,
  getDefaultMapMetaPath,
  getDefaultMapPath,
  getChunksInRadius,
  loadMapMetadata,
  loadObjectDefs,
  stampObjectsIntoChunks,
  mergeMapChunks,
} from './map-loader.js';
import { randomUUID } from 'node:crypto';
import { generateIncursionMap } from './wfc-map-generator.js';

/** Eye offset from player feet position */
const EYE_OFFSET = PLAYER_HEIGHT - 0.1; // 1.7

/** How often to broadcast ticket counts (in ticks) */
const TICKET_BROADCAST_INTERVAL = 20; // every 1 second at 20Hz

/** How long to keep a disconnected player's session before cleanup (ms) */
const SESSION_TIMEOUT = 5 * 60 * 1000; // 5 minutes

/** How often to check for stale sessions (in ticks) */
const SESSION_CLEANUP_INTERVAL = 20 * 30; // every 30 seconds
const OUT_OF_BOUNDS_MARGIN = 8;
const OUT_OF_BOUNDS_FALL_DEPTH = 24;
const LAG_COMPENSATION_MS = 0;
const POSITION_HISTORY_WINDOW_MS = 1500;
const TERRAIN_STONE_DESTRUCTIBLE_RADIUS_MIN = 1.0;

/** Lobby player info passed to GameLoop at start */
export interface LobbyPlayerInfo {
  clientId: string;
  name: string;
  team: number;
}

/**
 * Server game loop: fixed-timestep at 20Hz.
 * Manages players, processes inputs, runs physics, validates combat, broadcasts state.
 */
export class GameLoop {
  private network: NetworkServer;
  private players = new Map<string, PlayerSim>();
  private chunks = new Map<string, Uint8Array>();
  private tickCount = 0;
  private bots: DummyBot[] = [];
  private projectileManager = new ProjectileManager();
  private capturePointManager: CapturePointManager;
  private grenadeManager = new GrenadeManager();
  private smokeGrenadeManager = new SmokeGrenadeManager();
  private flashGrenadeManager = new FlashGrenadeManager();
  private gadgetManager = new GadgetManager();
  private rocketManager = new RocketManager();
  private destructionManager!: DestructionManager;
  private debrisPhysicsManager: import('./debris-physics-manager.js').DebrisPhysicsManager | null = null;

  // --- Map palette (hex colors) ---
  private palette: number[] = [];

  // --- Per-client chunk streaming ---
  private sentChunks = new Map<string, Set<string>>();

  // --- Position history for lag compensation ---
  private positionHistory = new Map<string, Array<{ time: number; position: Vec3 }>>();

  // --- Persistent sessions: sessionToken → PlayerSim ---
  private sessions = new Map<string, PlayerSim>();

  // --- Map spawn points (loaded from metadata or discovered) ---
  private mapSpawnsAlpha: Vec3[] = [];
  private mapSpawnsBravo: Vec3[] = [];
  private mapCapturePoints: CapturePointConfig[] = DEFAULT_CAPTURE_POINTS.map((cp) => ({
    ...cp,
    position: { ...cp.position },
  }));
  private mapObjectives: MapObjective[] = [];
  private usingBinaryMap = false;
  private mapName = 'test';
  private mapDisplayName = 'Test';
  private waterIndices: number[] | undefined;
  private objectPlacements: import('@clawfield/shared').MapObjectPlacement[] = [];
  private glbBuildings: { glbPath: string; position: { x: number; y: number; z: number }; rotation?: number }[] = [];
  private worldBounds:
    | { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number }
    | null = null;

  // --- Team & ticket tracking ---
  private ticketsAlpha = TDM_TICKETS;
  private ticketsBravo = TDM_TICKETS;
  private gameOver = false;
  private nextTeam: Team = Team.Alpha;

  // --- Game mode ---
  private gameMode: GameMode = 'tdm';

  // --- Tick timer reference ---
  private tickTimer: ReturnType<typeof setInterval> | null = null;

  // --- Game over callback ---
  private onGameOverCallback: ((winner: number) => void) | null = null;

  // --- Debris physics initialization tracking ---
  private debrisPhysicsInitialized = false;
  private debrisPhysicsInitPromise: Promise<boolean> | null = null;
  // Debris physics enabled by default; set CLAWFIELD_DEBRIS_PHYSICS=0 to disable.
  private readonly debrisPhysicsEnabled = process.env.CLAWFIELD_DEBRIS_PHYSICS !== '0';

  /** Optional map override from lobby selection */
  private mapOverride: string | undefined;
  /** Optional match seed override from lobby */
  private matchSeedOverride: number | undefined;
  /** Optional full match config override from lobby */
  private customMatchConfig: MatchConfig | undefined;

  // --- Heightmap mode (for terrain-only maps without voxel chunks) ---
  heightmapMode = false;
  private terrainHeightGetter: HeightGetter = createTerrainHeight();
  private matchConfig: MatchConfig | null = null;
  private heightmapObstacles: PlacementCollider[] = [];
  private placementColliders: PlacementCollider[] = [];
  private destroyedPlacementColliders = new Set<string>();

  // --- AI Director (deterministic fallback) ---
  private directorCurrentWeather: WeatherState = 'clear';
  private directorNextCheckAt = 0;

  // --- Colyseus Schema integration ---
  /** When true, skip the per-client JSON 'state' broadcast (Schema handles it) */
  suppressStateBroadcast = false;
  /** Called at the end of each tick with the computed player states + tick number */
  onStateComputed: ((players: import('@clawfield/shared').PlayerState[], tick: number) => void) | null = null;

  // --- Incursion mode state ---
  private incursionTimeRemaining = 0;
  private dynamicObjectives: DynamicObjective[] = [];
  private nextObjectiveId = 0;

  constructor(
    network: NetworkServer,
    lobbyPlayers: LobbyPlayerInfo[],
    gameMode: GameMode,
    onGameOver: (winner: number) => void,
    mapOverride?: string,
    matchSeedOverride?: number,
    placementColliders?: PlacementCollider[],
    customMatchConfig?: MatchConfig,
  ) {
    this.network = network;
    this.gameMode = gameMode;
    this.onGameOverCallback = onGameOver;
    this.mapOverride = mapOverride;
    this.matchSeedOverride = matchSeedOverride;
    this.placementColliders = placementColliders ?? [];
    this.customMatchConfig = customMatchConfig;

    // Try to load the configured binary map; fall back to test map
    this.loadMap();
    this.capturePointManager = new CapturePointManager(this.mapCapturePoints);
    this.gadgetManager.setChunks(this.chunks);

    // Bots disabled for testing
    // this.spawnBots();

    // Send welcome to each lobby player
    for (const lp of lobbyPlayers) {
      const client = this.network.getClients().get(lp.clientId);
      if (client) {
        client.name = lp.name;
        this.welcomePlayer(client, lp.team);
      }
    }

    // Initialize Incursion timer
    if (this.gameMode === 'incursion') {
      this.incursionTimeRemaining = INCURSION_TIME_LIMIT;
      this.directorNextCheckAt = Date.now() + 15_000; // faster first check for Incursion
    } else {
      this.directorNextCheckAt = Date.now() + 20_000;
    }

    // Start the game loop
    this.tickTimer = setInterval(() => this.update(), TICK_INTERVAL);
    console.log(`Game loop started at ${1000 / TICK_INTERVAL}Hz (mode: ${gameMode})`);
  }

  /** Send welcome to a player and set them up in the game */
  private welcomePlayer(client: Client, team: number): void {
    const classId = ClassId.Assault;
    const tempPos = this.getSpawnPoint(team);
    const sim = new PlayerSim(client.id, client.name, tempPos);
    sim.team = team;
    sim.selectClass(classId);
    sim.alive = false;
    sim.waitingToDeploy = true;
    this.players.set(client.id, sim);

    // Determine initial chunks to send
    const spawnCx = Math.floor(tempPos.x / CHUNK_SIZE);
    const spawnCy = Math.floor(tempPos.y / CHUNK_SIZE);
    const spawnCz = Math.floor(tempPos.z / CHUNK_SIZE);
    const nearbyKeys = STREAM_ALL_CHUNKS
      ? Array.from(this.chunks.keys())
      : getChunksInRadius(spawnCx, spawnCy, spawnCz, STREAM_RADIUS);

    const mapData: ChunkData[] = [];
    const clientSent = new Set<string>();

    for (const key of nearbyKeys) {
      const voxels = this.chunks.get(key);
      if (voxels) {
        mapData.push({ key, voxels: Array.from(voxels) });
        clientSent.add(key);
      }
    }

    this.sentChunks.set(client.id, clientSent);

    this.network.send(client, {
      type: 'welcome',
      id: client.id,
      team,
      mapData,
      weather: this.directorCurrentWeather,
      palette: this.palette.length > 0 ? this.palette : undefined,
      waterIndices: this.waterIndices,
      mapBounds: this.worldBounds ?? undefined,
      mapName: this.mapDisplayName,
      objectives: this.mapObjectives,
      objectPlacements: this.objectPlacements.length > 0 ? this.objectPlacements : undefined,
      glbBuildings: this.glbBuildings.length > 0 ? this.glbBuildings : undefined,
      matchConfig: this.heightmapMode ? (this.matchConfig ?? undefined) : undefined,
      placementColliders: this.placementColliders.length > 0 ? this.placementColliders : undefined,
      destroyedPlacementColliders:
        this.destroyedPlacementColliders.size > 0
          ? Array.from(this.destroyedPlacementColliders)
          : undefined,
      obstacleDiscs: this.heightmapMode ? this.heightmapObstacles : undefined,
      gameMode: this.gameMode,
    });

    // Send available spawns for the deploy screen
    this.network.send(client, {
      type: 'available_spawns',
      spawns: this.getAvailableSpawns(team),
    });

    // Notify other players
    this.network.broadcastExcept(client.id, {
      type: 'player_joined',
      id: client.id,
      name: client.name,
      team,
    });

    // Notify new player about existing players
    for (const [id, player] of this.players) {
      if (id !== client.id) {
        this.network.send(client, {
          type: 'player_joined',
          id,
          name: player.name,
          team: player.team,
        });
      }
    }

    // Send current ticket state
    this.network.send(client, {
      type: 'tickets',
      alpha: this.ticketsAlpha,
      bravo: this.ticketsBravo,
    });

    // Send capture point state
    this.network.send(client, {
      type: 'capture_points',
      points: this.capturePointManager.getStates(),
    });
    const scores = this.capturePointManager.getScores();
    this.network.send(client, {
      type: 'conquest_score',
      alpha: scores.alpha,
      bravo: scores.bravo,
    });

    // Send Incursion state to joining players
    if (this.gameMode === 'incursion') {
      this.network.send(client, {
        type: 'match_timer',
        timeRemaining: this.incursionTimeRemaining,
        timeLimit: INCURSION_TIME_LIMIT,
      });
      const active = this.dynamicObjectives.filter(o => !o.completed && o.timeRemaining > 0);
      if (active.length > 0) {
        this.network.send(client, {
          type: 'dynamic_objectives',
          objectives: active,
        });
      }
    }

    console.log(`Player joined game: ${client.name} (${client.id}) - Team ${team === Team.Alpha ? 'Alpha' : 'Bravo'}`);
  }

  /** Stop the game loop and clean up all state */
  destroy(): void {
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
    this.players.clear();
    this.bots = [];
    this.projectileManager = new ProjectileManager();
    this.grenadeManager = new GrenadeManager();
    this.smokeGrenadeManager = new SmokeGrenadeManager();
    this.flashGrenadeManager = new FlashGrenadeManager();
    this.rocketManager = new RocketManager();
    this.gadgetManager = new GadgetManager();
    this.sentChunks.clear();
    this.positionHistory.clear();
    this.gameOver = true;
    console.log('GameLoop destroyed');
  }

  /** Always use procedural heightmap terrain — voxels are deprecated */
  private loadMap(): void {
    this.activateHeightmapMode();
  }

  /** Activate heightmap mode using the default match config */
  private activateHeightmapMode(): void {
    const cfg: MatchConfig = this.customMatchConfig
      ? {
          ...DEFAULT_HEIGHTMAP_CONFIG,
          ...this.customMatchConfig,
          terrain: {
            ...DEFAULT_HEIGHTMAP_CONFIG.terrain,
            ...this.customMatchConfig.terrain,
          },
          bounds: {
            ...DEFAULT_HEIGHTMAP_CONFIG.bounds,
            ...this.customMatchConfig.bounds,
          },
          spawns: {
            alpha: this.customMatchConfig.spawns?.alpha?.length ? this.customMatchConfig.spawns.alpha : DEFAULT_HEIGHTMAP_CONFIG.spawns.alpha,
            bravo: this.customMatchConfig.spawns?.bravo?.length ? this.customMatchConfig.spawns.bravo : DEFAULT_HEIGHTMAP_CONFIG.spawns.bravo,
          },
          seed: this.customMatchConfig.seed ?? this.matchSeedOverride ?? DEFAULT_HEIGHTMAP_CONFIG.seed,
        }
      : {
          ...DEFAULT_HEIGHTMAP_CONFIG,
          seed: this.matchSeedOverride ?? DEFAULT_HEIGHTMAP_CONFIG.seed,
        };
    this.matchConfig = cfg;
    this.heightmapMode = true;
    this.destroyedPlacementColliders.clear();
    this.terrainHeightGetter = createTerrainHeight(
      cfg.terrain.scale,
      cfg.terrain.amplitude,
      cfg.seed,
      cfg.heightmap,
    );
    this.heightmapObstacles = [
      ...buildHeightmapObstacleDiscs(cfg).map((disc, i) => ({
        id: `terrain-${i}`,
        x: disc.x,
        z: disc.z,
        r: disc.r,
        destructible: disc.r >= TERRAIN_STONE_DESTRUCTIBLE_RADIUS_MIN,
      })),
      ...this.placementColliders,
    ];

    // Resolve spawn Y values from terrain height
    this.mapSpawnsAlpha = cfg.spawns.alpha.map((s) => ({
      x: s.x,
      y: this.terrainHeightGetter(s.x, s.z) + 0.5,
      z: s.z,
    }));
    this.mapSpawnsBravo = cfg.spawns.bravo.map((s) => ({
      x: s.x,
      y: this.terrainHeightGetter(s.x, s.z) + 0.5,
      z: s.z,
    }));

    this.worldBounds = {
      minX: cfg.bounds.minX,
      maxX: cfg.bounds.maxX,
      minY: -50,
      maxY: 100,
      minZ: cfg.bounds.minZ,
      maxZ: cfg.bounds.maxZ,
    };

    // No voxel data
    this.chunks = new Map();
    this.usingBinaryMap = false;
    this.mapName = 'heightmap';
    this.mapDisplayName = 'Heightmap';
    this.mapObjectives = [];
    this.palette = [];

    // Initialize destruction manager (required but no-op in heightmap mode)
    if (!this.destructionManager) {
      this.destructionManager = new DestructionManager(this.chunks, null as any);
    }

    console.log('[GameLoop] Heightmap mode activated');
  }



  /**
   * Initialize the debris physics system.
   * Creates the physics manager and links it to the destruction manager.
   * Returns true if successfully initialized, false if not ready yet.
   */
  private async initializeDebrisPhysics(): Promise<boolean> {
    if (this.debrisPhysicsInitialized) {
      return true;
    }

    if (!this.debrisPhysicsEnabled) {
      if (!this.destructionManager) {
        this.destructionManager = new DestructionManager(this.chunks, null as any);
      }
      this.debrisPhysicsInitialized = true;
      return true;
    }

    if (this.debrisPhysicsInitPromise) {
      return this.debrisPhysicsInitPromise;
    }

    this.debrisPhysicsInitPromise = (async () => {

      // Check if module is loaded
      if (!rapierModuleLoaded || !DebrisPhysicsManager || !initRapier) {
        // Module not loaded yet - create destruction manager without physics for now
        if (!this.destructionManager) {
          this.destructionManager = new DestructionManager(this.chunks, null as any);
          console.log('⏳ Debris physics module not loaded yet...');
        }
        return false;
      }

      // Cleanup existing if any
      if (this.debrisPhysicsManager) {
        this.debrisPhysicsManager.dispose();
      }

      // Try to create debris physics manager
      try {
        // Initialize Rapier WASM first
        await initRapier();
      
        // Now create the physics manager
        this.debrisPhysicsManager = new DebrisPhysicsManager((x, y, z) =>
          getVoxel(this.chunks, x, y, z)
        );
      
        // If we already have a destruction manager, just update it with the physics manager
        // This preserves any pending debris bodies
        if (this.destructionManager) {
          this.destructionManager.setDebrisPhysics(this.debrisPhysicsManager);
          console.log('✓ Debris physics system initialized (linked to existing destruction manager)');
        } else {
          this.destructionManager = new DestructionManager(this.chunks, this.debrisPhysicsManager);
          console.log('✓ Debris physics system initialized');
        }
      
        this.debrisPhysicsInitialized = true;
        return true;
      } catch (e) {
        console.error('✗ Failed to initialize debris physics:', e);
        this.debrisPhysicsManager = null;
        if (!this.destructionManager) {
          this.destructionManager = new DestructionManager(this.chunks, null as any);
        }
        this.debrisPhysicsInitialized = true; // Don't keep retrying on error
        return true;
      }
    })();

    try {
      return await this.debrisPhysicsInitPromise;
    } finally {
      this.debrisPhysicsInitPromise = null;
    }
  }

  private tryLoadMap(mapName: string): boolean {
    const mapPath = getDefaultMapPath(mapName);
    const mapData = loadBinaryMap(mapPath);
    if (!mapData) {
      return false;
    }

    this.chunks = mapData.chunks;
    void this.initializeDebrisPhysics();
    this.palette = mapData.palette;
    if (mapData.palette.length > 0) {
      loadPalette(mapData.palette);
    }
    this.usingBinaryMap = true;
    this.mapName = mapName;
    this.mapDisplayName = mapName;

    // Reset per-map state before metadata/discovery.
    this.mapSpawnsAlpha = [];
    this.mapSpawnsBravo = [];
    this.mapCapturePoints = DEFAULT_CAPTURE_POINTS.map((cp) => ({
      ...cp,
      position: { ...cp.position },
    }));
    this.mapObjectives = [];

    const mapMetaPath = getDefaultMapMetaPath(mapName);
    const metadata = loadMapMetadata(mapMetaPath);
    if (metadata) {
      this.mapDisplayName = metadata.name;
      this.mapSpawnsAlpha = metadata.spawnPoints.alpha.map((sp) => ({ ...sp }));
      this.mapSpawnsBravo = metadata.spawnPoints.bravo.map((sp) => ({ ...sp }));
      if (metadata.capturePoints.length > 0) {
        this.mapCapturePoints = metadata.capturePoints.map((cp) => ({
          id: cp.id,
          position: { ...cp.position },
          initialOwner: cp.initialOwner,
        }));
      }
      this.mapObjectives = metadata.objectives.map((obj) => ({
        id: obj.id,
        type: obj.type,
        position: { ...obj.position },
      }));
      if (metadata.waterIndices) {
        this.waterIndices = metadata.waterIndices;
        setWaterIndices(metadata.waterIndices);
      }
      if (metadata.groundIndices) {
        setGroundAnchors(metadata.groundIndices);
      }
      console.log(
        `Loaded map metadata for "${metadata.name}": ` +
          `${this.mapSpawnsAlpha.length} alpha spawns, ` +
          `${this.mapSpawnsBravo.length} bravo spawns, ` +
          `${this.mapCapturePoints.length} capture points, ` +
          `${this.mapObjectives.length} objectives`
      );
    } else {
      this.discoverSpawnPoints();
      console.warn(
        `WARNING: No valid metadata found at ${mapMetaPath}; using discovered spawn points`
      );
    }

    // Load and stamp voxel objects for collision
    this.objectPlacements = [];
    if (metadata?.objects && metadata.objects.length > 0) {
      const defs = loadObjectDefs(metadata.objects);
      if (defs.size > 0) {
        const stamped = stampObjectsIntoChunks(this.chunks, defs, metadata.objects);
        this.objectPlacements = metadata.objects;
        console.log(
          `[VoxelObjects] Placed ${metadata.objects.length} objects ` +
            `(${defs.size} types, ${stamped} collision voxels stamped)`
        );
      }
    }

    // Merge GLB building voxel collision data
    this.glbBuildings = [];
    const buildingsMapPath = getDefaultMapPath('city-buildings');
    const buildingsData = loadBinaryMap(buildingsMapPath);
    if (buildingsData) {
      // Source center: approx (-40, 16, -152) from voxelized bounds
      // Target: voxel coords (-100, 3, -167) = Hotel area
      // Offset: target - source = (-100-(-40), 3-16, -167-(-152)) = (-60, -13, -15)
      const offsetX = -60;
      const offsetY = -13;
      const offsetZ = -15;
      const stamped = mergeMapChunks(this.chunks, buildingsData.chunks, offsetX, offsetY, offsetZ);

      // Convert voxel position to world coords for client rendering
      const VOXEL_SIZE = 0.5;
      this.glbBuildings.push({
        glbPath: '/models/buildings.glb',
        position: {
          x: -100 * VOXEL_SIZE,
          y: 3 * VOXEL_SIZE,
          z: -167 * VOXEL_SIZE,
        },
      });
      console.log(`[GlbBuildings] Merged city-buildings.map: ${stamped} collision voxels stamped at offset (${offsetX}, ${offsetY}, ${offsetZ})`);
    }

    console.log(`${this.mapName} map loaded: ${this.chunks.size} chunks`);
    this.worldBounds = this.getChunkWorldBounds();
    return true;
  }

  private processOutOfBounds(): void {
    if (!this.worldBounds) return;

    for (const sim of this.players.values()) {
      if (!sim.alive) continue;

      const outOfX = sim.position.x < this.worldBounds.minX - OUT_OF_BOUNDS_MARGIN
        || sim.position.x > this.worldBounds.maxX + OUT_OF_BOUNDS_MARGIN;
      const outOfZ = sim.position.z < this.worldBounds.minZ - OUT_OF_BOUNDS_MARGIN
        || sim.position.z > this.worldBounds.maxZ + OUT_OF_BOUNDS_MARGIN;
      const belowWorld = sim.position.y < this.worldBounds.minY - OUT_OF_BOUNDS_FALL_DEPTH;

      if (!outOfX && !outOfZ && !belowWorld) continue;

      sim.alive = false;
      sim.downed = false;
      sim.health = 0;
      sim.deathTime = Date.now();
      sim.deaths++;

      this.network.broadcast({
        type: 'kill',
        entry: {
          killerId: sim.id,
          killerName: sim.name,
          victimId: sim.id,
          victimName: sim.name,
          weapon: 'Out of Bounds',
        },
      });

      const victimClient = this.network.getClients().get(sim.id);
      if (victimClient) {
        this.network.send(victimClient, {
          type: 'death',
          killerId: '',
          respawnTime: RESPAWN_DELAY,
          killerPos: { ...sim.position },
        });
      }
    }
  }

  /**
   * Scan the currently loaded map to find valid spawn positions.
   * Picks ~6 spread-out positions in the center area of the map.
   * Splits into Alpha (west half) and Bravo (east half).
   */
  private discoverSpawnPoints(): void {
    const bounds = this.getChunkWorldBounds();
    if (!bounds) {
      this.mapSpawnsAlpha = [];
      this.mapSpawnsBravo = [];
      return;
    }

    const centerX = (bounds.minX + bounds.maxX) / 2;
    const centerZ = (bounds.minZ + bounds.maxZ) / 2;
    const spreadX = Math.max(24, Math.floor((bounds.maxX - bounds.minX + 1) * 0.35));
    const spreadZ = Math.max(24, Math.floor((bounds.maxZ - bounds.minZ + 1) * 0.35));

    // Sample positions across the map
    const samplePositions: Array<{ wx: number; wz: number }> = [];
    const gridStepX = (spreadX * 2) / 3; // 4 steps across X
    const gridStepZ = (spreadZ * 2) / 2; // 3 steps across Z

    for (let gx = 0; gx < 4; gx++) {
      for (let gz = 0; gz < 3; gz++) {
        const wx = Math.floor(
          Math.max(
            bounds.minX,
            Math.min(bounds.maxX, centerX - spreadX + gx * gridStepX + gridStepX / 2)
          )
        );
        const wz = Math.floor(
          Math.max(
            bounds.minZ,
            Math.min(bounds.maxZ, centerZ - spreadZ + gz * gridStepZ + gridStepZ / 2)
          )
        );
        samplePositions.push({ wx, wz });
      }
    }

    // For each sample position, find the highest solid voxel (ground level)
    const validSpawns: Vec3[] = [];
    for (const { wx, wz } of samplePositions) {
      const groundY = this.findGroundLevel(wx, wz, bounds.minY - 64, bounds.maxY + 64);
      if (groundY !== null) {
        validSpawns.push({ x: wx, y: groundY + 2, z: wz });
      }
    }

    if (validSpawns.length === 0) {
      console.warn('WARNING: No valid spawn points discovered on map, using fallback positions');
      const fallbackY = Math.max(2, Math.floor((bounds.minY + bounds.maxY) / 2) + 2);
      this.mapSpawnsAlpha = [
        { x: Math.floor(centerX - spreadX * 0.6), y: fallbackY, z: Math.floor(centerZ - 8) },
        { x: Math.floor(centerX - spreadX * 0.5), y: fallbackY, z: Math.floor(centerZ + 8) },
      ];
      this.mapSpawnsBravo = [
        { x: Math.floor(centerX + spreadX * 0.6), y: fallbackY, z: Math.floor(centerZ - 8) },
        { x: Math.floor(centerX + spreadX * 0.5), y: fallbackY, z: Math.floor(centerZ + 8) },
      ];
      return;
    }

    // Sort by X coordinate and split into west (Alpha) and east (Bravo) halves
    validSpawns.sort((a, b) => a.x - b.x);
    const midIndex = Math.floor(validSpawns.length / 2);

    this.mapSpawnsAlpha = validSpawns.slice(0, midIndex);
    this.mapSpawnsBravo = validSpawns.slice(midIndex);

    // Ensure at least one spawn per team
    if (this.mapSpawnsAlpha.length === 0 && validSpawns.length > 0) {
      this.mapSpawnsAlpha = [validSpawns[0]];
    }
    if (this.mapSpawnsBravo.length === 0 && validSpawns.length > 0) {
      this.mapSpawnsBravo = [validSpawns[validSpawns.length - 1]];
    }

    console.log(
      `  Spawn points discovered: Alpha=${this.mapSpawnsAlpha.length}, Bravo=${this.mapSpawnsBravo.length}`
    );
    for (const sp of this.mapSpawnsAlpha) {
      console.log(`    Alpha: (${sp.x}, ${sp.y}, ${sp.z})`);
    }
    for (const sp of this.mapSpawnsBravo) {
      console.log(`    Bravo: (${sp.x}, ${sp.y}, ${sp.z})`);
    }
  }

  private getChunkWorldBounds():
    | { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number }
    | null {
    if (this.chunks.size === 0) {
      return null;
    }

    let minCx = Infinity;
    let minCy = Infinity;
    let minCz = Infinity;
    let maxCx = -Infinity;
    let maxCy = -Infinity;
    let maxCz = -Infinity;

    for (const key of this.chunks.keys()) {
      const [cx, cy, cz] = key.split(',').map(Number);
      if (!Number.isFinite(cx) || !Number.isFinite(cy) || !Number.isFinite(cz)) continue;
      if (cx < minCx) minCx = cx;
      if (cy < minCy) minCy = cy;
      if (cz < minCz) minCz = cz;
      if (cx > maxCx) maxCx = cx;
      if (cy > maxCy) maxCy = cy;
      if (cz > maxCz) maxCz = cz;
    }

    if (!Number.isFinite(minCx)) {
      return null;
    }

    return {
      minX: minCx * CHUNK_SIZE,
      maxX: (maxCx + 1) * CHUNK_SIZE - 1,
      minY: minCy * CHUNK_SIZE,
      maxY: (maxCy + 1) * CHUNK_SIZE - 1,
      minZ: minCz * CHUNK_SIZE,
      maxZ: (maxCz + 1) * CHUNK_SIZE - 1,
    };
  }

  /**
   * Find the highest Y coordinate with a solid voxel at the given world X, Z.
   * Scans from maxY downward. Returns the Y of the ground, or null if no ground found.
   */
  private findGroundLevel(wx: number, wz: number, minY = -500, maxY = 500): number | null {
    // Scan downward to find the highest solid voxel.
    for (let wy = maxY; wy >= minY; wy--) {
      if (getVoxel(this.chunks, wx, wy, wz) !== 0) {
        return wy;
      }
    }
    return null;
  }

  private generateTestMap(): void {
    const mapWidth = 8;
    const mapDepth = 8;

    for (let cx = 0; cx < mapWidth; cx++) {
      for (let cz = 0; cz < mapDepth; cz++) {
        for (let x = 0; x < CHUNK_SIZE; x++) {
          for (let z = 0; z < CHUNK_SIZE; z++) {
            const wx = cx * CHUNK_SIZE + x;
            const wz = cz * CHUNK_SIZE + z;
            setVoxel(this.chunks, wx, 0, wz, MAT_GRASS);
          }
        }
      }
    }

    this.makeBuilding(20, 1, 20, 8, 6, 8);
    this.makeBuilding(50, 1, 30, 6, 4, 10);
    this.makeBuilding(80, 1, 70, 10, 5, 6);
  }

  private makeBuilding(
    startX: number, startY: number, startZ: number,
    sizeX: number, sizeY: number, sizeZ: number
  ): void {
    for (let x = startX; x < startX + sizeX; x++) {
      for (let y = startY; y < startY + sizeY; y++) {
        for (let z = startZ; z < startZ + sizeZ; z++) {
          const isWallX = x === startX || x === startX + sizeX - 1;
          const isWallZ = z === startZ || z === startZ + sizeZ - 1;
          const isFloor = y === startY;
          const isRoof = y === startY + sizeY - 1;

          if (isRoof) {
            setVoxel(this.chunks, x, y, z, MAT_ROOF);
          } else if (isFloor) {
            setVoxel(this.chunks, x, y, z, MAT_WALL);
          } else if (isWallX || isWallZ) {
            const doorMinX = startX + Math.floor(sizeX / 2) - 1;
            const doorMaxX = doorMinX + 2;
            const doorMaxY = startY + 3;
            const isDoor = z === startZ && x >= doorMinX && x < doorMaxX && y < doorMaxY;
            if (!isDoor) {
              setVoxel(this.chunks, x, y, z, MAT_WALL);
            }
          }
        }
      }
    }
  }

  /** Spawn dummy bots and register them in the player list.
   *  Fills a 24v24 match: 23 bots per team (human player fills the last slot). */
  private spawnBots(): void {
    const BOTS_PER_TEAM = this.heightmapMode ? 11 : 23;
    const totalBots = BOTS_PER_TEAM * 2;

    for (let i = 0; i < totalBots; i++) {
      const team = i < BOTS_PER_TEAM ? Team.Alpha : Team.Bravo;
      const idx = i + 1;
      const id = `bot${idx}`;
      const name = `Bot_${idx}`;
      const spawnPos = this.getSpawnPoint(team);
      const bot = new DummyBot(id, name, team, spawnPos);
      this.bots.push(bot);
      this.players.set(bot.sim.id, bot.sim);
    }
    console.log(`Spawned ${totalBots} bots (${BOTS_PER_TEAM} per team)`);
  }

  // --- Team assignment ---

  private assignTeam(): Team {
    const team = this.nextTeam;
    this.nextTeam = team === Team.Alpha ? Team.Bravo : Team.Alpha;
    return team;
  }

  private getSpawnPoint(_team: Team): Vec3 {
    // DEV: force all players to same spot for testing visibility
    const y = this.heightmapMode ? this.terrainHeightGetter(22, 12) + 0.5 : 2;
    return { x: 22, y, z: 12 };
  }

  /** Get all available spawn points for a team as options for the deploy screen */
  private getAvailableSpawns(team: Team): SpawnPointOption[] {
    const options: SpawnPointOption[] = [];

    // Base spawns
    if (this.usingBinaryMap) {
      const baseSpawns = team === Team.Alpha ? this.mapSpawnsAlpha : this.mapSpawnsBravo;
      if (baseSpawns.length > 0) {
        options.push({
          id: 'base',
          name: team === Team.Alpha ? 'Alpha Base' : 'Bravo Base',
          position: baseSpawns[Math.floor(Math.random() * baseSpawns.length)],
          type: 'base',
        });
      }
    } else {
      const fallbackSpawns = SPAWN_POINTS[team];
      if (fallbackSpawns.length > 0) {
        options.push({
          id: 'base',
          name: team === Team.Alpha ? 'Alpha Base' : 'Bravo Base',
          position: fallbackSpawns[Math.floor(Math.random() * fallbackSpawns.length)],
          type: 'base',
        });
      }
    }

    // Capture point spawns (owned flags)
    const captureStates = this.capturePointManager.getStates();
    for (const cp of captureStates) {
      if (cp.owner === team) {
        options.push({
          id: cp.id,
          name: cp.id.toUpperCase(),
          position: cp.position,
          type: 'flag',
        });
      }
    }

    return options;
  }

  /** Resolve a spawn point ID to a position */
  private resolveSpawnPoint(team: Team, spawnPointId: string): Vec3 {
    if (spawnPointId === 'base') {
      // DEV: force all players to same spot for testing visibility
      const y = this.heightmapMode ? this.terrainHeightGetter(22, 12) + 0.5 : 2;
      return { x: 22, y, z: 12 };
    }

    // Try capture point
    const captureSpawns = this.capturePointManager.getSpawnPoints(team);
    // Find the matching capture point
    const captureStates = this.capturePointManager.getStates();
    const match = captureStates.find(cp => cp.id === spawnPointId && cp.owner === team);
    if (match) {
      return { ...match.position };
    }

    // Fallback to any available spawn
    return this.getSpawnPoint(team);
  }

  // --- Connection handlers (public so RoomManager can delegate) ---

  handleConnect(_client: Client): void {
    // No-op; players are set up via welcomePlayer in the constructor
  }

  /** Allow a player to join an in-progress game (called by RoomManager for late joiners) */
  hotJoinPlayer(client: Client, name: string, team: number): void {
    client.name = name;
    this.welcomePlayer(client, team);
  }

  /** Get a PlayerSim by client ID (used by BattleRoom for ack seq) */
  getPlayerSim(clientId: string): PlayerSim | undefined {
    return this.players.get(clientId);
  }

  /** Get current capture point states */
  getCapturePoints() {
    return this.capturePointManager.getStates();
  }

  /** Get current conquest scores */
  getConquestScores() {
    return this.capturePointManager.getScores();
  }

  /** Get current ticket counts */
  getTickets() {
    return { alpha: this.ticketsAlpha, bravo: this.ticketsBravo };
  }

  handleMessage(client: Client, msg: ClientMessage): void {
    switch (msg.type) {
      case 'rejoin': {
        const sim = this.sessions.get(msg.sessionToken);
        if (!sim || !sim.disconnected) {
          // Invalid or expired session — tell client to do a fresh join
          // (client will handle this by showing the menu again)
          console.log(`Rejoin failed for token ${msg.sessionToken.slice(0, 8)}... — session not found or not disconnected`);
          break;
        }

        // Remove old player entry (keyed by old client ID)
        this.players.delete(sim.id);

        // Reassign the network client to use the old player's ID
        this.network.reassignClientId(client, sim.id);

        // Restore session
        sim.disconnected = false;
        sim.disconnectTime = 0;
        sim.alive = false;
        sim.waitingToDeploy = true;
        client.name = sim.name;

        // Re-register in players map under the original ID
        this.players.set(sim.id, sim);

        this.sendWelcomeState(client, sim);

        console.log(`Player rejoined: ${sim.name} (${sim.id}) - Team ${sim.team === Team.Alpha ? 'Alpha' : 'Bravo'} - K:${sim.kills}/D:${sim.deaths}/A:${sim.assists}`);
        break;
      }

      case 'input': {
        const sim = this.players.get(client.id);
        if (sim) {
          sim.queueInput(msg.seq, msg.input, msg.dt);
          // DEV: log first few inputs + position every 100 ticks
          if (msg.seq <= 3 || msg.seq % 100 === 0) {
            console.log(`[INPUT] ${sim.name} seq=${msg.seq} alive=${sim.alive} pos=(${sim.position.x.toFixed(1)},${sim.position.y.toFixed(1)},${sim.position.z.toFixed(1)}) fwd=${msg.input.forward}`);
          }
        } else {
          console.warn(`[INPUT] No sim for client ${client.id}`);
        }
        break;
      }

      case 'select_class': {
        const sim = this.players.get(client.id);
        if (sim) {
          const classId = (Object.values(ClassId).includes(msg.classId as ClassId))
            ? msg.classId as ClassId
            : ClassId.Assault;
          sim.selectClass(classId);
          console.log(`Player ${sim.name} switched to ${classId}`);
        }
        break;
      }

      case 'deploy': {
        const sim = this.players.get(client.id);
        if (!sim || !sim.waitingToDeploy) break;

        const classId = (Object.values(ClassId).includes(msg.classId as ClassId))
          ? msg.classId as ClassId
          : ClassId.Assault;

        sim.selectClass(classId, msg.weaponId);
        const spawnPos = this.resolveSpawnPoint(sim.team, msg.spawnPointId);
        sim.respawn(spawnPos);
        sim.waitingToDeploy = false;

        this.network.send(client, {
          type: 'respawn',
          position: spawnPos,
        });

        console.log(`DEPLOY: ${sim.name} as ${classId} with ${msg.weaponId} at ${msg.spawnPointId}`);
        break;
      }
    }
  }

  handleDisconnect(client: Client): void {
    // Only remove real players, not bots
    const isBot = this.bots.some((b) => b.sim.id === client.id);

    if (!isBot) {
      const sim = this.players.get(client.id);
      if (sim) {
        // Mark as disconnected instead of removing — session persists
        sim.disconnected = true;
        sim.disconnectTime = Date.now();

        // Kill the player cleanly so they don't remain as a ghost in the world
        if (sim.alive || sim.downed) {
          sim.alive = false;
          sim.downed = false;
          sim.deathTime = Date.now();
        }
        sim.waitingToDeploy = false;

        console.log(`Player disconnected (session kept): ${sim.name} (${client.id}) - K:${sim.kills}/D:${sim.deaths}/A:${sim.assists}`);
      }
    }

    // Clean up chunk streaming state
    this.sentChunks.delete(client.id);
    this.positionHistory.delete(client.id);

    this.network.broadcast({
      type: 'player_left',
      id: client.id,
    });
  }

  /**
   * Send welcome message and current game state to a client.
   * Used for both initial join and rejoin.
   */
  private sendWelcomeState(client: Client, sim: PlayerSim): void {
    // Determine initial chunks to send (within STREAM_RADIUS of player position)
    const pos = sim.position;
    const spawnCx = Math.floor(pos.x / CHUNK_SIZE);
    const spawnCy = Math.floor(pos.y / CHUNK_SIZE);
    const spawnCz = Math.floor(pos.z / CHUNK_SIZE);
    const nearbyKeys = STREAM_ALL_CHUNKS
      ? Array.from(this.chunks.keys())
      : getChunksInRadius(spawnCx, spawnCy, spawnCz, STREAM_RADIUS);

    const mapData: ChunkData[] = [];
    const clientSent = new Set<string>();

    for (const key of nearbyKeys) {
      const voxels = this.chunks.get(key);
      if (voxels) {
        mapData.push({ key, voxels: Array.from(voxels) });
        clientSent.add(key);
      }
    }

    this.sentChunks.set(client.id, clientSent);

    this.network.send(client, {
      type: 'welcome',
      id: sim.id,
      team: sim.team,
      sessionToken: sim.sessionToken,
      mapData,
      weather: this.directorCurrentWeather,
      palette: this.palette.length > 0 ? this.palette : undefined,
      waterIndices: this.waterIndices,
      mapName: this.mapDisplayName,
      objectives: this.mapObjectives,
      objectPlacements: this.objectPlacements.length > 0 ? this.objectPlacements : undefined,
      glbBuildings: this.glbBuildings.length > 0 ? this.glbBuildings : undefined,
      matchConfig: this.heightmapMode ? (this.matchConfig ?? undefined) : undefined,
      placementColliders: this.placementColliders.length > 0 ? this.placementColliders : undefined,
      destroyedPlacementColliders:
        this.destroyedPlacementColliders.size > 0
          ? Array.from(this.destroyedPlacementColliders)
          : undefined,
      obstacleDiscs: this.heightmapMode ? this.heightmapObstacles : undefined,
      gameMode: this.gameMode,
    });

    // Send available spawns for the deploy screen
    this.network.send(client, {
      type: 'available_spawns',
      spawns: this.getAvailableSpawns(sim.team),
    });

    // Notify other players
    this.network.broadcastExcept(client.id, {
      type: 'player_joined',
      id: sim.id,
      name: sim.name,
      team: sim.team,
    });

    // Notify this player about existing connected players
    for (const [id, player] of this.players) {
      if (id !== sim.id && !player.disconnected) {
        this.network.send(client, {
          type: 'player_joined',
          id,
          name: player.name,
          team: player.team,
        });
      }
    }

    // Send current ticket state
    this.network.send(client, {
      type: 'tickets',
      alpha: this.ticketsAlpha,
      bravo: this.ticketsBravo,
    });

    // Send capture point state
    this.network.send(client, {
      type: 'capture_points',
      points: this.capturePointManager.getStates(),
    });
    const scores = this.capturePointManager.getScores();
    this.network.send(client, {
      type: 'conquest_score',
      alpha: scores.alpha,
      bravo: scores.bravo,
    });

    // Send Incursion state on rejoin
    if (this.gameMode === 'incursion') {
      this.network.send(client, {
        type: 'match_timer',
        timeRemaining: this.incursionTimeRemaining,
        timeLimit: INCURSION_TIME_LIMIT,
      });
      const active = this.dynamicObjectives.filter(o => !o.completed && o.timeRemaining > 0);
      if (active.length > 0) {
        this.network.send(client, {
          type: 'dynamic_objectives',
          objectives: active,
        });
      }
    }
  }

  // --- Main update loop ---

  private recordPositionHistory(now: number): void {
    const cutoff = now - POSITION_HISTORY_WINDOW_MS;

    for (const sim of this.players.values()) {
      let history = this.positionHistory.get(sim.id);
      if (!history) {
        history = [];
        this.positionHistory.set(sim.id, history);
      }

      history.push({ time: now, position: { ...sim.position } });

      while (history.length > 2 && history[0].time < cutoff) {
        history.shift();
      }
    }

    // Cleanup for players no longer tracked.
    for (const playerId of this.positionHistory.keys()) {
      if (!this.players.has(playerId)) {
        this.positionHistory.delete(playerId);
      }
    }
  }

  private getPlayerPositionAt(playerId: string, targetTimeMs: number): Vec3 | undefined {
    const history = this.positionHistory.get(playerId);
    if (!history || history.length === 0) return undefined;

    let best = history[0];
    for (let i = 1; i < history.length; i++) {
      const sample = history[i];
      if (sample.time <= targetTimeMs) {
        best = sample;
      } else {
        break;
      }
    }

    return best.position;
  }

  private update(): void {
    if (this.gameOver) return;

    this.tickCount++;
    const now = Date.now();

    // Try to initialize debris physics if not ready yet (dynamic import may have loaded)
    if (!this.debrisPhysicsInitialized) {
      void this.initializeDebrisPhysics();
    }

    // In heightmap mode, provide a voxel shim that treats terrain as solid
    const voxelGetter = this.heightmapMode
      ? (wx: number, wy: number, wz: number) => {
          const terrainY = this.terrainHeightGetter(wx, wz);
          return wy < terrainY ? 1 : 0;
        }
      : (wx: number, wy: number, wz: number) =>
          getVoxel(this.chunks, wx, wy, wz);

    // --- Chunk streaming: send new chunks to players as they move ---
    if (this.tickCount % STREAM_CHECK_INTERVAL === 0) {
      this.streamChunksToClients();
    }

    // Update bots — generates and queues their fake inputs
    for (const bot of this.bots) {
      bot.update(TICK_INTERVAL / 1000, this.players);
    }

    // Process all player inputs (movement, reload)
    for (const sim of this.players.values()) {
      if (this.heightmapMode) {
        sim.tickHeightmap(this.terrainHeightGetter);
        sim.position = resolveDiscObstacleCollision(sim.position, 0.4, this.heightmapObstacles);
      } else {
        sim.tick(voxelGetter, this.debrisPhysicsManager ?? undefined);
      }
    }

    // Record a rolling position history after movement simulation.
    this.recordPositionHistory(now);

    // Kill players who leave the loaded world bounds or fall into the void.
    this.processOutOfBounds();

    // Reset per-tick firing flag (used for remote gunshot sounds)
    for (const sim of this.players.values()) {
      sim.firedThisTick = false;
    }

    // Process shooting: spawn projectiles for all alive players that are firing
    this.processShooting(now);

    // Advance projectiles and collect hits
    let projectileHits: import('./projectile-manager.js').ProjectileHit[] = [];
    let projectileVoxelHits: import('./projectile-manager.js').ProjectileVoxelHit[] = [];
    let projectileObstacleHits: import('./projectile-manager.js').ProjectileObstacleHit[] = [];
    if (this.heightmapMode) {
      const update = this.projectileManager.updateHeightmap(
        TICK_INTERVAL / 1000,
        this.terrainHeightGetter,
        this.players,
        this.heightmapObstacles,
        undefined,
        LAG_COMPENSATION_MS,
        undefined,
      );
      projectileHits = update.playerHits;
      projectileVoxelHits = update.voxelHits;
      projectileObstacleHits = update.obstacleHits;
    } else {
      const update = this.projectileManager.update(
        TICK_INTERVAL / 1000,
        voxelGetter,
        this.players,
        undefined,
        LAG_COMPENSATION_MS,
        undefined,
      );
      projectileHits = update.playerHits;
      projectileVoxelHits = update.voxelHits;
    }

    // Advance pending rubble drops (delayed voxel placement for falling sections)
    this.destructionManager.update(now);
    
    // --- Debris Physics Update ---
    // Process any pending debris bodies from explosions
    this.destructionManager.processPendingDebrisBodies();
    
    // Step debris physics simulation
    let debrisStates: import('./debris-physics-manager.js').DebrisState[] = [];
    if (this.debrisPhysicsManager) {
      try {
        debrisStates = this.debrisPhysicsManager.update(TICK_INTERVAL / 1000);
      } catch (error) {
        console.error('[DebrisPhysics] Disabled after runtime error:', error);
        this.debrisPhysicsManager.dispose();
        this.debrisPhysicsManager = null;
        this.destructionManager.setDebrisPhysics(null);
      }
    }

    // Bullet voxel destruction disabled — only explosions destroy terrain for now
    if (this.heightmapMode && projectileObstacleHits.length > 0) {
      for (const hit of projectileObstacleHits) {
        const collider = this.heightmapObstacles.find((c) => c.id === hit.colliderId);
        if (!collider || collider.destructible !== true) continue;
        if (this.destroyedPlacementColliders.has(collider.id)) continue;

        this.destroyedPlacementColliders.add(collider.id);
        this.placementColliders = this.placementColliders.filter((c) => c.id !== collider.id);
        this.heightmapObstacles = this.heightmapObstacles.filter((c) => c.id !== collider.id);

        this.network.broadcast({
          type: 'placement_destroyed',
          colliderId: collider.id,
          position: hit.position,
          impulse: hit.direction,
        });
      }
    }

    // Process projectile hits: apply damage, send confirmations, handle kills
    for (const hit of projectileHits) {
      const shooter = this.players.get(hit.ownerId);
      const target = this.players.get(hit.targetId);
      if (!shooter || !target || !target.alive) continue;

      const damage = calcDamage(hit.weapon, hit.distance);
      if (damage <= 0) continue;

      // Record damage for assist tracking
      target.recordDamageFrom(hit.ownerId);

      const result = target.takeDamage(damage);

      // Send hit confirmation to shooter (with sourcePos)
      const shooterClient = this.network.getClients().get(hit.ownerId);
      if (shooterClient) {
        this.network.send(shooterClient, {
          type: 'hit_confirm',
          targetId: hit.targetId,
          damage,
          sourcePos: { ...shooter.position },
        });
      }

      // Send hit notification to victim (for damage direction indicators)
      const victimClient = this.network.getClients().get(hit.targetId);
      if (victimClient) {
        this.network.send(victimClient, {
          type: 'hit_confirm',
          targetId: hit.targetId,
          damage,
          sourcePos: { ...shooter.position },
        });
      }

      if (result === 'downed') {
        target.downedBy = shooter.id;
        this.onPlayerDowned(shooter, target);
      } else if (result === 'killed') {
        this.onPlayerKilled(shooter, target);
      }
    }

    // Process grenade throws
    this.processGrenadeThrowing(now);

    // Advance grenades and process explosions
    const grenadeExplosions = this.grenadeManager.update(
      TICK_INTERVAL / 1000,
      voxelGetter,
      this.players
    );
    for (const explosion of grenadeExplosions) {
      // Broadcast explosion effect to all clients
      this.network.broadcast({
        type: 'explosion',
        event: {
          position: explosion.position,
          radius: 10,
          ownerId: explosion.ownerId,
        },
      });
      // Destroy voxels in explosion radius
      this.destructionManager.explode(explosion.position, GRENADE_DESTRUCTION_RADIUS);
      // Process downed/kills from grenade damage
      for (const hit of explosion.hits) {
        if (hit.killed) {
          const killer = this.players.get(explosion.ownerId);
          const victim = this.players.get(hit.playerId);
          if (killer && victim) {
            if (victim.downed) {
              // Downed by the explosion
              victim.downedBy = killer.id;
              this.onPlayerDowned(killer, victim, 'Grenade');
            } else if (!victim.alive) {
              // Finished off
              this.onPlayerKilled(killer, victim, 'Grenade');
            }
          }
        }
      }
    }

    // Advance smoke grenades and process smoke deployments
    const smokeDeploys = this.smokeGrenadeManager.update(
      TICK_INTERVAL / 1000,
      voxelGetter,
      this.heightmapMode ? this.heightmapObstacles : []
    );
    for (const deploy of smokeDeploys) {
      this.network.broadcast({
        type: 'smoke_deploy',
        event: {
          position: deploy.position,
          radius: deploy.radius,
          duration: deploy.duration,
        },
      });
    }

    const flashDetonations = this.flashGrenadeManager.update(
      TICK_INTERVAL / 1000,
      voxelGetter,
      this.heightmapMode ? this.heightmapObstacles : []
    );
    for (const detonation of flashDetonations) {
      this.network.broadcast({
        type: 'flash_detonate',
        event: {
          position: detonation.position,
          radius: detonation.radius,
        },
      });

      for (const target of this.players.values()) {
        if (!target.alive || target.downed) continue;
        if (target.id === detonation.ownerId) continue;

        const dx = target.position.x - detonation.position.x;
        const dy = target.position.y - detonation.position.y;
        const dz = target.position.z - detonation.position.z;
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (dist > detonation.radius) continue;

        const closeness = 1 - dist / detonation.radius;
        const flashMs = Math.round(FLASH_GRENADE_MAX_DURATION * 1000 * (0.35 + closeness * 0.65));
        target.applyFlash(now, flashMs);
      }
    }

    // Process gadget use (also spawns rockets via rocketManager)
    this.processGadgetUse(now);

    // Broadcast rocket states BEFORE collision update so newly spawned rockets
    // get at least one frame of visibility on the client
    const preUpdateRocketStates = this.rocketManager.getStates();
    if (preUpdateRocketStates.length > 0) {
      this.network.broadcast({
        type: 'rockets',
        rockets: preUpdateRocketStates,
      });
    }

    // Advance rockets and process explosions
    const rocketExplosions = this.rocketManager.update(
      TICK_INTERVAL / 1000,
      voxelGetter,
      this.players
    );
    for (const explosion of rocketExplosions) {
      // Broadcast explosion effect to all clients
      this.network.broadcast({
        type: 'explosion',
        event: {
          position: explosion.position,
          radius: 8,
          ownerId: explosion.ownerId,
        },
      });
      // Destroy voxels in explosion radius
      this.destructionManager.explode(explosion.position, ROCKET_DESTRUCTION_RADIUS);
      // Process downed/kills from rocket splash damage
      for (const hit of explosion.hits) {
        if (hit.killed) {
          const killer = this.players.get(explosion.ownerId);
          const victim = this.players.get(hit.playerId);
          if (killer && victim) {
            if (victim.downed) {
              victim.downedBy = killer.id;
              this.onPlayerDowned(killer, victim, 'Rocket');
            } else if (!victim.alive) {
              this.onPlayerKilled(killer, victim, 'Rocket');
            }
          }
        }
      }
    }

    // Update gadgets
    const gadgetResult = this.gadgetManager.update(TICK_INTERVAL / 1000, this.players);

    // Merge voxel changes from gadgets and destruction, broadcast together
    const gadgetVoxelChanges = this.gadgetManager.drainVoxelChanges();
    const destructionVoxelChanges = this.destructionManager.drainChanges();
    const allVoxelChanges = gadgetVoxelChanges.concat(destructionVoxelChanges);
    if (allVoxelChanges.length > 0) {
      this.network.broadcast({
        type: 'voxel_update',
        changes: allVoxelChanges,
      });
    }

    // Process crush zones: kill players caught under falling rubble
    const crushZones = this.destructionManager.drainCrushZones();
    for (const zone of crushZones) {
      for (const player of this.players.values()) {
        if (!player.alive) continue;
        const px = player.position.x;
        const py = player.position.y;
        const pz = player.position.z;
        // Check if player's feet or head are inside the crush volume
        if (
          px >= zone.min.x && px <= zone.max.x &&
          pz >= zone.min.z && pz <= zone.max.z &&
          py >= zone.min.y && (py + PLAYER_HEIGHT) >= zone.min.y &&
          py <= zone.max.y
        ) {
          const killed = player.takeDamage(zone.damage);
          if (killed) {
            // Broadcast as environmental kill
            this.network.broadcast({
              type: 'kill',
              entry: {
                killerId: player.id,
                killerName: player.name,
                victimId: player.id,
                victimName: player.name,
                weapon: 'Crushed',
              },
            });
            const victimClient = this.network.getClients().get(player.id);
            if (victimClient) {
              this.network.send(victimClient, {
                type: 'death',
                killerId: player.id,
                respawnTime: RESPAWN_DELAY,
                killerPos: { ...player.position },
              });
            }
            console.log(`CRUSH: ${player.name} killed by falling rubble`);
          }
        }
      }
    }

    // Broadcast destruction visual events (particles, debris, screen shake)
    const destructionEvents = this.destructionManager.drainEvents();
    if (destructionEvents.length > 0) {
      this.network.broadcast({
        type: 'destruction_event',
        events: destructionEvents,
      });
    }

    // Send spotted enemies only to the spotter's team
    if (gadgetResult.spottedPositions && gadgetResult.spotterTeam >= 0) {
      const now = Date.now()
      const squadTargets = gadgetResult.spottedPositions.map((position, index) => ({
        id: `spot-${gadgetResult.spotterTeam}-${now}-${index}`,
        sourceTeam: gadgetResult.spotterTeam,
        team: 1 - gadgetResult.spotterTeam,
        label: 'SQUAD SPOT',
        position,
        type: 'enemy_spotted',
        expiresAt: now + 10_000,
      }))
      this.network.broadcastToTeam(
        gadgetResult.spotterTeam,
        {
          type: 'squad_targets',
          team: gadgetResult.spotterTeam,
          targets: squadTargets,
        },
        (clientId) => this.players.get(clientId)?.team
      )

      // Backward-compatible event for older clients
      this.network.broadcastToTeam(
        gadgetResult.spotterTeam,
        {
          type: 'enemy_spotted',
          positions: gadgetResult.spottedPositions,
          duration: 10,
        },
        (clientId) => this.players.get(clientId)?.team
      );
    }

    // Process bleedout timers for downed players
    this.processBleedouts(TICK_INTERVAL / 1000);

    // Process revives: nearby alive teammates can revive downed players
    this.processRevives(TICK_INTERVAL / 1000);

    // Update capture points
    const captureChanged = this.capturePointManager.update(TICK_INTERVAL / 1000, this.players);

    // Process respawns
    this.processRespawns(now);

    // Check game over
    this.checkGameOver();

    // AI director cadence (deterministic fallback loop)
    this.runDirector(now);

    // Incursion: tick timer and dynamic objectives
    if (this.gameMode === 'incursion') {
      this.incursionTimeRemaining -= TICK_INTERVAL / 1000;
      this.updateDynamicObjectives(TICK_INTERVAL / 1000);
      // Broadcast timer every second
      if (this.tickCount % TICK_RATE === 0) {
        this.network.broadcast({
          type: 'match_timer',
          timeRemaining: Math.max(0, this.incursionTimeRemaining),
          timeLimit: INCURSION_TIME_LIMIT,
        });
      }
    }

    // Clean up stale disconnected sessions periodically
    if (this.tickCount % SESSION_CLEANUP_INTERVAL === 0) {
      this.cleanupStaleSessions(now);
    }

    // Build state snapshot (exclude disconnected players)
    const players = Array.from(this.players.values())
      .filter((s) => !s.disconnected)
      .map((s) => s.getState());

    // Get projectile states for broadcasting
    const projectileStates = this.projectileManager.getStates();

    // Notify Schema layer (BattleRoom) if registered
    if (this.onStateComputed) {
      this.onStateComputed(players, this.tickCount);
    }

    // Send personalized state to each client (with their specific ack seq)
    // Skip when Colyseus Schema handles state sync
    if (!this.suppressStateBroadcast) {
      for (const client of this.network.getClients().values()) {
        const sim = this.players.get(client.id);
        if (sim) {
          this.network.send(client, {
            type: 'state',
            tick: this.tickCount,
            players,
            ack: sim.lastAckedSeq,
          });
        }
      }
    }

    // Broadcast projectile positions to all clients
    if (projectileStates.length > 0) {
      this.network.broadcast({
        type: 'projectiles',
        projectiles: projectileStates,
      });
    }

    // Broadcast grenade states to all clients
    const grenadeStates = this.grenadeManager.getStates();
    if (grenadeStates.length > 0) {
      this.network.broadcast({
        type: 'grenades',
        grenades: grenadeStates,
      });
    }

    // Broadcast smoke grenade states to all clients
    const smokeGrenadeStates = this.smokeGrenadeManager.getStates();
    if (smokeGrenadeStates.length > 0) {
      this.network.broadcast({
        type: 'smoke_grenades',
        grenades: smokeGrenadeStates,
      });
    }

    const flashGrenadeStates = this.flashGrenadeManager.getStates();
    if (flashGrenadeStates.length > 0) {
      this.network.broadcast({
        type: 'flash_grenades',
        grenades: flashGrenadeStates,
      });
    }

    // Rocket states already broadcast before collision update (see above)

    // Broadcast gadget states to all clients
    const gadgetStates = this.gadgetManager.getStates();
    if (gadgetStates.length > 0) {
      this.network.broadcast({
        type: 'gadgets',
        gadgets: gadgetStates,
      });
    }

    // Broadcast debris physics states to all clients
    if (debrisStates.length > 0) {
      this.network.broadcast({
        type: 'debris_states',
        debris: debrisStates,
      });
    }

    // Broadcast capture points and conquest scores when changed or periodically
    if (captureChanged || this.tickCount % TICKET_BROADCAST_INTERVAL === 0) {
      this.network.broadcast({
        type: 'capture_points',
        points: this.capturePointManager.getStates(),
      });
      const scores = this.capturePointManager.getScores();
      this.network.broadcast({
        type: 'conquest_score',
        alpha: scores.alpha,
        bravo: scores.bravo,
      });
    }

    // Broadcast tickets periodically
    if (this.tickCount % TICKET_BROADCAST_INTERVAL === 0) {
      this.network.broadcast({
        type: 'tickets',
        alpha: this.ticketsAlpha,
        bravo: this.ticketsBravo,
      });
    }

    // Broadcast scoreboard periodically
    if (this.tickCount % SCOREBOARD_BROADCAST_INTERVAL === 0) {
      const scoreboardEntries = Array.from(this.players.values()).map(p => ({
        id: p.id,
        name: p.name,
        team: p.team,
        classId: p.classId,
        kills: p.kills,
        deaths: p.deaths,
        assists: p.assists,
        score: p.score,
      }));
      this.network.broadcast({
        type: 'scoreboard',
        players: scoreboardEntries,
      });
    }
  }

  // --- Chunk streaming ---

  /**
   * For each connected player, check if there are new chunks within STREAM_RADIUS
   * that haven't been sent yet. If so, send them via the 'chunks' message.
   */
  private streamChunksToClients(): void {
    for (const client of this.network.getClients().values()) {
      const sim = this.players.get(client.id);
      if (!sim) continue;

      const sent = this.sentChunks.get(client.id);
      if (!sent) continue;

      // Convert player world position to chunk coordinates
      const cx = Math.floor(sim.position.x / CHUNK_SIZE);
      const cy = Math.floor(sim.position.y / CHUNK_SIZE);
      const cz = Math.floor(sim.position.z / CHUNK_SIZE);

      const nearbyKeys = STREAM_ALL_CHUNKS
        ? Array.from(this.chunks.keys())
        : getChunksInRadius(cx, cy, cz, STREAM_RADIUS);

      const newChunks: ChunkData[] = [];
      for (const key of nearbyKeys) {
        if (sent.has(key)) continue;

        const voxels = this.chunks.get(key);
        if (voxels) {
          newChunks.push({ key, voxels: Array.from(voxels) });
          sent.add(key);
        }
      }

      if (newChunks.length > 0) {
        // Sort by priority: closer chunks and chunks in the look direction load first
        const lookDir = aimDirection(sim.yaw, sim.pitch);
        newChunks.sort((a, b) => {
          const [ax, ay, az] = a.key.split(',').map(Number);
          const [bx, by, bz] = b.key.split(',').map(Number);
          const adx = ax - cx, ady = ay - cy, adz = az - cz;
          const bdx = bx - cx, bdy = by - cy, bdz = bz - cz;
          const aDist = Math.sqrt(adx * adx + ady * ady + adz * adz);
          const bDist = Math.sqrt(bdx * bdx + bdy * bdy + bdz * bdz);
          // Dot product with look direction (normalized chunk direction)
          const aDot = aDist > 0 ? (adx * lookDir.x + ady * lookDir.y + adz * lookDir.z) / aDist : 0;
          const bDot = bDist > 0 ? (bdx * lookDir.x + bdy * lookDir.y + bdz * lookDir.z) / bDist : 0;
          const aPri = aDist - aDot * 32;
          const bPri = bDist - bDot * 32;
          return aPri - bPri;
        });

        this.network.send(client, {
          type: 'chunks',
          chunks: newChunks,
        });
      }
    }
  }

  // --- AI Director (deterministic fallback loop) ---

  private runDirector(now: number): void {
    if (now < this.directorNextCheckAt || this.gameOver) {
      return;
    }
    const interval = this.gameMode === 'incursion'
      ? INCURSION_DIRECTOR_INTERVAL * 1000
      : 60_000;
    this.directorNextCheckAt = now + interval;

    // Incursion has its own enhanced director
    if (this.gameMode === 'incursion') {
      this.runIncursionDirector(now);
      return;
    }

    const event = this.pickDirectorEvent(now);
    if (!event) return;

    // Apply gameplay effects for selected event types.
    if (event.kind === 'reinforcement_wave' && event.team !== undefined) {
      const bonusTickets = 8;
      if (event.team === Team.Alpha) {
        this.ticketsAlpha += bonusTickets;
      } else {
        this.ticketsBravo += bonusTickets;
      }
      this.network.broadcast({
        type: 'tickets',
        alpha: this.ticketsAlpha,
        bravo: this.ticketsBravo,
      });
      event.description += ` (+${bonusTickets} tickets)`;
    }

    if (event.kind === 'weather_shift' && event.weather) {
      this.directorCurrentWeather = event.weather;
    }

    this.network.broadcast({ type: 'director_event', event });
    console.log(`[Director] ${event.title} :: ${event.description}`);
  }

  private pickDirectorEvent(now: number): DirectorEvent | null {
    const seed = this.tickCount + Math.floor(now / 1000);
    const roll = this.directorRand(seed);
    const zone = this.pickDirectorZone(seed + 7);

    const alphaLead = this.ticketsAlpha - this.ticketsBravo;
    const losingTeam = alphaLead === 0 ? undefined : alphaLead > 0 ? Team.Bravo : Team.Alpha;

    if (Math.abs(alphaLead) >= 20 && losingTeam !== undefined && roll < 0.62) {
      return {
        id: `dir-${now}-reinforce`,
        kind: 'reinforcement_wave',
        title: 'Reinforcement Wave',
        description: `${losingTeam === Team.Alpha ? 'Alpha' : 'Bravo'} receives emergency reinforcements`,
        team: losingTeam,
        durationSeconds: 1,
      };
    }

    // 40% chance to shift weather for pacing and atmosphere.
    if (roll < 0.40) {
      const weather = this.pickNextWeather(seed + 13);
      return {
        id: `dir-${now}-weather`,
        kind: 'weather_shift',
        title: 'Weather Shift',
        description: `${weather.toUpperCase()} fronts are moving over the battlefield`,
        weather,
        durationSeconds: 45,
      };
    }

    if (roll < 0.72) {
      return {
        id: `dir-${now}-artillery`,
        kind: 'artillery_warning',
        title: 'Artillery Warning',
        description: `Incoming fire expected near point ${zone}`,
        zone,
        durationSeconds: 15,
      };
    }

    if (roll < 0.90) {
      return {
        id: `dir-${now}-supply`,
        kind: 'supply_drop',
        title: 'Supply Drop',
        description: `High-value supply crate reported near point ${zone}`,
        zone,
        durationSeconds: 60,
      };
    }

    return {
      id: `dir-${now}-objective`,
      kind: 'objective_shift',
      title: 'Objective Shift',
      description: `Command priority changed: pressure point ${zone}`,
      zone,
      durationSeconds: 40,
    };
  }

  private pickDirectorZone(seed: number): string {
    const points = this.capturePointManager.getStates();
    if (points.length === 0) return 'MID';
    const idx = Math.floor(this.directorRand(seed) * points.length);
    return points[Math.max(0, Math.min(points.length - 1, idx))]!.id;
  }

  private pickNextWeather(seed: number): WeatherState {
    const weatherPool: WeatherState[] = ['clear', 'cloudy', 'overcast', 'fog', 'rain', 'snow', 'storm'];
    const filtered = weatherPool.filter((w) => w !== this.directorCurrentWeather);
    const idx = Math.floor(this.directorRand(seed) * filtered.length);
    return filtered[Math.max(0, Math.min(filtered.length - 1, idx))] ?? 'clear';
  }

  private directorRand(seed: number): number {
    const n = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
    return n - Math.floor(n);
  }

  // --- Incursion director & dynamic objectives ---

  private runIncursionDirector(now: number): void {
    const scores = this.capturePointManager.getScores();
    const gap = scores.alpha - scores.bravo;
    const losingTeam = gap === 0 ? -1 : gap > 0 ? Team.Bravo : Team.Alpha;

    // Rubber-band: if losing team is far behind, give them a reinforcement event
    if (Math.abs(gap) >= INCURSION_RUBBERBAND_THRESHOLD && losingTeam >= 0) {
      const event: DirectorEvent = {
        id: `dir-${now}-reinforce`,
        kind: 'reinforcement_wave',
        title: 'Emergency Reinforcements',
        description: `${losingTeam === Team.Alpha ? 'Alpha' : 'Bravo'} receives emergency reinforcements (+8 tickets)`,
        team: losingTeam,
        durationSeconds: 1,
      };
      if (losingTeam === Team.Alpha) {
        this.ticketsAlpha += 8;
      } else {
        this.ticketsBravo += 8;
      }
      this.network.broadcast({
        type: 'tickets',
        alpha: this.ticketsAlpha,
        bravo: this.ticketsBravo,
      });
      this.network.broadcast({ type: 'director_event', event });
      console.log(`[Incursion Director] Rubber-band: reinforcements for ${losingTeam === Team.Alpha ? 'Alpha' : 'Bravo'}`);
    }

    // Spawn dynamic objectives if fewer than 2 active
    const activeObjectives = this.dynamicObjectives.filter(o => !o.completed && o.timeRemaining > 0);
    if (activeObjectives.length < 2) {
      this.spawnDynamicObjective(losingTeam, now);
    }

    // Otherwise pick a standard event (weather, artillery, supply drop)
    const seed = this.tickCount + Math.floor(now / 1000);
    const roll = this.directorRand(seed + 37);
    if (roll < 0.3) {
      const weather = this.pickNextWeather(seed + 51);
      const event: DirectorEvent = {
        id: `dir-${now}-weather`,
        kind: 'weather_shift',
        title: 'Weather Shift',
        description: `${weather.toUpperCase()} fronts are moving over the battlefield`,
        weather,
        durationSeconds: 45,
      };
      this.directorCurrentWeather = weather;
      this.network.broadcast({ type: 'director_event', event });
      console.log(`[Incursion Director] Weather: ${weather}`);
    } else if (roll < 0.5) {
      const zone = this.pickDirectorZone(seed + 61);
      const event: DirectorEvent = {
        id: `dir-${now}-artillery`,
        kind: 'artillery_warning',
        title: 'Artillery Warning',
        description: `Incoming fire expected near point ${zone}`,
        zone,
        durationSeconds: 15,
      };
      this.network.broadcast({ type: 'director_event', event });
      console.log(`[Incursion Director] Artillery near ${zone}`);
    }
  }

  private spawnDynamicObjective(losingTeam: number, now: number): void {
    const seed = this.tickCount + Math.floor(now / 1000);
    const zone = this.pickDirectorZone(seed + 19);
    const id = `obj-${this.nextObjectiveId++}`;

    const objective: DynamicObjective = {
      id,
      task: 'capture',
      zone,
      timeLimit: INCURSION_OBJECTIVE_DURATION,
      timeRemaining: INCURSION_OBJECTIVE_DURATION,
      bonusScore: INCURSION_OBJECTIVE_BONUS,
      targetTeam: losingTeam, // favor losing team, or -1 for either
      completed: false,
    };

    this.dynamicObjectives.push(objective);

    const teamLabel = losingTeam === Team.Alpha ? 'Alpha'
      : losingTeam === Team.Bravo ? 'Bravo'
      : 'Either team';

    const event: DirectorEvent = {
      id: `dir-${now}-dynobj`,
      kind: 'dynamic_objective',
      title: 'Dynamic Objective',
      description: `${teamLabel}: Capture point ${zone} for +${INCURSION_OBJECTIVE_BONUS} bonus points!`,
      zone,
      durationSeconds: INCURSION_OBJECTIVE_DURATION,
      objective,
    };

    this.network.broadcast({ type: 'director_event', event });
    this.network.broadcast({
      type: 'dynamic_objectives',
      objectives: this.dynamicObjectives.filter(o => !o.completed && o.timeRemaining > 0),
    });

    console.log(`[Incursion] Spawned objective ${id}: capture ${zone} (${teamLabel})`);
  }

  private updateDynamicObjectives(dt: number): void {
    let changed = false;

    for (const obj of this.dynamicObjectives) {
      if (obj.completed || obj.timeRemaining <= 0) continue;

      obj.timeRemaining -= dt;

      // Check if target zone is captured by target team
      const cpStates = this.capturePointManager.getStates();
      const zoneState = cpStates.find(cp => cp.id === obj.zone);
      if (zoneState) {
        const captured = obj.targetTeam === -1
          ? zoneState.owner >= 0 // any team
          : zoneState.owner === obj.targetTeam;

        if (captured) {
          obj.completed = true;
          const team = zoneState.owner;
          this.capturePointManager.addBonus(team, obj.bonusScore);
          this.network.broadcast({
            type: 'objective_completed',
            objectiveId: obj.id,
            team,
            bonusScore: obj.bonusScore,
          });
          console.log(`[Incursion] Objective ${obj.id} completed by ${team === Team.Alpha ? 'Alpha' : 'Bravo'} (+${obj.bonusScore})`);
          changed = true;
        }
      }

      // Remove expired objectives
      if (obj.timeRemaining <= 0 && !obj.completed) {
        console.log(`[Incursion] Objective ${obj.id} expired`);
        changed = true;
      }
    }

    // Broadcast updated objectives periodically (every second) or on change
    if (changed || this.tickCount % TICK_RATE === 0) {
      const active = this.dynamicObjectives.filter(o => !o.completed && o.timeRemaining > 0);
      this.network.broadcast({
        type: 'dynamic_objectives',
        objectives: active,
      });
    }
  }

  // --- Combat processing ---

  private processShooting(now: number): void {
    for (const shooter of this.players.values()) {
      // Dead or downed players can't shoot
      if (!shooter.alive || shooter.downed) continue;

      const input = shooter.latestInput;
      const shotIntents = shooter.consumeShotIntents();
      const isHoldingFire = !!input?.shoot;
      if (!isHoldingFire && shotIntents <= 0) continue;

      // Single-shot weapons use trigger intents; automatic weapons can sustain on hold.
      const shotsToAttempt = isHoldingFire
        ? Math.max(1, shotIntents)
        : shotIntents;

      for (let shotIndex = 0; shotIndex < shotsToAttempt; shotIndex++) {
        // Check fire rate / ammo
        if (!shooter.tryFire(now)) break;

        // Eye position: player pos (feet) + eye offset (adjusted for crouch)
        const eyeHeight = shooter.crouching ? CROUCH_HEIGHT - 0.1 : EYE_OFFSET;
        const eyePos: Vec3 = {
          x: shooter.position.x,
          y: shooter.position.y + eyeHeight,
          z: shooter.position.z,
        };

        // Base aim direction: use aimYaw (top-down mode) or yaw (FPS mode)
        const shootYaw = shooter.aimYaw ?? shooter.yaw;
        const shootPitch = shooter.pitch;
        const baseDir = aimDirection(shootYaw, shootPitch);

        const weapon = shooter.activeWeapon;
        const effectiveSpread = shooter.getEffectiveSpread();

        // Rocket launcher: spawn rocket instead of hitscan projectile
        if (weapon.id === WeaponId.RocketLauncher) {
          this.rocketManager.spawn(shooter.id, shooter.team, eyePos, baseDir);
          continue;
        }

        // Spawn a projectile for each pellet
        for (let p = 0; p < weapon.pellets; p++) {
          // Apply spread: random offset within the spread cone
          const dir = this.applySpread(baseDir, effectiveSpread);

          this.applyNearMissSuppression(shooter, eyePos, dir, weapon.maxRange, now);

          this.projectileManager.spawn(
            shooter.id,
            shooter.team,
            eyePos,
            dir,
            weapon
          );
        }
      }
    }
  }

  private applyNearMissSuppression(shooter: PlayerSim, origin: Vec3, dir: Vec3, maxRange: number, nowMs: number): void {
    for (const target of this.players.values()) {
      if (target.id === shooter.id) continue;
      if (!target.alive || target.downed) continue;
      if (target.team === shooter.team) continue;

      const targetEyeY = target.crouching ? target.position.y + (CROUCH_HEIGHT - 0.1) : target.position.y + EYE_OFFSET;
      const vx = target.position.x - origin.x;
      const vy = targetEyeY - origin.y;
      const vz = target.position.z - origin.z;

      const t = vx * dir.x + vy * dir.y + vz * dir.z;
      if (t <= 0 || t >= maxRange) continue;

      const cx = origin.x + dir.x * t;
      const cy = origin.y + dir.y * t;
      const cz = origin.z + dir.z * t;

      const dx = target.position.x - cx;
      const dy = targetEyeY - cy;
      const dz = target.position.z - cz;
      const missDistance = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (missDistance > SUPPRESSION_NEAR_MISS_RADIUS) continue;

      const closeness = 1 - missDistance / SUPPRESSION_NEAR_MISS_RADIUS;
      const durationMs = Math.round(SUPPRESSION_MAX_DURATION * 1000 * (0.45 + closeness * 0.55));
      target.applySuppression(nowMs, durationMs);
    }
  }

  /** Apply random spread to a direction vector */
  private applySpread(dir: Vec3, spread: number): Vec3 {
    if (spread <= 0) return { ...dir };

    // Random angle within spread cone
    const angle = Math.random() * spread;
    const rotation = Math.random() * Math.PI * 2;

    // Create a perpendicular vector for rotating around
    // Use cross product with an arbitrary axis
    let upX = 0, upY = 1, upZ = 0;
    // If direction is nearly vertical, use a different up vector
    if (Math.abs(dir.y) > 0.99) {
      upX = 1; upY = 0; upZ = 0;
    }

    // Cross product: dir x up = right
    const rightX = dir.y * upZ - dir.z * upY;
    const rightY = dir.z * upX - dir.x * upZ;
    const rightZ = dir.x * upY - dir.y * upX;
    const rightLen = Math.sqrt(rightX * rightX + rightY * rightY + rightZ * rightZ);

    if (rightLen < 1e-8) return { ...dir };

    const rx = rightX / rightLen;
    const ry = rightY / rightLen;
    const rz = rightZ / rightLen;

    // Cross product: right x dir = actual up
    const ax = ry * dir.z - rz * dir.y;
    const ay = rz * dir.x - rx * dir.z;
    const az = rx * dir.y - ry * dir.x;

    // Offset in the perpendicular plane
    const sinA = Math.sin(angle);
    const cosR = Math.cos(rotation);
    const sinR = Math.sin(rotation);

    const offsetX = sinA * (cosR * rx + sinR * ax);
    const offsetY = sinA * (cosR * ry + sinR * ay);
    const offsetZ = sinA * (cosR * rz + sinR * az);

    const cosA = Math.cos(angle);
    const newX = dir.x * cosA + offsetX;
    const newY = dir.y * cosA + offsetY;
    const newZ = dir.z * cosA + offsetZ;

    // Normalize
    const len = Math.sqrt(newX * newX + newY * newY + newZ * newZ);
    if (len < 1e-8) return { ...dir };
    return { x: newX / len, y: newY / len, z: newZ / len };
  }

  /** Process grenade throws from players who pressed the grenade key */
  private processGrenadeThrowing(now: number): void {
    for (const player of this.players.values()) {
      if (!player.alive || player.downed) continue;
      const input = player.latestInput;
      if (!input || !input.throwGrenade) continue;

      // Check cooldown
      if (now - player.lastGrenadeTime < GRENADE_COOLDOWN * 1000) continue;
      // Check stock
      if (player.grenadeCount <= 0) continue;

      player.grenadeCount--;
      player.lastGrenadeTime = now;

      // Eye position
      const eyeHeight = player.crouching ? CROUCH_HEIGHT - 0.1 : EYE_OFFSET;
      const eyePos: Vec3 = {
        x: player.position.x,
        y: player.position.y + eyeHeight,
        z: player.position.z,
      };
      const throwYaw = player.aimYaw ?? player.yaw;
      const dir = aimDirection(throwYaw, player.pitch);

      // Determine grenade type from grenadeIndex (0 = frag, 1 = smoke, 2 = flash)
      if ((input.grenadeIndex ?? 0) === 1) {
        this.smokeGrenadeManager.spawn(player.id, eyePos, dir);
      } else if ((input.grenadeIndex ?? 0) === 2) {
        this.flashGrenadeManager.spawn(player.id, eyePos, dir);
      } else {
        this.grenadeManager.spawn(player.id, player.team, eyePos, dir);
      }
    }
  }

  /** Process gadget use from players who pressed the gadget key */
  private processGadgetUse(now: number): void {
    for (const player of this.players.values()) {
      if (!player.alive || player.downed) continue;
      const input = player.latestInput;
      if (!input || !input.useGadget) continue;

      const gadgetIndex = input.gadgetIndex ?? 0;

      // Resolve gadget ID for this class + index
      const classDef = CLASSES[player.classId as ClassId];
      if (!classDef) continue;
      const gadgetId = classDef.gadgets[gadgetIndex];
      if (!gadgetId) continue;

      // Use per-gadget cooldown
      const cooldown = GADGET_COOLDOWNS[gadgetId] ?? GADGET_COOLDOWN;
      if (now - player.lastGadgetTime < cooldown * 1000) continue;

      player.lastGadgetTime = now;

      this.gadgetManager.spawn(player, gadgetIndex);
    }
  }

  /** Called when a player is downed (can still be revived) */
  private onPlayerDowned(attacker: PlayerSim, victim: PlayerSim, weaponName?: string): void {
    // Send downed message to victim
    const victimClient = this.network.getClients().get(victim.id);
    if (victimClient) {
      this.network.send(victimClient, {
        type: 'downed',
        killerId: attacker.id,
        bleedoutTime: victim.bleedoutTimer,
        killerPos: { ...attacker.position },
      });
    }

    // Broadcast kill-feed style notification (shows as DBNO in kill feed)
    this.network.broadcast({
      type: 'kill',
      entry: {
        killerId: attacker.id,
        killerName: attacker.name,
        victimId: victim.id,
        victimName: victim.name,
        weapon: (weaponName ?? attacker.weapon.name) + ' [DBNO]',
      },
    });

    console.log(`DOWNED: ${attacker.name} -> ${victim.name} with ${weaponName ?? attacker.weapon.name}`);
  }

  private onPlayerKilled(killer: PlayerSim, victim: PlayerSim, weaponName?: string): void {
    // KDA tracking
    killer.kills++;
    killer.score += 100; // 100 points per kill
    victim.deaths++;

    // Award assists: anyone who damaged victim in last 10 seconds (except killer)
    const now = Date.now();
    for (const [attackerId, lastTime] of victim.recentDamagers) {
      if (attackerId !== killer.id && (now - lastTime) < 10000) {
        const assister = this.players.get(attackerId);
        if (assister) {
          assister.assists++;
          assister.score += 25; // 25 points per assist
        }
      }
    }

    // Decrement enemy team's tickets (TDM only)
    if (this.gameMode === 'tdm') {
      if (victim.team === Team.Alpha) {
        this.ticketsAlpha = Math.max(0, this.ticketsAlpha - 1);
      } else {
        this.ticketsBravo = Math.max(0, this.ticketsBravo - 1);
      }
    }

    // Broadcast kill to all players
    this.network.broadcast({
      type: 'kill',
      entry: {
        killerId: killer.id,
        killerName: killer.name,
        victimId: victim.id,
        victimName: victim.name,
        weapon: weaponName ?? killer.weapon.name,
      },
    });

    // Send death message to victim with killer position
    const victimClient = this.network.getClients().get(victim.id);
    if (victimClient) {
      this.network.send(victimClient, {
        type: 'death',
        killerId: killer.id,
        respawnTime: RESPAWN_DELAY,
        killerPos: { ...killer.position },
      });
    }

    // Update tickets immediately
    this.network.broadcast({
      type: 'tickets',
      alpha: this.ticketsAlpha,
      bravo: this.ticketsBravo,
    });

    const usedWeapon = weaponName ?? killer.weapon.name;
    console.log(`KILL: ${killer.name} -> ${victim.name} with ${usedWeapon} | Tickets: Alpha=${this.ticketsAlpha} Bravo=${this.ticketsBravo}`);
  }

  // --- Bleedout processing ---

  private processBleedouts(dt: number): void {
    for (const sim of this.players.values()) {
      if (!sim.downed) continue;

      const bledOut = sim.tickBleedout(dt);
      if (bledOut) {
        // Player bled out — credit the kill to whoever downed them
        const killer = sim.downedBy ? this.players.get(sim.downedBy) : null;
        if (killer) {
          this.onPlayerKilled(killer, sim);
        } else {
          // No known killer — still process death
          sim.deaths++;
          const victimClient = this.network.getClients().get(sim.id);
          if (victimClient) {
            this.network.send(victimClient, {
              type: 'death',
              killerId: '',
              respawnTime: RESPAWN_DELAY,
              killerPos: { ...sim.position },
            });
          }
        }
        console.log(`BLEEDOUT: ${sim.name} bled out`);
      }
    }
  }

  // --- Revive processing ---

  private processRevives(dt: number): void {
    for (const downed of this.players.values()) {
      if (!downed.downed) continue;

      // Find the closest alive teammate within REVIVE_RADIUS who is holding interact
      let closestReviver: PlayerSim | null = null;
      let closestDist = Infinity;

      for (const candidate of this.players.values()) {
        if (candidate.id === downed.id) continue;
        if (!candidate.alive || candidate.downed) continue;
        if (candidate.team !== downed.team) continue;
        // Reviver must be actively holding the interact key
        if (!candidate.latestInput?.interact) continue;

        const dx = candidate.position.x - downed.position.x;
        const dy = candidate.position.y - downed.position.y;
        const dz = candidate.position.z - downed.position.z;
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

        if (dist <= REVIVE_RADIUS && dist < closestDist) {
          closestDist = dist;
          closestReviver = candidate;
        }
      }

      if (closestReviver) {
        const isMedic = closestReviver.classId === ClassId.Medic;
        const reviveTime = isMedic ? REVIVE_TIME_MEDIC : REVIVE_TIME;
        const complete = downed.progressRevive(closestReviver.id, dt, reviveTime);

        if (complete) {
          // Revive complete
          const reviveHealth = isMedic ? REVIVE_HEALTH_MEDIC : REVIVE_HEALTH;
          downed.completeRevive(reviveHealth);

          // Award score to reviver
          closestReviver.score += 50;

          // Notify the revived player
          const victimClient = this.network.getClients().get(downed.id);
          if (victimClient) {
            this.network.send(victimClient, {
              type: 'revived',
              reviverId: closestReviver.id,
              health: downed.health,
            });
          }

          console.log(`REVIVE: ${closestReviver.name} revived ${downed.name} (${isMedic ? 'medic' : 'standard'})`);
        } else {
          // Send progress update to the downed player
          const victimClient = this.network.getClients().get(downed.id);
          if (victimClient) {
            this.network.send(victimClient, {
              type: 'revive_progress',
              reviverId: closestReviver.id,
              progress: downed.reviveProgress,
            });
          }
        }
      } else {
        // No reviver nearby — reset progress
        if (downed.reviveProgress > 0) {
          downed.reviveProgress = 0;
          downed.reviverId = null;
        }
      }
    }
  }

  // --- Respawn processing ---

  private processRespawns(now: number): void {
    for (const sim of this.players.values()) {
      if (sim.alive || sim.downed) continue; // downed players are not yet dead
      if (sim.waitingToDeploy) continue; // Already sent to deploy screen
      if (sim.disconnected) continue; // Don't process respawns for disconnected players
      if (now - sim.deathTime < RESPAWN_DELAY * 1000) continue;

      // Check if this is a bot — bots auto-respawn without deploy screen
      const isBot = this.bots.some((b) => b.sim.id === sim.id);
      if (isBot) {
        const spawnPos = this.getSpawnPoint(sim.team);
        sim.respawn(spawnPos);
        console.log(`RESPAWN (bot): ${sim.name}`);
        continue;
      }

      // Human player: send available spawns and wait for deploy message
      sim.waitingToDeploy = true;
      const client = this.network.getClients().get(sim.id);
      if (client) {
        this.network.send(client, {
          type: 'available_spawns',
          spawns: this.getAvailableSpawns(sim.team),
        });
      }
    }
  }

  // --- Session cleanup ---

  /** Remove disconnected player sessions that have been inactive for too long */
  private cleanupStaleSessions(now: number): void {
    for (const [token, sim] of this.sessions) {
      if (!sim.disconnected) continue;
      if (now - sim.disconnectTime > SESSION_TIMEOUT) {
        this.sessions.delete(token);
        this.players.delete(sim.id);
        console.log(`Session expired: ${sim.name} (${sim.id}) — removed after ${SESSION_TIMEOUT / 1000}s`);
      }
    }
  }

  // --- Game over check ---

  private checkGameOver(): void {
    if (this.gameOver) return;

    let winner: Team | null = null;

    if (this.gameMode === 'tdm') {
      // TDM: first team to lose all tickets loses
      if (this.ticketsAlpha <= 0) {
        winner = Team.Bravo;
      } else if (this.ticketsBravo <= 0) {
        winner = Team.Alpha;
      }
    } else if (this.gameMode === 'conquest') {
      // Conquest: first team to reach the victory point lead wins
      const scores = this.capturePointManager.getScores();
      const diff = scores.alpha - scores.bravo;
      if (diff >= CONQUEST_VICTORY_POINTS) {
        winner = Team.Alpha;
      } else if (diff <= -CONQUEST_VICTORY_POINTS) {
        winner = Team.Bravo;
      }
    } else if (this.gameMode === 'incursion') {
      const scores = this.capturePointManager.getScores();
      if (scores.alpha >= INCURSION_SCORE_THRESHOLD) {
        winner = Team.Alpha;
      } else if (scores.bravo >= INCURSION_SCORE_THRESHOLD) {
        winner = Team.Bravo;
      } else if (this.incursionTimeRemaining <= 0) {
        winner = scores.alpha >= scores.bravo ? Team.Alpha : Team.Bravo;
      }
    }

    if (winner !== null) {
      this.gameOver = true;
      this.network.broadcast({
        type: 'game_over',
        winner,
      });
      console.log(`GAME OVER: Team ${winner === Team.Alpha ? 'Alpha' : 'Bravo'} wins! (${this.gameMode})`);
      this.onGameOverCallback?.(winner);
    }
  }
}
