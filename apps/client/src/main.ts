import * as THREE from 'three';
import { getVoxel, setVoxel as setVoxelShared, worldToChunk, PLAYER_HEIGHT, loadPalette, STREAM_RADIUS, LOD_UPDATE_INTERVAL, CLASSES } from '@clawfield/shared';
import type { ServerMessage, PlayerState, KillEntry, GameMode } from '@clawfield/shared';
import { Renderer } from './renderer';
import { WorldRenderer } from './voxel/world-renderer';
import { deserializeChunks } from './voxel/test-map';
import { LocalPlayer } from './player/local-player';
import { RemotePlayer } from './player/remote-player';
import { NetworkClient } from './network';
import { HUD } from './hud/hud';
import { ProjectileRenderer } from './combat/projectile-renderer';
import { CapturePointRenderer } from './combat/capture-point-renderer';
import { GrenadeRenderer } from './combat/grenade-renderer';
import { GadgetRenderer } from './combat/gadget-renderer';
import { ParticleSystem } from './combat/particle-system';
import { Minimap } from './hud/minimap';
import { DamageIndicatorSystem } from './hud/damage-indicator';
import { Scoreboard } from './hud/scoreboard';
import { soundManager } from './audio/sound-manager';
import { DeployScreen } from './hud/deploy-screen';
import { MainMenu } from './hud/main-menu';
import { loadSoldierModel } from './player/model-loader';
import type { CapturePointState, MapObjective, SpawnPointOption } from '@clawfield/shared';

// --- Game State (exported for HUD) ---
export const gameState = {
  myId: null as string | null,
  myTeam: -1,
  ticketsAlpha: 75,
  ticketsBravo: 75,
  kills: [] as KillEntry[],
  alive: true,
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
  gameMode: 'tdm' as GameMode,
};

// --- State ---
let chunks = new Map<string, Uint8Array>();
let localPlayer: LocalPlayer | null = null;
const remotePlayers = new Map<string, RemotePlayer>();

// --- Setup ---
const renderer = new Renderer();
const worldRenderer = new WorldRenderer(renderer.scene);
const particleSystem = new ParticleSystem(renderer.scene);
const projectileRenderer = new ProjectileRenderer(renderer.scene);
projectileRenderer.setParticleSystem(particleSystem);
const capturePointRenderer = new CapturePointRenderer(renderer.scene);
const grenadeRenderer = new GrenadeRenderer(renderer.scene);
grenadeRenderer.setParticleSystem(particleSystem);
const gadgetRenderer = new GadgetRenderer(renderer.scene);
const minimap = new Minimap();

// Voxel getter for physics
const voxelGetter = (wx: number, wy: number, wz: number) => getVoxel(chunks, wx, wy, wz);

// Colors for underwater effect
const skyColor = new THREE.Color(0x7ec8e3);
const fogColor = new THREE.Color(0xa9c2d0);
const underwaterColor = new THREE.Color(0x1a5276);

