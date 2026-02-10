import * as THREE from 'three';
import { getVoxel, setVoxel as setVoxelShared, worldToChunk, PLAYER_HEIGHT, loadPalette, setWaterIndices, STREAM_RADIUS, LOD_UPDATE_INTERVAL, CLASSES, GADGET_COOLDOWNS, GADGET_COOLDOWN, ClassId, GadgetId, REVIVE_RADIUS, SMOKE_GRENADE_FUSE_TIME } from '@clawfield/shared';
import type { ServerMessage, PlayerState, KillEntry, GameMode, ClassDef, DestructionEvent, WeaponLoadout } from '@clawfield/shared';
import { Renderer } from './renderer';
import { WorldRenderer, setFogUniforms } from './voxel/world-renderer';
import { deserializeChunks } from './voxel/test-map';
import { LocalPlayer } from './player/local-player';
import { RemotePlayer } from './player/remote-player';
import { NetworkClient } from './network';
import { HUD } from './hud/hud';
import { ProjectileRenderer } from './combat/projectile-renderer';
import { CapturePointRenderer } from './combat/capture-point-renderer';
import { GrenadeRenderer } from './combat/grenade-renderer';
import { RocketRenderer } from './combat/rocket-renderer';
import { GadgetRenderer } from './combat/gadget-renderer';
import { ParticleSystem } from './combat/particle-system';
import { DebrisSystem } from './combat/debris-system';
import { PhysicsDebrisSystem } from './combat/physics-debris';
import { SmokeSystem } from './combat/smoke-system';

import { DamageIndicatorSystem } from './hud/damage-indicator';
import { Scoreboard } from './hud/scoreboard';
import { soundManager } from './audio/sound-manager';
import { DeployScreen } from './hud/deploy-screen';
import { MainMenu } from './hud/main-menu';
import { LobbyScreen } from './hud/lobby-screen';
import { loadSoldierModel } from './player/model-loader';
import { preloadWeaponModels } from './player/weapon-model-loader';
import { RadialMenu } from './hud/radial-menu';
import { GrenadeRadialMenu } from './hud/grenade-radial-menu';
import { CoverPreview } from './combat/cover-preview';
import { SoundId } from './audio/sound-manager';
import { VoxelObjectRenderer } from './voxel/voxel-object-renderer';
import { WeatherManager } from './weather/weather-manager';
import type { WeatherState } from './weather/weather-manager';
import type { CapturePointState, MapObjective, SpawnPointOption } from '@clawfield/shared';

// --- Game State (exported for HUD) ---
export const gameState = {
  myId: null as string | null,
  myTeam: -1,
  ticketsAlpha: 75,
  ticketsBravo: 75,
  kills: [] as KillEntry[],
  alive: true,
  downed: false,
  health: 100,
  ammo: 30,
  maxAmmo: 30,
  reloading: false,
  inWater: false,
  gameOver: false,
  winner: -1,
  capturePoints: [] as CapturePointState[],
  mapName: 'Unknown',
  mapObjectives: [] as MapObjective[],
  conquestScoreAlpha: 0,
  conquestScoreBravo: 0,
  selectedClass: 'assault',
  selectedClassName: 'Assault',
  selectedWeapon: '' as string,
  gameMode: 'tdm' as GameMode,
  lastGadgetUseTime: 0,
  selectedGadgetIndex: 0,
  selectedGrenadeIndex: 0,
  selectedLoadout: {} as WeaponLoadout,
};

// --- State ---
let chunks = new Map<string, Uint8Array>();
let localPlayer: LocalPlayer | null = null;
const remotePlayers = new Map<string, RemotePlayer>();

/** Map weapon display name → SoundId for remote gunshot audio */
const REMOTE_WEAPON_SOUND: Record<string, SoundId> = {
  'Assault Rifle': SoundId.ShootRifle,
  'SMG': SoundId.ShootSmg,
  'Medic SMG': SoundId.ShootSmg,
  'Shotgun': SoundId.ShootShotgun,
  'Carbine': SoundId.ShootRifle,
  'PDW': SoundId.ShootSmg,
  'Sniper Rifle': SoundId.ShootSniper,
  'DMR': SoundId.ShootSniper,
  'Pistol': SoundId.ShootSmg,
  'Rocket Launcher': SoundId.ShootRifle,
};

// --- Remote gunshot audio system ---
// Per-player cooldown to avoid overlapping shots from same bot
const remoteFireCooldowns = new Map<string, number>();
/** Max simultaneous remote gunshot sounds per tick */
const MAX_REMOTE_SHOTS_PER_TICK = 6;
/** Distance tiers (meters) */
const GUNSHOT_CLOSE = 25;
const GUNSHOT_MID = 60;
const GUNSHOT_FAR = 120;

// --- Setup ---
const renderer = new Renderer();
const worldRenderer = new WorldRenderer(renderer.scene);
const particleSystem = new ParticleSystem(renderer.scene);
const debrisSystem = new DebrisSystem(renderer.scene);
const physicsDebrisSystem = new PhysicsDebrisSystem(renderer.scene);
const projectileRenderer = new ProjectileRenderer(renderer.scene);
projectileRenderer.setParticleSystem(particleSystem);
const capturePointRenderer = new CapturePointRenderer(renderer.scene);
const grenadeRenderer = new GrenadeRenderer(renderer.scene);
grenadeRenderer.setParticleSystem(particleSystem);
const rocketRenderer = new RocketRenderer(renderer.scene);
rocketRenderer.setParticleSystem(particleSystem);
const gadgetRenderer = new GadgetRenderer(renderer.scene);
const smokeSystem = new SmokeSystem(renderer.scene, renderer.camera);

const radialMenu = new RadialMenu();
const grenadeRadialMenu = new GrenadeRadialMenu();
const coverPreview = new CoverPreview(renderer.scene);
const voxelObjectRenderer = new VoxelObjectRenderer(renderer.scene);
const weatherManager = new WeatherManager(renderer.scene, renderer.sunLight);
weatherManager.setSmokeSystem(smokeSystem);
const knownGadgetIds = new Set<number>();

