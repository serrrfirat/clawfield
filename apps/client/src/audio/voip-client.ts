/**
 * VoipClient — WebRTC peer-to-peer mesh for proximity voice chat.
 *
 * Each client establishes a direct RTCPeerConnection to every other player.
 * Audio is captured via getUserMedia and sent peer-to-peer.
 * The server sends proximity data (gain + position per peer) which this
 * class applies to Web Audio API gain/panner nodes for spatial voice.
 *
 * Signaling (SDP offers/answers, ICE candidates) goes through the existing
 * WebSocket via the NetworkClient.
 */

import type { NetworkClient } from '../network';
import type { VoipSignalData, VoipProximityEntry } from '@clawfield/shared';

/** WebRTC configuration — STUN servers for NAT traversal */
const RTC_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
};

/** VAD: RMS threshold in dB below which we consider silence */
const VAD_THRESHOLD_DB = -45;

/** VAD check interval in ms */
const VAD_INTERVAL = 100;

/** Per-peer audio processing chain */
interface PeerAudio {
  pc: RTCPeerConnection;
  /** Remote audio stream received from this peer */
  stream: MediaStream | null;
  /** Web Audio source from the remote stream */
  sourceNode: MediaStreamAudioSourceNode | null;
  /** Gain controlled by server proximity data */
  gainNode: GainNode;
  /** HRTF panner positioned at the peer's world location */
  pannerNode: PannerNode;
  /** Current gain from proximity (for speaking detection) */
  currentGain: number;
}

export class VoipClient {
  private network: NetworkClient;
  private audioCtx: AudioContext;
  private masterGain: GainNode;
  private myId: string;

  /** Local microphone stream */
  private localStream: MediaStream | null = null;

  /** Per-peer WebRTC connections and audio chains */
  private peers = new Map<string, PeerAudio>();

  /** Whether the local player is currently speaking (VAD) */
  private _speaking = false;

  /** VAD analyser for local mic */
  private vadAnalyser: AnalyserNode | null = null;
  private vadInterval: ReturnType<typeof setInterval> | null = null;
  private vadBuffer: Float32Array | null = null;

  /** Set of peer IDs that are currently speaking (gain > 0.05) */
  private _speakingPeers = new Set<string>();

  /** Whether mic was denied */
  private _micDenied = false;

  constructor(network: NetworkClient, audioCtx: AudioContext, masterGain: GainNode, myId: string) {
    this.network = network;
    this.audioCtx = audioCtx;
    this.masterGain = masterGain;
    this.myId = myId;
  }

  /** Whether the local player is speaking */
  get speaking(): boolean {
    return this._speaking;
  }

  /** Whether mic access was denied */
  get micDenied(): boolean {
    return this._micDenied;
  }

  /** Check if a remote peer is speaking */
  isPeerSpeaking(peerId: string): boolean {
    return this._speakingPeers.has(peerId);
  }

  /**
   * Initialize: capture microphone and set up VAD.
   * Should be called after user gesture.
   */
  async init(): Promise<void> {
    try {
      this.localStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      this._micDenied = false;

      // Set up VAD
      this.setupVAD();
    } catch (err) {
      console.warn('VoipClient: Microphone access denied', err);
      this._micDenied = true;
      // Player can still receive voice from others
    }
  }

  /**
   * Handle a VoIP signaling message received from the server (relayed from another peer).
   */
  async handleSignal(fromId: string, signal: VoipSignalData): Promise<void> {
    switch (signal.type) {
      case 'offer': {
        // Remote peer is initiating a connection to us
        const peer = this.getOrCreatePeer(fromId);
        await peer.pc.setRemoteDescription(
          new RTCSessionDescription({ type: 'offer', sdp: signal.sdp })
        );
        const answer = await peer.pc.createAnswer();
        await peer.pc.setLocalDescription(answer);
        this.network.send({
          type: 'voip_signal',
          targetId: fromId,
          signal: { type: 'answer', sdp: answer.sdp },
        });
        break;
      }

      case 'answer': {
        const peer = this.peers.get(fromId);
        if (!peer) return;
        await peer.pc.setRemoteDescription(
          new RTCSessionDescription({ type: 'answer', sdp: signal.sdp })
        );
        break;
      }

      case 'ice': {
        const peer = this.peers.get(fromId);
        if (!peer) return;
        if (signal.candidate) {
          await peer.pc.addIceCandidate(
            new RTCIceCandidate({
              candidate: signal.candidate,
              sdpMid: signal.sdpMid,
              sdpMLineIndex: signal.sdpMLineIndex,
            })
          );
        }
        break;
      }
    }
  }

  /**
   * Initiate a WebRTC connection to a new peer.
   * Only the peer with the lexicographically lower ID initiates to avoid duplicates.
   */
  async connectToPeer(peerId: string): Promise<void> {
    if (this.myId >= peerId) return; // Other side will initiate
    if (this.peers.has(peerId)) return; // Already connected

    const peer = this.getOrCreatePeer(peerId);
    const offer = await peer.pc.createOffer();
    await peer.pc.setLocalDescription(offer);
    this.network.send({
      type: 'voip_signal',
      targetId: peerId,
      signal: { type: 'offer', sdp: offer.sdp },
    });
  }

  /**
   * Disconnect from a peer (player left the game).
   */
  disconnectPeer(peerId: string): void {
    const peer = this.peers.get(peerId);
    if (!peer) return;

    peer.pc.close();
    if (peer.sourceNode) {
      peer.sourceNode.disconnect();
    }
    peer.gainNode.disconnect();
    peer.pannerNode.disconnect();
    this.peers.delete(peerId);
    this._speakingPeers.delete(peerId);
  }

