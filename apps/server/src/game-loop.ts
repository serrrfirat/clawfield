import {
  TICK_INTERVAL,
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
  STREAM_RADIUS,
  STREAM_CHECK_INTERVAL,
  CONQUEST_VICTORY_POINTS,
} from '@clawfield/shared';
import type { ClientMessage, ChunkData, MapObjective, Vec3, SpawnPointOption, GameMode } from '@clawfield/shared';
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
import {
  loadBinaryMap,
  getConfiguredMapName,
  getDefaultMapMetaPath,
  getDefaultMapPath,
  getChunksInRadius,
  loadMapMetadata,
} from './map-loader.js';

/** Eye offset from player feet position */
const EYE_OFFSET = PLAYER_HEIGHT - 0.1; // 1.7

/** How often to broadcast ticket counts (in ticks) */
const TICKET_BROADCAST_INTERVAL = 20; // every 1 second at 20Hz

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
  private gadgetManager = new GadgetManager();

  // --- Map palette (hex colors) ---
  private palette: number[] = [];

  // --- Per-client chunk streaming ---
  private sentChunks = new Map<string, Set<string>>();

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

  // --- Team & ticket tracking ---
  private ticketsAlpha = TDM_TICKETS;
  private ticketsBravo = TDM_TICKETS;
  private gameOver = false;
  private nextTeam: Team = Team.Alpha;

  // --- Game mode ---
  private gameMode: GameMode = 'tdm';

  constructor(port: number) {
    // Try to load the configured binary map; fall back to test map
    this.loadMap();
    this.capturePointManager = new CapturePointManager(this.mapCapturePoints);
    this.gadgetManager.setChunks(this.chunks);

    // Spawn dummy bots on Team Bravo for target practice
    this.spawnBots();

    this.network = new NetworkServer(
      port,
      (client, msg) => this.handleMessage(client, msg),
      (client) => this.handleConnect(client),
      (client) => this.handleDisconnect(client)
    );

    // Start the game loop
    setInterval(() => this.update(), TICK_INTERVAL);
    console.log(`Game loop started at ${1000 / TICK_INTERVAL}Hz`);
  }

  /** Attempt to load a configured binary map; fall back to Oasis, then test map if missing */
  private loadMap(): void {
    const configuredMap = getConfiguredMapName();

    if (this.tryLoadMap(configuredMap)) {
      return;
    }

    if (configuredMap !== 'oasis' && this.tryLoadMap('oasis')) {
      console.warn(
        `WARNING: Failed to load configured map "${configuredMap}", fell back to "oasis"`
      );
      return;
    }

    console.warn(
      `WARNING: Binary map not found for "${configuredMap}" (and Oasis fallback unavailable), using test map`
    );
    this.generateTestMap();
    this.mapCapturePoints = DEFAULT_CAPTURE_POINTS.map((cp) => ({
      ...cp,
      position: { ...cp.position },
    }));
    this.usingBinaryMap = false;
    this.mapName = 'test';
    this.mapDisplayName = 'Test';
    this.mapObjectives = [];
  }

  private tryLoadMap(mapName: string): boolean {
    const mapPath = getDefaultMapPath(mapName);
    const mapData = loadBinaryMap(mapPath);
    if (!mapData) {
      return false;
    }

    this.chunks = mapData.chunks;
    this.palette = mapData.palette;
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

    console.log(`${this.mapName} map loaded: ${this.chunks.size} chunks`);
    return true;
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

  /** Spawn dummy bots and register them in the player list */
  private spawnBots(): void {
    const botDefs = [
      { id: 'bot1', name: 'Bot_1' },
      { id: 'bot2', name: 'Bot_2' },
      { id: 'bot3', name: 'Bot_3' },
    ];

    for (const def of botDefs) {
      const spawnPos = this.getSpawnPoint(Team.Bravo);
      const bot = new DummyBot(def.id, def.name, Team.Bravo, spawnPos);
      this.bots.push(bot);
      this.players.set(bot.sim.id, bot.sim);
      console.log(`Bot spawned: ${def.name} (${def.id}) - Team Bravo - ${bot.sim.classId}`);
    }
  }

  // --- Team assignment ---

  private assignTeam(): Team {
    const team = this.nextTeam;
    this.nextTeam = team === Team.Alpha ? Team.Bravo : Team.Alpha;
    return team;
  }

  private getSpawnPoint(team: Team): Vec3 {
    // Try capture point spawns first
    const captureSpawns = this.capturePointManager.getSpawnPoints(team);
    if (captureSpawns.length > 0) {
      const idx = Math.floor(Math.random() * captureSpawns.length);
      return { ...captureSpawns[idx] };
    }

    // Use map-defined/discovered spawn points when a binary map is loaded.
    if (this.usingBinaryMap) {
      const spawns = team === Team.Alpha ? this.mapSpawnsAlpha : this.mapSpawnsBravo;
      if (spawns.length > 0) {
        const idx = Math.floor(Math.random() * spawns.length);
        return { ...spawns[idx] };
      }
    }

    // Fall back to default test map spawns
    const spawns = SPAWN_POINTS[team];
    const idx = Math.floor(Math.random() * spawns.length);
    return { ...spawns[idx] };
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
      // Use base spawn
      if (this.usingBinaryMap) {
        const spawns = team === Team.Alpha ? this.mapSpawnsAlpha : this.mapSpawnsBravo;
        if (spawns.length > 0) {
          return { ...spawns[Math.floor(Math.random() * spawns.length)] };
        }
      }
      const fallback = SPAWN_POINTS[team];
      return { ...fallback[Math.floor(Math.random() * fallback.length)] };
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

  // --- Connection handlers ---

  private handleConnect(_client: Client): void {
    // Wait for 'join' message before creating player
  }

  private handleMessage(client: Client, msg: ClientMessage): void {
    switch (msg.type) {
      case 'join': {
        client.name = msg.name;

        // First human player to join sets the game mode
        const humanCount = Array.from(this.players.values()).filter(
          p => !this.bots.some(b => b.sim.id === p.id)
        ).length;
        if (humanCount === 0 && msg.gameMode) {
          this.gameMode = msg.gameMode;
          console.log(`Game mode set to: ${this.gameMode}`);
        }

        // Assign team
        const team = this.assignTeam();

        // Determine class
        const classId = (Object.values(ClassId).includes(msg.classId as ClassId))
          ? msg.classId as ClassId
          : ClassId.Assault;

        // Create player in waiting-to-deploy state (no immediate spawn)
        const tempPos = this.getSpawnPoint(team);
        const sim = new PlayerSim(client.id, msg.name, tempPos);
        sim.team = team;
        sim.selectClass(classId);
        sim.alive = false;
        sim.waitingToDeploy = true;
        this.players.set(client.id, sim);

        // Determine initial chunks to send (within STREAM_RADIUS of temp position)
        const spawnCx = Math.floor(tempPos.x / CHUNK_SIZE);
        const spawnCy = Math.floor(tempPos.y / CHUNK_SIZE);
        const spawnCz = Math.floor(tempPos.z / CHUNK_SIZE);
        const nearbyKeys = getChunksInRadius(spawnCx, spawnCy, spawnCz, STREAM_RADIUS);

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
          palette: this.palette.length > 0 ? this.palette : undefined,
          mapName: this.mapDisplayName,
          objectives: this.mapObjectives,
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
          name: msg.name,
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

        console.log(`Player joined: ${msg.name} (${client.id}) - Team ${team === Team.Alpha ? 'Alpha' : 'Bravo'} - ${classId}`);
        break;
      }

      case 'input': {
        const sim = this.players.get(client.id);
        if (sim) {
          sim.queueInput(msg.seq, msg.input, msg.dt);
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

  private handleDisconnect(client: Client): void {
    // Only remove real players, not bots
    const isBot = this.bots.some((b) => b.sim.id === client.id);
    if (!isBot) {
      this.players.delete(client.id);
    }

    // Clean up chunk streaming state
    this.sentChunks.delete(client.id);

    this.network.broadcast({
      type: 'player_left',
      id: client.id,
    });

    console.log(`Player left: ${client.id}`);
  }

  // --- Main update loop ---

  private update(): void {
    if (this.gameOver) return;

    this.tickCount++;
    const now = Date.now();

    const voxelGetter = (wx: number, wy: number, wz: number) =>
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
      sim.tick(voxelGetter);
    }

    // Process shooting: spawn projectiles for all alive players that are firing
    this.processShooting(now);

    // Advance projectiles and collect hits
    const projectileHits = this.projectileManager.update(
      TICK_INTERVAL / 1000,
      voxelGetter,
      this.players
    );

    // Process projectile hits: apply damage, send confirmations, handle kills
    for (const hit of projectileHits) {
      const shooter = this.players.get(hit.ownerId);
      const target = this.players.get(hit.targetId);
      if (!shooter || !target || !target.alive) continue;

      const damage = calcDamage(hit.weapon, hit.distance);
      if (damage <= 0) continue;

      // Record damage for assist tracking
      target.recordDamageFrom(hit.ownerId);

      const killed = target.takeDamage(damage);

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

      if (killed) {
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
      // Process kills from grenade damage
      for (const hit of explosion.hits) {
        if (hit.killed) {
          const killer = this.players.get(explosion.ownerId);
          const victim = this.players.get(hit.playerId);
          if (killer && victim) {
            this.onPlayerKilled(killer, victim, 'Grenade');
          }
        }
      }
    }

    // Process gadget use
    this.processGadgetUse(now);

    // Update gadgets
    const gadgetResult = this.gadgetManager.update(TICK_INTERVAL / 1000, this.players);

    // Broadcast voxel changes from deploy cover (place/remove)
    const voxelChanges = this.gadgetManager.drainVoxelChanges();
    if (voxelChanges.length > 0) {
      this.network.broadcast({
        type: 'voxel_update',
        changes: voxelChanges,
      });
    }

    // Send spotted enemies to all clients (client filters by team)
    if (gadgetResult.spottedPositions) {
      this.network.broadcast({
        type: 'enemy_spotted',
        positions: gadgetResult.spottedPositions,
        duration: 10,
      });
    }

    // Update capture points
    const captureChanged = this.capturePointManager.update(TICK_INTERVAL / 1000, this.players);

    // Process respawns
    this.processRespawns(now);

    // Check game over
    this.checkGameOver();

    // Build state snapshot
    const players = Array.from(this.players.values()).map((s) => s.getState());

    // Get projectile states for broadcasting
    const projectileStates = this.projectileManager.getStates();

    // Send personalized state to each client (with their specific ack seq)
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

    // Broadcast gadget states to all clients
    const gadgetStates = this.gadgetManager.getStates();
    if (gadgetStates.length > 0) {
      this.network.broadcast({
        type: 'gadgets',
        gadgets: gadgetStates,
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

      const nearbyKeys = getChunksInRadius(cx, cy, cz, STREAM_RADIUS);

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
        this.network.send(client, {
          type: 'chunks',
          chunks: newChunks,
        });
      }
    }
  }

  // --- Combat processing ---

  private processShooting(now: number): void {
    for (const shooter of this.players.values()) {
      // Dead players can't shoot
      if (!shooter.alive) continue;

      // Check if the player is holding fire
      const input = shooter.latestInput;
      if (!input || !input.shoot) continue;

      // Check fire rate / ammo
      if (!shooter.tryFire(now)) continue;

      // Eye position: player pos (feet) + eye offset (adjusted for crouch)
      const eyeHeight = shooter.crouching ? CROUCH_HEIGHT - 0.1 : EYE_OFFSET;
      const eyePos: Vec3 = {
        x: shooter.position.x,
        y: shooter.position.y + eyeHeight,
        z: shooter.position.z,
      };

      // Base aim direction from yaw/pitch
      const baseDir = aimDirection(shooter.yaw, shooter.pitch);

      const weapon = shooter.weapon;

      // Spawn a projectile for each pellet
      for (let p = 0; p < weapon.pellets; p++) {
        // Apply spread: random offset within the spread cone
        const dir = this.applySpread(baseDir, weapon.spread);

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
      if (!player.alive) continue;
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
      const dir = aimDirection(player.yaw, player.pitch);

      this.grenadeManager.spawn(player.id, player.team, eyePos, dir);
    }
  }

  /** Process gadget use from players who pressed the gadget key */
  private processGadgetUse(now: number): void {
    for (const player of this.players.values()) {
      if (!player.alive) continue;
      const input = player.latestInput;
      if (!input || !input.useGadget) continue;

      // Check cooldown
      if (now - player.lastGadgetTime < GADGET_COOLDOWN * 1000) continue;

      player.lastGadgetTime = now;
      this.gadgetManager.spawn(player);
    }
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

  // --- Respawn processing ---

  private processRespawns(now: number): void {
    for (const sim of this.players.values()) {
      if (sim.alive) continue;
      if (sim.waitingToDeploy) continue; // Already sent to deploy screen
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
    }

    if (winner !== null) {
      this.gameOver = true;
      this.network.broadcast({
        type: 'game_over',
        winner,
      });
      console.log(`GAME OVER: Team ${winner === Team.Alpha ? 'Alpha' : 'Bravo'} wins! (${this.gameMode})`);
    }
  }
}