// --- Screen shake state ---
let screenShakeIntensity = 0;
const SCREEN_SHAKE_DECAY = 10; // per second

// Voxel getter for physics
const voxelGetter = (wx: number, wy: number, wz: number) => getVoxel(chunks, wx, wy, wz);
debrisSystem.setVoxelGetter(voxelGetter);
physicsDebrisSystem.setVoxelGetter(voxelGetter);

// Color for underwater effect
const underwaterColor = new THREE.Color(0x1a5276);

// Expose weather manager on window for dev console testing:
//   setWeather('rain')  /  setWeather('snow', 10)  /  setWeather('clear')
(window as unknown as Record<string, unknown>).setWeather = (
  state: WeatherState,
  duration = 5,
) => {
  weatherManager.setWeather(state, duration);
};

// Weather hotkeys: 5=clear 6=cloudy 7=overcast 8=fog 9=rain 0=snow -=storm
const weatherKeys: Record<string, WeatherState> = {
  Digit5: 'clear',
  Digit6: 'cloudy',
  Digit7: 'overcast',
  Digit8: 'fog',
  Digit9: 'rain',
  Digit0: 'snow',
  Minus: 'storm',
};
document.addEventListener('keydown', (e) => {
  const state = weatherKeys[e.code];
  if (state) weatherManager.setWeather(state);
});