  /**
   * Apply proximity routing data from the server.
   * Updates gain and spatial position for each audible peer.
   */
  updateProximity(entries: VoipProximityEntry[]): void {
    // Build a set of peers in this update
    const updatedPeers = new Set<string>();

    for (const entry of entries) {
      updatedPeers.add(entry.peerId);
      const peer = this.peers.get(entry.peerId);
      if (!peer) continue;

      peer.currentGain = entry.gain;

      // Smoothly transition gain
      peer.gainNode.gain.setTargetAtTime(entry.gain, this.audioCtx.currentTime, 0.05);

      // Update spatial position
      const t = this.audioCtx.currentTime;
      peer.pannerNode.positionX.setTargetAtTime(entry.position.x, t, 0.05);
      peer.pannerNode.positionY.setTargetAtTime(entry.position.y, t, 0.05);
      peer.pannerNode.positionZ.setTargetAtTime(entry.position.z, t, 0.05);

      // Track speaking state
      if (entry.gain > 0.05) {
        this._speakingPeers.add(entry.peerId);
      } else {
        this._speakingPeers.delete(entry.peerId);
      }
    }

    // Mute peers not in the update (out of range)
    for (const [peerId, peer] of this.peers) {
      if (!updatedPeers.has(peerId)) {
        peer.currentGain = 0;
        peer.gainNode.gain.setTargetAtTime(0, this.audioCtx.currentTime, 0.05);
        this._speakingPeers.delete(peerId);
      }
    }
  }

  /** Clean up everything. */
  destroy(): void {
    // Stop VAD
    if (this.vadInterval) {
      clearInterval(this.vadInterval);
      this.vadInterval = null;
    }
    if (this.vadAnalyser) {
      this.vadAnalyser.disconnect();
      this.vadAnalyser = null;
    }

    // Stop local mic
    if (this.localStream) {
      for (const track of this.localStream.getTracks()) {
        track.stop();
      }
      this.localStream = null;
    }

    // Close all peer connections
    for (const [id] of this.peers) {
      this.disconnectPeer(id);
    }
    this.peers.clear();
    this._speakingPeers.clear();
    this._speaking = false;
  }

  // ── Private helpers ──────────────────────────────────────────

  /**
   * Create (or get) a peer connection + audio chain for a remote player.
   */
  private getOrCreatePeer(peerId: string): PeerAudio {
    const existing = this.peers.get(peerId);
    if (existing) return existing;

    const pc = new RTCPeerConnection(RTC_CONFIG);

    // Add local audio track if available
    if (this.localStream) {
      for (const track of this.localStream.getAudioTracks()) {
        pc.addTrack(track, this.localStream);
      }
    }

    // Create audio processing chain (starts silent until server sends proximity)
    const gainNode = this.audioCtx.createGain();
    gainNode.gain.value = 0;

    const pannerNode = this.audioCtx.createPanner();
    pannerNode.panningModel = 'HRTF';
    pannerNode.distanceModel = 'inverse';
    pannerNode.refDistance = 1;
    pannerNode.maxDistance = 100;
    pannerNode.rolloffFactor = 0; // We control gain server-side, not via distance model
    pannerNode.coneInnerAngle = 360; // Omnidirectional
    pannerNode.coneOuterAngle = 360;

    gainNode.connect(pannerNode);
    pannerNode.connect(this.masterGain);

    const peer: PeerAudio = {
      pc,
      stream: null,
      sourceNode: null,
      gainNode,
      pannerNode,
      currentGain: 0,
    };

    // Handle incoming audio track from the remote peer
    pc.ontrack = (event) => {
      const stream = event.streams[0];
      if (!stream) return;
      peer.stream = stream;

      // Connect to Web Audio processing chain
      const sourceNode = this.audioCtx.createMediaStreamSource(stream);
      sourceNode.connect(gainNode);
      peer.sourceNode = sourceNode;
    };

    // Handle ICE candidates — relay through server
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.network.send({
          type: 'voip_signal',
          targetId: peerId,
          signal: {
            type: 'ice',
            candidate: event.candidate.candidate,
            sdpMid: event.candidate.sdpMid,
            sdpMLineIndex: event.candidate.sdpMLineIndex,
          },
        });
      }
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
        console.warn(`VoIP: peer ${peerId} connection ${pc.connectionState}`);
      }
    };

    this.peers.set(peerId, peer);
    return peer;
  }

  /**
   * Set up Voice Activity Detection on the local microphone.
   * Uses an AnalyserNode to check RMS volume at regular intervals.
   */
  private setupVAD(): void {
    if (!this.localStream) return;

    const source = this.audioCtx.createMediaStreamSource(this.localStream);
    this.vadAnalyser = this.audioCtx.createAnalyser();
    this.vadAnalyser.fftSize = 256;
    source.connect(this.vadAnalyser);
    // Don't connect analyser to destination — we only read from it

    this.vadBuffer = new Float32Array(this.vadAnalyser.fftSize);

    this.vadInterval = setInterval(() => {
      if (!this.vadAnalyser || !this.vadBuffer) return;

      this.vadAnalyser.getFloatTimeDomainData(this.vadBuffer);
      let sum = 0;
      for (let i = 0; i < this.vadBuffer.length; i++) {
        sum += this.vadBuffer[i] * this.vadBuffer[i];
      }
      const rms = Math.sqrt(sum / this.vadBuffer.length);
      const db = rms > 0 ? 20 * Math.log10(rms) : -100;
      this._speaking = db > VAD_THRESHOLD_DB;
    }, VAD_INTERVAL);
  }
}