// --- Network ---
function handleServerMessage(msg: ServerMessage): void {
  switch (msg.type) {
    case 'welcome': {
      gameState.myId = msg.id;
      gameState.myTeam = msg.team;
      gameState.gameMode = msg.gameMode;
      console.log(`Joined as ${gameState.myId} on team ${msg.team} (mode: ${msg.gameMode})`);

      // Load palette before building meshes so colors are correct
      if (msg.palette) {
        loadPalette(msg.palette);
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
      // Find killer name from remote players
      const killerRemote = remotePlayers.get(msg.killerId);
      const killerName = killerRemote?.name ?? 'Unknown';
      localPlayer?.onDeath(msg.killerPos);
      hud.showDeath(msg.respawnTime, killerName);
      // Deploy screen will be shown when server sends available_spawns after respawn delay
      break;
    }

    case 'respawn': {
      gameState.alive = true;
      deployScreen.hide();
      hud.hideDeath();
      if (!localPlayer) {
        // First spawn — create local player
        localPlayer = new LocalPlayer(renderer.scene, renderer.camera, voxelGetter, gameState.selectedClass);
        localPlayer.weaponCtrl.setParticleSystem(particleSystem);
      }
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
      gadgetRenderer.updateFromServer(msg.gadgets);
      break;
    }

    case 'enemy_spotted': {
      minimap.setSpottedEnemies(msg.positions, msg.duration);
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

    case 'chunks': {
      // Streaming chunks from server as player moves
      for (const cd of msg.chunks) {
        const voxels = new Uint8Array(cd.voxels);
        chunks.set(cd.key, voxels);
        worldRenderer.setChunk(cd.key, voxels);
      }
      break;
    }
  }
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
      // If the player fired this frame, spawn a client-predicted projectile
      if (inputPacket.input.shoot) {
        const cam = renderer.camera;
        const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
        const weapon = localPlayer.weaponCtrl.weapon;

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

      // If the player threw a grenade this frame, spawn a client-predicted grenade
      if (inputPacket.input.throwGrenade) {
        const cam = renderer.camera;
        const gDir = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
        const grenadePos = {
          x: cam.position.x + gDir.x * 0.5,
          y: cam.position.y + gDir.y * 0.5,
          z: cam.position.z + gDir.z * 0.5,
        };
        grenadeRenderer.spawnLocal(grenadePos, { x: gDir.x, y: gDir.y, z: gDir.z });
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

  // Update particles (bullet impacts, explosion debris, muzzle flash)
  particleSystem.update(dt);

  // Update gadgets
  gadgetRenderer.update(dt);

  // Update water mesh animation
  worldRenderer.update(dt);

  // Update capture point animations
  capturePointRenderer.update(dt);

  // Update remote players
  for (const remote of remotePlayers.values()) {
    remote.update(renderer.camera);
  }

  // Update minimap
  if (localPlayer) {
    const cam = renderer.camera;
    const allPlayers: Array<{ position: { x: number; y: number; z: number }; team: number; alive: boolean }> = [];
    for (const remote of remotePlayers.values()) {
      allPlayers.push({
        position: remote.getPosition(),
        team: remote.team,
        alive: remote.alive,
      });
    }
    // Extract yaw from camera quaternion (rotation around Y axis)
    const camDir = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    const playerYaw = Math.atan2(camDir.x, -camDir.z);
    minimap.update(
      { x: cam.position.x, y: cam.position.y, z: cam.position.z },
      playerYaw,
      gameState.myTeam,
      allPlayers,
      gameState.capturePoints,
      gameState.mapObjectives
    );
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
  if (gameState.inWater) {
    renderer.scene.background = underwaterColor;
    if (renderer.scene.fog) {
      (renderer.scene.fog as THREE.Fog).color.copy(underwaterColor);
      (renderer.scene.fog as THREE.Fog).near = 5;
      (renderer.scene.fog as THREE.Fog).far = 60;
    }
  } else {
    renderer.scene.background = skyColor;
    if (renderer.scene.fog) {
      (renderer.scene.fog as THREE.Fog).color.copy(fogColor);
      (renderer.scene.fog as THREE.Fog).near = 120;
      (renderer.scene.fog as THREE.Fog).far = 320;
    }
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

function showDeployScreen(spawns: SpawnPointOption[]): void {
  deployScreen.show(
    spawns,
    gameState.myTeam,
    gameState.capturePoints,
    (choice) => {
      gameState.selectedClass = choice.classId;
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

// --- Start ---
console.log('Clawfield client starting...');

// Preload 3D soldier model (non-blocking; falls back to box if missing)
loadSoldierModel();

// Show the main menu — player picks name and game mode before connecting
mainMenu.show((choice) => {
  mainMenu.hide();

  // Connect and join with chosen name + mode
  network.onConnected = () => {
    network.join(choice.name, choice.gameMode);
  };
  network.connect();
});

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