// --- Network ---
function handleServerMessage(msg: ServerMessage): void {
  switch (msg.type) {
    case 'welcome': {
      gameState.myId = msg.id;
      gameState.myTeam = msg.team;
      gameState.gameMode = msg.gameMode;
      // Store session token for reconnection
      network.sessionToken = msg.sessionToken;
      console.log(`Joined as ${gameState.myId} on team ${msg.team} (mode: ${msg.gameMode})`);

      // Load palette before building meshes so colors are correct
      if (msg.palette) {
        loadPalette(msg.palette);
      }
      // Set water material indices for physics and rendering
      if (msg.waterIndices) {
        setWaterIndices(msg.waterIndices);
      }

      // Load map from server (only nearby chunks in streaming mode)
      chunks = deserializeChunks(msg.mapData);
      worldRenderer.loadAll(chunks);

      gameState.mapName = msg.mapName ?? 'Unknown';
      gameState.mapObjectives = msg.objectives ?? [];
      if (msg.mapName) {
        console.log(
          `Map: ${msg.mapName} (${gameState.mapObjectives.length} objectives from metadata)`
        );
      }

      // Load and place multi-resolution voxel objects (non-blocking)
      if (msg.objectPlacements && msg.objectPlacements.length > 0) {
        voxelObjectRenderer.loadAndPlace(msg.objectPlacements).catch(err => {
          console.warn('Failed to load voxel objects:', err);
        });
      }

      // Tell projectile renderer which player is local (skip our own server projectiles)
      projectileRenderer.setLocalPlayerId(msg.id);
      // Player starts in deploy screen — local player created on first deploy
      break;
    }

    case 'player_joined': {
      if (msg.id !== gameState.myId && !remotePlayers.has(msg.id)) {
        const remote = new RemotePlayer(msg.id, msg.name, renderer.scene, msg.team);
        remotePlayers.set(msg.id, remote);
        console.log(`Player joined: ${msg.name} (team ${msg.team})`);
      }
      break;
    }

    case 'player_left': {
      const remote = remotePlayers.get(msg.id);
      if (remote) {
        remote.dispose(renderer.scene);
        remotePlayers.delete(msg.id);
        console.log(`Player left: ${msg.id}`);
      }
      break;
    }

    case 'state': {
      for (const playerState of msg.players) {
        if (playerState.id === gameState.myId) {
          // Update gameState from server authoritative state
          gameState.health = playerState.health;
          gameState.alive = playerState.alive;
          gameState.downed = playerState.downed;
          gameState.ammo = playerState.ammo;
          gameState.maxAmmo = playerState.maxAmmo;
          gameState.reloading = playerState.reloading;
          gameState.inWater = playerState.inWater;

          // Reconcile local player with server state
          localPlayer?.reconcile(playerState, msg.ack);
        } else {
          // Update remote player
          let remote = remotePlayers.get(playerState.id);
          if (!remote) {
            remote = new RemotePlayer(
              playerState.id,
              playerState.name,
              renderer.scene,
              playerState.team
            );
            remotePlayers.set(playerState.id, remote);
          }
          remote.pushState(playerState);
        }
      }

      // --- Remote gunshot spatial audio (distance-culled, throttled, varied) ---
      {
        const cam = renderer.camera;
        const camPos = cam.position;
        const now = performance.now();

        // Collect all remote shooters with their distance to listener
        const shooters: { state: PlayerState; dist: number }[] = [];
        for (const ps of msg.players) {
          if (ps.id === gameState.myId) continue;
          if (!ps.shooting || !ps.alive) continue;

          // Per-player cooldown: skip if we played this player's shot too recently (150ms)
          const lastFire = remoteFireCooldowns.get(ps.id) ?? 0;
          if (now - lastFire < 150) continue;

          const dx = ps.position.x - camPos.x;
          const dy = ps.position.y - camPos.y;
          const dz = ps.position.z - camPos.z;
          const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

          // Skip if beyond audible range
          if (dist > GUNSHOT_FAR) continue;

          shooters.push({ state: ps, dist });
        }

        // Sort by distance and only play closest N
        shooters.sort((a, b) => a.dist - b.dist);
        const toPlay = shooters.slice(0, MAX_REMOTE_SHOTS_PER_TICK);

        for (const { state: ps, dist } of toPlay) {
          remoteFireCooldowns.set(ps.id, now);

          // Pitch randomization: ±8% so identical weapons sound varied
          const pitch = 0.92 + Math.random() * 0.16;

          if (dist < GUNSHOT_CLOSE) {
            // Close: full weapon sound + bass thump (loud, detailed)
            const soundId = REMOTE_WEAPON_SOUND[ps.weaponName] ?? SoundId.ShootRifle;
            soundManager.play3D(soundId, ps.position, { pitch, volume: 0.55 });
            soundManager.play3D(SoundId.ShootBass, ps.position, { pitch, volume: 0.2 });
          } else if (dist < GUNSHOT_MID) {
            // Medium: just the main weapon crack, quieter
            const soundId = REMOTE_WEAPON_SOUND[ps.weaponName] ?? SoundId.ShootRifle;
            const falloff = 1 - (dist - GUNSHOT_CLOSE) / (GUNSHOT_MID - GUNSHOT_CLOSE);
            soundManager.play3D(soundId, ps.position, {
              pitch,
              volume: 0.25 + 0.2 * falloff,
              refDistance: 8,
            });
          } else {
            // Far: distant thump only — low rumble
            const falloff = 1 - (dist - GUNSHOT_MID) / (GUNSHOT_FAR - GUNSHOT_MID);
            soundManager.play3D(SoundId.ShootBass, ps.position, {
              pitch: pitch * 0.85, // lower pitch for distance
              volume: 0.12 * falloff,
              refDistance: 15,
            });
          }
        }
      }
      break;
    }

    case 'hit_confirm': {
      if (msg.targetId === gameState.myId) {
        // We got hit — show damage direction indicator
        if (localPlayer && msg.sourcePos) {
          const cam = renderer.camera;
          const camDir = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
          const playerYaw = Math.atan2(camDir.x, -camDir.z);
          damageIndicator.addHit(
            msg.sourcePos,
            { x: cam.position.x, y: cam.position.y, z: cam.position.z },
            playerYaw
          );
        }
      } else {
        // We hit someone — show hit marker
        localPlayer?.onHitConfirm();
        hud.showHitMarker();
      }
      break;
    }

    case 'kill': {
      gameState.kills.push(msg.entry);
      if (gameState.kills.length > 10) gameState.kills.shift();
      hud.addKill(msg.entry);
      break;
    }

    case 'death': {
      gameState.alive = false;
      gameState.downed = false;
      // Find killer name from remote players
      const killerRemote = remotePlayers.get(msg.killerId);
      const killerName = killerRemote?.name ?? 'Unknown';
      localPlayer?.onDeath(msg.killerPos);
      hud.showDeath(msg.respawnTime, killerName);
      // Deploy screen will be shown when server sends available_spawns after respawn delay
      break;
    }

    case 'downed': {
      gameState.downed = true;
      // Find killer name from remote players
      const downerRemote = remotePlayers.get(msg.killerId);
      const downerName = downerRemote?.name ?? 'Unknown';
      hud.showDowned(msg.bleedoutTime, downerName);
      break;
    }

    case 'revive_progress': {
      if (gameState.downed) {
        const reviverRemote = remotePlayers.get(msg.reviverId);
        const reviverName = reviverRemote?.name ?? 'Teammate';
        hud.updateReviveProgress(msg.progress, reviverName);
      }
      break;
    }

    case 'revived': {
      gameState.downed = false;
      gameState.alive = true;
      gameState.health = msg.health;
      hud.hideDeath();
      break;
    }

    case 'respawn': {
      gameState.alive = true;
      gameState.downed = false;
      deployScreen.hide();
      hud.hideDeath();
      if (!localPlayer) {
        // First spawn — create local player
        localPlayer = new LocalPlayer(renderer.scene, renderer.camera, voxelGetter, gameState.selectedClass, gameState.selectedWeapon);
        localPlayer.weaponCtrl.setParticleSystem(particleSystem);
      } else {
        // Subsequent spawn — update class and weapon
        localPlayer.weaponCtrl.setClass(gameState.selectedClass, gameState.selectedWeapon);
      }
      // Apply selected attachments to the weapon
      localPlayer.weaponCtrl.setLoadout(gameState.selectedLoadout);
      localPlayer.onRespawn(msg.position);
      break;
    }

    case 'available_spawns': {
      // Server says we can deploy — show the deploy screen
      hud.hideDeath();
      showDeployScreen(msg.spawns);
      break;
    }

    case 'tickets': {
      gameState.ticketsAlpha = msg.alpha;
      gameState.ticketsBravo = msg.bravo;
      break;
    }

    case 'game_over': {
      gameState.gameOver = true;
      gameState.winner = msg.winner;
      hud.showGameOver(msg.winner, gameState.myTeam);
      break;
    }

    case 'projectiles': {
      projectileRenderer.updateFromServer(msg.projectiles);
      break;
    }

    case 'grenades': {
      grenadeRenderer.updateFromServer(msg.grenades);
      break;
    }

    case 'explosion': {
      grenadeRenderer.addExplosion(msg.event.position, msg.event.radius);
      // Spawn volumetric smoke after the explosion flash
      smokeSystem.spawnExplosionSmoke(msg.event.position);
      break;
    }

    case 'smoke_grenades': {
      // In-flight smoke grenades rendered same as frag grenades (small cubes)
      // Reuse grenade renderer for the in-flight visuals
      grenadeRenderer.updateSmokeGrenadesFromServer(msg.grenades);
      break;
    }

    case 'smoke_deploy': {
      smokeSystem.spawnSmokeGrenade(
        msg.event.position,
        msg.event.radius,
        msg.event.duration,
      );
      break;
    }

    case 'capture_points': {
      gameState.capturePoints = msg.points;
      capturePointRenderer.updateFromServer(msg.points);
      break;
    }

    case 'conquest_score': {
      gameState.conquestScoreAlpha = msg.alpha;
      gameState.conquestScoreBravo = msg.bravo;
      break;
    }

    case 'scoreboard': {
      scoreboard.updateEntries(msg.players);
      break;
    }

    case 'gadgets': {
      // Detect newly spawned gadgets for sound/particle feedback
      for (const g of msg.gadgets) {
        if (!knownGadgetIds.has(g.id)) {
          knownGadgetIds.add(g.id);
          // Play 3D sound at gadget position
          const soundMap: Record<string, SoundId> = {
            medkit: SoundId.GadgetMedkit,
            ammo_box: SoundId.GadgetAmmo,
            spotting_scope: SoundId.GadgetSpot,
            repair_tool: SoundId.GadgetCover,
            claymore: SoundId.GadgetDeploy,
            bandage: SoundId.GadgetDeploy,
          };
          const sid = soundMap[g.type];
          if (sid) soundManager.play3D(sid, g.position);
          // Spawn colored particles at gadget position
          const colorMap: Record<string, number> = {
            medkit: 0x2ecc71,
            ammo_box: 0x8b6914,
            claymore: 0xcc3333,
            bandage: 0xf5f5f5,
          };
          const pColor = colorMap[g.type];
          if (pColor !== undefined) {
            const r = ((pColor >> 16) & 0xff) / 255;
            const gv = ((pColor >> 8) & 0xff) / 255;
            const b = (pColor & 0xff) / 255;
            particleSystem.emit({
              position: g.position,
              count: 8,
              direction: { x: 0, y: 1, z: 0 },
              speedMin: 1,
              speedMax: 3,
              spread: 1.5,
              lifetimeMin: 0.3,
              lifetimeMax: 0.8,
              sizeMin: 0.05,
              sizeMax: 0.12,
              colors: [[r, gv, b]],
            });
          }
        }
      }
      // Clean up known IDs for removed gadgets
      const currentIds = new Set(msg.gadgets.map(g => g.id));
      for (const id of knownGadgetIds) {
        if (!currentIds.has(id)) knownGadgetIds.delete(id);
      }
      gadgetRenderer.updateFromServer(msg.gadgets);
      break;
    }

    case 'rockets': {
      rocketRenderer.updateFromServer(msg.rockets);
      break;
    }

    case 'enemy_spotted': {
      // Minimap removed — spotted enemies are a no-op for now
      break;
    }

    case 'voxel_update': {
      // Apply voxel changes and remesh affected chunks
      const affectedChunks = new Set<string>();
      for (const change of msg.changes) {
        setVoxelShared(chunks, change.x, change.y, change.z, change.material);
        const { chunkKey } = worldToChunk(change.x, change.y, change.z);
        affectedChunks.add(chunkKey);
      }
      // Remesh all affected chunks
      for (const key of affectedChunks) {
        const voxels = chunks.get(key);
        if (voxels) {
          worldRenderer.setChunk(key, voxels);
        }
      }
      break;
    }

    case 'destruction_event': {
      for (const evt of msg.events) {
        handleDestructionEvent(evt);
      }
      break;
    }

    case 'chunks': {
      // Streaming chunks from server as player moves
      for (const cd of msg.chunks) {
        const voxels = new Uint8Array(cd.voxels);
        chunks.set(cd.key, voxels);
        worldRenderer.setChunk(cd.key, voxels);
      }
      break;
    }

    case 'room_created': {
      gameState.myId = msg.playerId;
      mainMenu.hide();
      lobbyScreen.show(msg.playerId, lobbyCallbacks);
      console.log(`Room created: ${msg.roomCode}`);
      break;
    }

    case 'room_joined': {
      gameState.myId = msg.playerId;
      mainMenu.hide();
      lobbyScreen.show(msg.playerId, lobbyCallbacks);
      console.log(`Joined room: ${msg.roomCode} (host: ${msg.hostId})`);
      break;
    }

    case 'room_error': {
      mainMenu.showError(msg.message);
      console.warn(`Room error: ${msg.message}`);
      break;
    }

    case 'lobby_state': {
      lobbyScreen.update(msg.players, msg.gameMode, msg.hostId, msg.roomCode);
      break;
    }

    case 'game_starting': {
      lobbyScreen.hide();
      // welcome message will follow, which sets up the game
      break;
    }

    case 'return_to_lobby': {
      resetClientGameState();
      lobbyScreen.show(gameState.myId ?? '', lobbyCallbacks);
      console.log('Returned to lobby');
      break;
    }

    case 'room_closed': {
      resetClientGameState();
      lobbyScreen.hide();
      mainMenu.show(onMainMenuChoice);
      mainMenu.showError('Room was closed by the host.');
      console.log('Room closed');
      break;
    }
  }
}

