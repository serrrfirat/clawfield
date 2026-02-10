import { VOICE_FULL_DISTANCE, VOICE_MAX_DISTANCE, VOICE_PROXIMITY_TICKS } from '@clawfield/shared';
import type { VoipSignalData, VoipProximityEntry } from '@clawfield/shared';
import { NetworkServer, type Client } from './network.js';
import type { PlayerSim } from './player-sim.js';

/** Minimum gain change to trigger a routing update to a client */
const GAIN_CHANGE_THRESHOLD = 0.05;

/** Cached proximity entry per listener→speaker pair */
interface CachedRoute {
  gain: number;
}

/**
 * VoipManager handles:
 * 1. Relaying WebRTC signaling messages between peers (server is just a pass-through)
 * 2. Computing voice proximity and sending gain/position updates to clients
 *
 * The server never touches audio data — all audio flows peer-to-peer via WebRTC.
 */
export class VoipManager {
  private network: NetworkServer;

  /** Previous routing state per listener, used to detect changes */
  private prevRoutes = new Map<string, Map<string, CachedRoute>>();

  /** Tick counter for proximity update interval */
  private tickCounter = 0;

  constructor(network: NetworkServer) {
    this.network = network;
  }

  /**
   * Relay a VoIP signaling message from one peer to another.
   * The server does not interpret the signal — just forwards it.
   */
  relaySignal(fromClient: Client, targetId: string, signal: VoipSignalData): void {
    const clients = this.network.getClients();
    const target = clients.get(targetId);
    if (!target) return;

    this.network.send(target, {
      type: 'voip_signal',
      fromId: fromClient.id,
      signal,
    });
  }

  /**
   * Called every server tick from GameLoop.
   * Computes proximity only every VOICE_PROXIMITY_TICKS ticks.
   */
  updateProximity(players: Map<string, PlayerSim>): void {
    this.tickCounter++;
    if (this.tickCounter % VOICE_PROXIMITY_TICKS !== 0) return;

    const clients = this.network.getClients();
    const alivePlayers: PlayerSim[] = [];

    // Collect alive, connected players only
    for (const sim of players.values()) {
      if (!sim.disconnected) {
        alivePlayers.push(sim);
      }
    }

    // For each listener, compute proximity to all other players
    for (const listener of alivePlayers) {
      const client = clients.get(listener.id);
      if (!client) continue;

      const peers: VoipProximityEntry[] = [];
      let changed = false;
      const prevListenerRoutes = this.prevRoutes.get(listener.id) ?? new Map();
      const newListenerRoutes = new Map<string, CachedRoute>();

      for (const speaker of alivePlayers) {
        if (speaker.id === listener.id) continue;

        const dx = listener.position.x - speaker.position.x;
        const dy = listener.position.y - speaker.position.y;
        const dz = listener.position.z - speaker.position.z;
        const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);

        let gain: number;
        if (distance <= VOICE_FULL_DISTANCE) {
          gain = 1.0;
        } else if (distance <= VOICE_MAX_DISTANCE) {
          gain = 1.0 - (distance - VOICE_FULL_DISTANCE) / (VOICE_MAX_DISTANCE - VOICE_FULL_DISTANCE);
        } else {
          gain = 0.0;
        }

        // Round gain to 2 decimal places to reduce noise
        gain = Math.round(gain * 100) / 100;

        newListenerRoutes.set(speaker.id, { gain });

        // Check if this route changed
        const prev = prevListenerRoutes.get(speaker.id);
        if (!prev || Math.abs(prev.gain - gain) >= GAIN_CHANGE_THRESHOLD) {
          changed = true;
        }

        // Include in the update if audible
        if (gain > 0) {
          peers.push({
            peerId: speaker.id,
            gain,
            position: { x: speaker.position.x, y: speaker.position.y, z: speaker.position.z },
          });
        }
      }

      // Also detect removed speakers (player left or died)
      for (const prevId of prevListenerRoutes.keys()) {
        if (!newListenerRoutes.has(prevId)) {
          changed = true;
        }
      }

      this.prevRoutes.set(listener.id, newListenerRoutes);

      // Only send update if something changed
      if (changed) {
        this.network.send(client, {
          type: 'voip_proximity',
          peers,
        });
      }
    }
  }

  /** Remove a player from proximity tracking (on disconnect). */
  removePlayer(playerId: string): void {
    this.prevRoutes.delete(playerId);
    // Clean up references to this player from other listeners' caches
    for (const routes of this.prevRoutes.values()) {
      routes.delete(playerId);
    }
  }

  /** Clean up all state. */
  destroy(): void {
    this.prevRoutes.clear();
    this.tickCounter = 0;
  }
}