/** Handle destruction visual events — spawn debris + particles scaled by blast radius */
function handleDestructionEvent(evt: DestructionEvent): void {
  const materialColor = evt.materialColor || 0x888888;
  const r = Math.max(1, evt.radius);

  // ALL destroyed voxels become Rapier physics bodies
  if (evt.voxels && evt.voxels.length > 0 && evt.voxelColors && evt.voxelColors.length > 0) {
    physicsDebrisSystem.spawn(
      evt.kind,
      evt.voxels,
      evt.voxelColors,
      evt.impactDir ?? { x: 0, y: 0, z: 0 },
      evt.position,
      evt.voxelMaterials,
    );
  }

  // Particle colors
  const sparkColor: [number, number, number] = [
    Math.min(1.0, ((materialColor >> 16) & 0xff) / 255 * 1.2 + 0.3),
    Math.min(1.0, ((materialColor >> 8) & 0xff) / 255 * 0.8 + 0.1),
    Math.min(1.0, (materialColor & 0xff) / 255 * 0.5),
  ];
  const dustColor: [number, number, number] = [0.75, 0.7, 0.6];
  const smokeLight: [number, number, number] = [0.6, 0.58, 0.52];
  const smokeDark: [number, number, number] = [0.4, 0.38, 0.33];

  switch (evt.kind) {
    case 'bullet':
      // Small bright sparks
      particleSystem.emit({
        position: evt.position,
        count: 5,
        direction: { x: 0, y: 1, z: 0 },
        speedMin: 3,
        speedMax: 8,
        spread: Math.PI * 0.5,
        lifetimeMin: 0.1,
        lifetimeMax: 0.3,
        sizeMin: 0.1,
        sizeMax: 0.25,
        colors: [sparkColor],
        gravityScale: 0.5,
      });
      // Tiny smoke wisp
      particleSystem.emit({
        position: evt.position,
        count: 3,
        direction: { x: 0, y: 1, z: 0 },
        speedMin: 0.3,
        speedMax: 0.8,
        spread: Math.PI * 0.3,
        lifetimeMin: 1.0,
        lifetimeMax: 2.0,
        sizeMin: 0.3,
        sizeMax: 0.8,
        colors: [smokeLight, smokeDark],
        gravityScale: -0.05,
      });
      break;

    case 'explosion': {
      // --- DUST BURST: fast expanding ring ---
      particleSystem.emit({
        position: evt.position,
        count: Math.round(10 * r),
        speedMin: 2 * r,
        speedMax: 5 * r,
        spread: Math.PI * 2,
        lifetimeMin: 0.8,
        lifetimeMax: 2.0 + r * 0.5,
        sizeMin: 0.8 + r * 0.3,
        sizeMax: 2.0 + r * 0.8,
        colors: [dustColor, [0.6, 0.55, 0.45]],
        gravityScale: 0.1,
      });
      // --- SMOKE COLUMN: big, slow, lingering ---
      particleSystem.emit({
        position: evt.position,
        count: Math.round(8 * r),
        direction: { x: 0, y: 1, z: 0 },
        speedMin: 0.5,
        speedMax: 1.5 + r * 0.5,
        spread: Math.PI * 0.5,
        lifetimeMin: 3.0,
        lifetimeMax: 6.0 + r,
        sizeMin: 1.5 + r * 0.5,
        sizeMax: 4.0 + r * 1.5,
        colors: [smokeLight, smokeDark, dustColor],
        gravityScale: -0.03,
      });
      // --- HOT SPARKS ---
      particleSystem.emit({
        position: evt.position,
        count: Math.round(6 * r),
        speedMin: 6,
        speedMax: 15 + r * 3,
        spread: Math.PI * 2,
        lifetimeMin: 0.15,
        lifetimeMax: 0.4,
        sizeMin: 0.1,
        sizeMax: 0.3,
        colors: [sparkColor, [1.0, 0.9, 0.5], [1.0, 0.6, 0.2]],
        gravityScale: 0.5,
      });
      addScreenShake(evt.position, 0.15 + r * 0.1);
      break;
    }

    case 'crumble': {
      // Falling dust
      particleSystem.emit({
        position: evt.position,
        count: Math.round(6 * r),
        direction: { x: 0, y: -1, z: 0 },
        speedMin: 0.5,
        speedMax: 2 + r,
        spread: Math.PI * 0.5,
        lifetimeMin: 0.6,
        lifetimeMax: 1.5,
        sizeMin: 0.5,
        sizeMax: 1.2 + r * 0.3,
        colors: [dustColor],
        gravityScale: 0.15,
      });
      // Rising smoke
      particleSystem.emit({
        position: evt.position,
        count: Math.round(5 * r),
        direction: { x: 0, y: 1, z: 0 },
        speedMin: 0.3,
        speedMax: 1.0,
        spread: Math.PI * 0.5,
        lifetimeMin: 2.0,
        lifetimeMax: 4.0 + r,
        sizeMin: 1.0 + r * 0.3,
        sizeMax: 2.5 + r * 0.5,
        colors: [smokeLight, smokeDark],
        gravityScale: -0.03,
      });
      addScreenShake(evt.position, 0.1 + r * 0.05);
      break;
    }

    case 'collapse': {
      // --- MASSIVE DUST CLOUD: building-scale ---
      particleSystem.emit({
        position: evt.position,
        count: Math.round(15 * r),
        speedMin: 1 + r,
        speedMax: 5 + r * 2,
        spread: Math.PI * 2,
        lifetimeMin: 2.0,
        lifetimeMax: 4.0 + r,
        sizeMin: 2.0 + r * 0.5,
        sizeMax: 4.0 + r * 1.5,
        colors: [[0.8, 0.75, 0.65], [0.7, 0.65, 0.55], dustColor],
        gravityScale: 0.05,
      });
      // --- TOWERING SMOKE PLUME ---
      particleSystem.emit({
        position: evt.position,
        count: Math.round(12 * r),
        direction: { x: 0, y: 1, z: 0 },
        speedMin: 0.5 + r * 0.3,
        speedMax: 2.0 + r,
        spread: Math.PI * 0.6,
        lifetimeMin: 4.0,
        lifetimeMax: 8.0 + r,
        sizeMin: 3.0 + r,
        sizeMax: 6.0 + r * 2,
        colors: [smokeLight, smokeDark, [0.5, 0.48, 0.42]],
        gravityScale: -0.02,
      });
      // --- BRIGHT SPARKS ---
      particleSystem.emit({
        position: evt.position,
        count: Math.round(8 * r),
        speedMin: 5,
        speedMax: 12 + r * 3,
        spread: Math.PI * 2,
        lifetimeMin: 0.2,
        lifetimeMax: 0.6,
        sizeMin: 0.15,
        sizeMax: 0.4,
        colors: [sparkColor, [1.0, 0.9, 0.6], [1.0, 0.5, 0.1]],
        gravityScale: 0.3,
      });
      addScreenShake(evt.position, 0.2 + r * 0.12);
      break;
    }
  }
}

/** Add screen shake based on distance to the event */
function addScreenShake(eventPos: { x: number; y: number; z: number }, maxIntensity: number): void {
  const cam = renderer.camera;
  const dx = cam.position.x - eventPos.x;
  const dy = cam.position.y - eventPos.y;
  const dz = cam.position.z - eventPos.z;
  const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
  // Falloff: full intensity at 0m, zero at 30m
  const falloff = Math.max(0, 1 - dist / 30);
  const intensity = maxIntensity * falloff;
  // Additive: multiple nearby events stack
  screenShakeIntensity = Math.min(0.5, screenShakeIntensity + intensity);
}

const network = new NetworkClient(handleServerMessage);

// --- Game Loop ---
let lastTime = performance.now();
let frameCount = 0;

/** Hysteresis buffer: prune chunks beyond STREAM_RADIUS + 4 to avoid thrashing */
const PRUNE_DISTANCE = STREAM_RADIUS + 4;

function gameLoop(): void {
  requestAnimationFrame(gameLoop);

  const now = performance.now();
  const dt = (now - lastTime) / 1000;
  lastTime = now;
  frameCount++;

  // Update local player (skip while deploy screen is open)
  if (localPlayer && !deployScreen.isVisible()) {
    const inputPacket = localPlayer.update(dt);
    if (inputPacket) {
      // Handle weapon slot switching
      const desiredSlot = inputPacket.input.weaponSlot ?? 0;
      if (desiredSlot !== localPlayer.weaponCtrl.currentSlot) {
        localPlayer.weaponCtrl.switchWeapon(desiredSlot);
      }

      // If the player fired a rocket launcher, spawn a client-predicted rocket
      if (inputPacket.input.shoot && localPlayer.weaponCtrl.isRocketLauncher) {
        const cam = renderer.camera;
        const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
        const muzzlePos = {
          x: cam.position.x + dir.x * 1.0,
          y: cam.position.y + dir.y * 1.0 - 0.1,
          z: cam.position.z + dir.z * 1.0,
        };
        rocketRenderer.spawnLocal(
          muzzlePos,
          { x: dir.x, y: dir.y, z: dir.z },
          localPlayer.weaponCtrl.activeWeapon.projectileSpeed,
        );
      }

      // If the player fired this frame, spawn a client-predicted projectile
      if (inputPacket.input.shoot && !localPlayer.weaponCtrl.isRocketLauncher) {
        const cam = renderer.camera;
        const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
        const weapon = localPlayer.weaponCtrl.activeWeapon;

        // Spawn from slightly in front of camera to avoid clipping
        const muzzlePos = {
          x: cam.position.x + dir.x * 0.5,
          y: cam.position.y + dir.y * 0.5 - 0.1,
          z: cam.position.z + dir.z * 0.5,
        };

        // For shotguns, spawn one visual per pellet
        for (let p = 0; p < weapon.pellets; p++) {
          const spread = weapon.spread;
          let dx = dir.x, dy = dir.y, dz = dir.z;
          if (spread > 0) {
            dx += (Math.random() - 0.5) * spread * 2;
            dy += (Math.random() - 0.5) * spread * 2;
            dz += (Math.random() - 0.5) * spread * 2;
            const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
            dx /= len; dy /= len; dz /= len;
          }
          projectileRenderer.spawnLocal(
            muzzlePos,
            { x: dx, y: dy, z: dz },
            weapon.projectileSpeed,
            weapon.maxRange
          );
        }
      }

      // If the player used a gadget this frame, record time + play sound + spawn predicted visual
      if (inputPacket.input.useGadget) {
        gameState.lastGadgetUseTime = performance.now();
        soundManager.play(SoundId.GadgetDeploy);

        // Spawn a client-predicted gadget model at player feet for instant visual feedback
        const classDef = Object.values(CLASSES).find(c => c.id === gameState.selectedClass) as ClassDef | undefined;
        if (classDef) {
          const gadgetType = classDef.gadgets[inputPacket.input.gadgetIndex ?? 0];
          if (gadgetType) {
            const cam = renderer.camera;
            const gDir = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
            const spawnPos = {
              x: cam.position.x + gDir.x * 1.5,
              y: cam.position.y - (PLAYER_HEIGHT - 0.1) + 0.15,
              z: cam.position.z + gDir.z * 1.5,
            };
            gadgetRenderer.spawnLocal(spawnPos, gadgetType);
          }
        }
      }

      // If the player threw a grenade this frame, spawn a client-predicted grenade
      if (inputPacket.input.throwGrenade) {
        const cam = renderer.camera;
        const gDir = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
        const grenadePos = {
          x: cam.position.x + gDir.x * 0.5,
          y: cam.position.y + gDir.y * 0.5,
          z: cam.position.z + gDir.z * 0.5,
        };

        // Determine if this is a smoke or frag grenade from grenade index
        if ((inputPacket.input.grenadeIndex ?? 0) === 1) {
          grenadeRenderer.spawnLocalSmoke(grenadePos, { x: gDir.x, y: gDir.y, z: gDir.z });
        } else {
          grenadeRenderer.spawnLocal(grenadePos, { x: gDir.x, y: gDir.y, z: gDir.z });
        }
      }

      network.send({
        type: 'input',
        seq: inputPacket.seq,
        input: inputPacket.input,
        dt: inputPacket.dt,
      });
    }
  }

  // Interpolate projectile positions between server ticks
  projectileRenderer.update(dt);

  // Update grenades
  grenadeRenderer.update(dt);

  // Update rockets
  rocketRenderer.update(dt);

  // Update particles (dust, sparks) and debris cubes
  particleSystem.update(dt);
  debrisSystem.update(dt);
  physicsDebrisSystem.update(dt);

  // Update volumetric smoke clouds
  smokeSystem.update(dt);

  // Update gadgets
  gadgetRenderer.update(dt);

  // Update water mesh animation
  worldRenderer.update(dt);

  // Update weather (clouds, rain/snow particles, fog transitions)
  {
    const cam = renderer.camera;
    weatherManager.update(dt, { x: cam.position.x, y: cam.position.y, z: cam.position.z });
  }

  // Update capture point animations
  capturePointRenderer.update(dt);

  // Update remote players
  for (const remote of remotePlayers.values()) {
    remote.update(dt, renderer.camera);
  }

  // Check for nearby downed teammates and show revive prompt
  if (localPlayer && gameState.alive && !gameState.downed) {
    const cam = renderer.camera;
    let nearestDownedName: string | null = null;
    let nearestDist = Infinity;
    for (const remote of remotePlayers.values()) {
      if (!remote.downed || remote.team !== gameState.myTeam) continue;
      const rp = remote.getPosition();
      const dx = rp.x - cam.position.x;
      const dy = rp.y - cam.position.y;
      const dz = rp.z - cam.position.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (dist <= REVIVE_RADIUS && dist < nearestDist) {
        nearestDist = dist;
        nearestDownedName = remote.name;
      }
    }
    hud.showRevivePrompt(nearestDownedName);
  } else {
    hud.showRevivePrompt(null);
  }

  // Minimap removed

  // Radial menu + cover preview
  if (localPlayer) {
    const classDef = Object.values(CLASSES).find(c => c.id === gameState.selectedClass) as ClassDef | undefined;
    const isAssault = gameState.selectedClass === ClassId.Assault;

    // Radial menu: show/hide based on input state (all classes including Assault for frag/smoke selection)
    if (classDef && localPlayer.input.radialMenuOpen) {
      gameState.selectedGadgetIndex = localPlayer.input.selectedGadgetIndex;
      radialMenu.show(classDef, gameState.selectedGadgetIndex, gameState.lastGadgetUseTime, now);
    } else {
      radialMenu.hide();
    }

    // Grenade radial menu: show/hide on G hold
    if (localPlayer.input.grenadeRadialMenuOpen) {
      gameState.selectedGrenadeIndex = localPlayer.input.selectedGrenadeIndex;
      grenadeRadialMenu.show(gameState.selectedGrenadeIndex);
    } else {
      grenadeRadialMenu.hide();
    }

    // Cover preview: show for Engineer with RepairTool selected
    const isEngineer = gameState.selectedClass === ClassId.Engineer;
    const gadgetIdx = gameState.selectedGadgetIndex;
    const hasRepairTool = isEngineer && classDef && classDef.gadgets[gadgetIdx] === GadgetId.RepairTool;
    if (hasRepairTool && gameState.alive) {
      const cam = renderer.camera;
      const camDir = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
      const playerYaw = Math.atan2(camDir.x, -camDir.z);
      const gadgetCd = (GADGET_COOLDOWNS[GadgetId.RepairTool] ?? GADGET_COOLDOWN) * 1000;
      const gadgetReady = (now - gameState.lastGadgetUseTime) >= gadgetCd;
      coverPreview.update(
        { x: cam.position.x, y: cam.position.y - (PLAYER_HEIGHT - 0.1), z: cam.position.z },
        playerYaw,
        chunks,
        gadgetReady,
      );
    } else {
      coverPreview.hide();
    }
  }

  // Compute gadget cooldown info for HUD
  let gadgetName = '';
  let gadgetCooldownPct = 0;
  let gadgetReady = true;
  {
    const classDef = Object.values(CLASSES).find(c => c.id === gameState.selectedClass) as ClassDef | undefined;
    if (classDef) {
      const idx = gameState.selectedGadgetIndex;
      const gadgetId = classDef.gadgets[idx];
      const nameMap: Record<string, string> = {
        frag_grenade: 'Frag Grenade', smoke_grenade: 'Smoke',
        medkit: 'Medkit', bandage: 'Bandage', ammo_box: 'Ammo Box',
        repair_tool: 'Deploy Cover',
        spotting_scope: 'Spotting Scope', claymore: 'Claymore',
      };
      gadgetName = nameMap[gadgetId] ?? gadgetId;
      const cooldown = (GADGET_COOLDOWNS[gadgetId] ?? GADGET_COOLDOWN) * 1000;
      const elapsed = now - gameState.lastGadgetUseTime;
      gadgetCooldownPct = Math.max(0, Math.min(1, (cooldown - elapsed) / cooldown));
      gadgetReady = elapsed >= cooldown;
    }
  }

  // Compute weapon name and player yaw for HUD
  const weaponName = localPlayer?.weaponCtrl.activeWeapon.name ?? '';
  let playerYaw = 0;
  if (localPlayer) {
    const cam = renderer.camera;
    const camDir = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    playerYaw = Math.atan2(camDir.x, -camDir.z);
  }

  // Update HUD
  hud.update({
    health: gameState.health,
    ammo: gameState.ammo,
    maxAmmo: gameState.maxAmmo,
    reloading: gameState.reloading,
    ticketsAlpha: gameState.ticketsAlpha,
    ticketsBravo: gameState.ticketsBravo,
    myTeam: gameState.myTeam,
    alive: gameState.alive,
    className: gameState.selectedClassName,
    gameMode: gameState.gameMode,
    conquestScoreAlpha: gameState.conquestScoreAlpha,
    conquestScoreBravo: gameState.conquestScoreBravo,
    gadgetName,
    gadgetCooldownPct,
    gadgetReady,
    weaponName,
    playerYaw,
  });

  // Update damage indicators
  damageIndicator.update(dt);

  // Scoreboard visibility (Tab key)
  if (localPlayer) {
    scoreboard.setVisible(localPlayer.input.scoreboardVisible);
  }

  // Update chunk LOD levels based on distance to camera
  if (localPlayer && frameCount % LOD_UPDATE_INTERVAL === 0) {
    const cam = renderer.camera;
    worldRenderer.updateLod({ x: cam.position.x, y: cam.position.y, z: cam.position.z });
  }

  // Prune distant chunks every ~60 frames (~1 second at 60fps)
  if (localPlayer && frameCount % 60 === 0) {
    const cam = renderer.camera;
    const removed = worldRenderer.pruneDistant(
      { x: cam.position.x, y: cam.position.y, z: cam.position.z },
      PRUNE_DISTANCE
    );
    for (const key of removed) {
      chunks.delete(key);
    }
  }

  // Move sun shadow to follow player
  if (localPlayer) {
    const cam = renderer.camera;
    renderer.updateSunTarget({ x: cam.position.x, y: cam.position.y, z: cam.position.z });
  }

  // Underwater visual effect: tint fog and background when submerged
  // (weather manager handles normal fog; only override when underwater)
  weatherManager.setUnderwater(gameState.inWater);
  if (gameState.inWater) {
    weatherManager.sky.visible = false;
    renderer.scene.background = underwaterColor;
    setFogUniforms({ color: underwaterColor, near: 5, far: 60, heightDensity: 0.0, heightOrigin: 0 });
  } else {
    weatherManager.sky.visible = true;
    renderer.scene.background = null;
  }

  // Sort water faces back-to-front for correct transparency
  if (localPlayer) {
    const cam = renderer.camera;
    worldRenderer.sortWater({ x: cam.position.x, y: cam.position.y, z: cam.position.z });
  }

  // Apply screen shake (small random rotation offset, decaying)
  if (screenShakeIntensity > 0.001) {
    const cam = renderer.camera;
    cam.rotation.x += (Math.random() - 0.5) * screenShakeIntensity * 0.1;
    cam.rotation.y += (Math.random() - 0.5) * screenShakeIntensity * 0.1;
    screenShakeIntensity *= Math.exp(-SCREEN_SHAKE_DECAY * dt);
  }

  // Render
  renderer.render();

  // Update spatial audio listener position
  if (localPlayer) {
    const cam = renderer.camera;
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(cam.quaternion);
    soundManager.updateListener(
      { x: cam.position.x, y: cam.position.y, z: cam.position.z },
      { x: forward.x, y: forward.y, z: forward.z },
      { x: up.x, y: up.y, z: up.z },
    );
  }
}

// --- HUD ---
const hud = new HUD();
const damageIndicator = new DamageIndicatorSystem();
const scoreboard = new Scoreboard();
const deployScreen = new DeployScreen();
const mainMenu = new MainMenu();
const lobbyScreen = new LobbyScreen();

function showDeployScreen(spawns: SpawnPointOption[]): void {
  // Build player dot array for the deploy map
  const playerDots: Array<{ position: { x: number; y: number; z: number }; team: number; alive: boolean }> = [];
  for (const remote of remotePlayers.values()) {
    playerDots.push({
      position: remote.getPosition(),
      team: remote.team,
      alive: remote.alive,
    });
  }

  deployScreen.show(
    spawns,
    gameState.myTeam,
    gameState.capturePoints,
    chunks,
    playerDots,
    (choice) => {
      gameState.selectedClass = choice.classId;
      gameState.selectedWeapon = choice.weaponId;
      gameState.selectedLoadout = choice.loadout;
      // Look up display name from CLASSES
      const cls = Object.values(CLASSES).find(c => c.id === choice.classId);
      gameState.selectedClassName = cls?.name ?? 'Assault';

      network.send({
        type: 'deploy',
        classId: choice.classId,
        weaponId: choice.weaponId,
        spawnPointId: choice.spawnPointId,
      });
    },
  );
}

/** Reset all client-side game state for returning to lobby */
function resetClientGameState(): void {
  // Clear local player reference (no dispose method — GC will clean up)
  localPlayer = null;

  // Dispose all remote players
  for (const remote of remotePlayers.values()) {
    remote.dispose(renderer.scene);
  }
  remotePlayers.clear();

  // Clear chunks and reload world renderer with empty map
  chunks.clear();
  worldRenderer.loadAll(chunks);

  // Clear renderer visuals by sending empty server state
  projectileRenderer.updateFromServer([]);
  grenadeRenderer.updateFromServer([]);
  rocketRenderer.updateFromServer([]);
  gadgetRenderer.updateFromServer([]);
  capturePointRenderer.updateFromServer([]);
  knownGadgetIds.clear();

  // Hide game UI
  deployScreen.hide();
  hud.hideDeath();
  hud.hideGameOver();

  // Reset game state
  gameState.myTeam = -1;
  gameState.ticketsAlpha = 75;
  gameState.ticketsBravo = 75;
  gameState.kills = [];
  gameState.alive = true;
  gameState.downed = false;
  gameState.health = 100;
  gameState.ammo = 30;
  gameState.maxAmmo = 30;
  gameState.reloading = false;
  gameState.inWater = false;
  gameState.gameOver = false;
  gameState.winner = -1;
  gameState.capturePoints = [];
  gameState.conquestScoreAlpha = 0;
  gameState.conquestScoreBravo = 0;

  console.log('Client game state reset');
}

// --- Lobby callbacks ---
const lobbyCallbacks = {
  onSetTeam: (team: number) => {
    network.send({ type: 'lobby_set_team', team });
  },
  onSetMode: (mode: GameMode) => {
    network.send({ type: 'lobby_set_mode', gameMode: mode });
  },
  onStartGame: () => {
    network.send({ type: 'start_game' });
  },
  onLeave: () => {
    network.send({ type: 'return_to_menu' });
    lobbyScreen.hide();
    mainMenu.show(onMainMenuChoice);
  },
};

// --- Main menu handler ---
function onMainMenuChoice(choice: { action: string; name: string; roomCode?: string }): void {
  // Connect first (if not already), then send room message
  const sendRoomMessage = () => {
    if (choice.action === 'host') {
      network.send({ type: 'create_room', name: choice.name });
    } else {
      network.send({ type: 'join_room', name: choice.name, roomCode: choice.roomCode ?? '' });
    }
  };

  if (network.connected) {
    sendRoomMessage();
  } else {
    mainMenu.showError('Connecting to server...');
    network.onConnected = sendRoomMessage;
    network.onConnectionFailed = () => {
      mainMenu.showError('Could not connect to server. Is it running?');
    };
    network.connect();
  }
}

// --- Start ---
console.log('Clawfield client starting...');

// Preload 3D models (non-blocking; falls back to procedural if missing)
loadSoldierModel();
preloadWeaponModels();

// Show the main menu
mainMenu.show(onMainMenuChoice);

// Init sound on first user click (browser requires user gesture for AudioContext)
// If a sound pack exists at /sounds/default/, it will be loaded asynchronously.
// Any sounds not covered by the pack fall back to procedural generation.
document.addEventListener('click', () => {
  soundManager.init();
  soundManager.loadPack('/sounds/default/').catch(() => {
    // No sound pack found — procedural fallback is used for all sounds
  });
}, { once: true });

// Start game loop
gameLoop();
