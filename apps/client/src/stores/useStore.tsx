import { create } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'
import * as THREE from 'three'
import type { CollisionDisc, GameMode, PlacementCollider, PlayerState, KillEntry, CapturePointState, ScoreboardEntry, ServerMessage, ProjectileState, GrenadeState, SmokeGrenadeState, FlashGrenadeState, ExplosionEvent, SmokeDeployEvent, FlashDetonateEvent, MatchConfig, Vec3, LobbyPlayer, ServerPhase } from '@clawfield/shared'
import type { MapdefPlacement } from '../editor/editor-types'
import type { TerrainHeightmap } from '../editor/editor-types'
import type { RoadSpline } from '../editor/editor-types'

type LocalMapTerrain = {
    seed: number
    scale: number
    amplitude: number
    waterLevel?: number
    heightmap?: TerrainHeightmap
}

const THEMES = {
    dark: {
        terrain: '#3f5553',
        background: '#203a3b',
        grassBase: '#396c18',
        grassTop: '#77aa1a',
        leaves: '#cb3e0b',
        bushFresnelColor: '#ffcc00',
    },
    light: {
        terrain: '#908343',
        background: '#9a9065',
        grassBase: '#669019',
        grassTop: '#acc125',
        leaves: '#204a11',
        bushFresnelColor: '#84cd27',
    },
} as const

type ThemeName = keyof typeof THEMES

const DEFAULT_THEME: ThemeName = 'light'
const DEFAULT_COLORS = THEMES[DEFAULT_THEME]

const createStore = () =>
    create(
        subscribeWithSelector((set: any) => ({
            /** Trail texture (used by terrain shader for ground markings) */
            trailTexture: null as THREE.Texture | null,
            setTrailTexture: (texture: THREE.Texture | null) => {
                set({ trailTexture: texture })
            },

            /** Camera follow target — set by PlayerController each frame */
            ballPosition: new THREE.Vector3(0, 0, 0),
            setBallPosition: (position: THREE.Vector3) => {
                set({ ballPosition: position })
            },

            /** Smoothed center for grass/terrain circle fade */
            smoothedCircleCenter: new THREE.Vector3(0, 0, 0),
            setSmoothedCircleCenter: (position: THREE.Vector3) => {
                set({ smoothedCircleCenter: position })
            },

            /** Distance from player to ground (terrain shader uses this) */
            landBallDistance: 1.0,
            setLandBallDistance: (distance: number) => {
                set({ landBallDistance: distance })
            },

            // ── Visual parameters (unchanged from prototype) ──────────

            terrainParameters: {
                color: DEFAULT_COLORS.terrain,
                backgroundColor: DEFAULT_COLORS.background,
                chunkSize: 10,
                segments: 16,
                scale: 0.05,
                amplitude: 2,
            },

            borderParameters: {
                noiseStrength: 0.45,
                noiseScale: 0.35,
                circleRadiusFactor: 0.9,
                grassFadeOffset: 3.5,
                groundOffset: -0.75,
                groundFadeOffset: 1.0,
                borderTreesMultiplier: 0.9,
            },

            ditheringParameters: {
                ditherMode: 'Diamond',
                pixelSize: 1,
            },

            grassParameters: {
                colorBase: DEFAULT_COLORS.grassBase,
                colorTop: DEFAULT_COLORS.grassTop,
                count: 2500,
                segmentsCount: 4,
                width: 0.15,
                height: 1.15,
                leanFactor: 0.2,
                sobelMode: 2.0,
                flowersEnabled: true,
                flowerDensity: 0.02,
                flowerNoiseScale: 0.26,
                flowerHeightBoost: 0.13,
                flowerTipStart: 0.68,
                flowerBaseScale: 1.0,
                flowerExpand: 2.25,
                flowerColorA: '#ffffff',
                flowerColorB: '#ffcc00',
                flowerColorC: '#ff73be',
                flowerColorD: '#6e8dff',
            },

            windParameters: {
                direction: 0.8,
                strength: 0.7,
                speed: 1.0,
                scale: 0.35,
                globalMultiplier: 1.0,
            },

            windLineParameters: {
                gridSpacing: 3.0,
                height: 1.5,
                heightVariationRange: 2.0,
                timeMultiplier: 0.04,
                alphaMultiplier: 1.0,
                lengthMultiplier: 1.65,
                width: 0.1,
            },

            postProcessingParameters: {
                enabled: true,
                godRaysDensity: 0.96,
                godRaysWeight: 0.3,
                godRaysDecay: 0.95,
                godRaysExposure: 0.35,
                godRaysSamples: 45,
                godRaysClampMax: 1.0,
                bloomIntensity: 0.35,
                bloomThreshold: 0.12,
                bloomSmoothing: 0.9,
                bloomHeight: 300,
            },

            cloudShadowParameters: {
                enabled: true,
                intensity: 0.55,
                speedX: 0.004,
                speedY: 0.002,
                scale: 0.85,
                spotlightIntensity: 1.9,
                spotlightDistance: 420,
                spotlightAngle: 1.05,
                spotlightPenumbra: 0.75,
            },

            softShadowParameters: {
                enabled: true,
                size: 32,
                samples: 16,
                focus: 0.55,
            },

            stoneParameters: {
                enabled: true,
                count: 3,
                minScale: 0.7,
                maxScale: 1.4,
                yOffset: 0.02,
                color: '#adadad',
                noiseScale: 0.15,
                noiseThreshold: 0.55,
                grassClearRadiusMultiplier: 0.8,
                grassFadeWidth: 0.4,
            },

            trailParameters: {
                chunkSize: 256,
                glowSize: 0.18,
                fadeAlpha: 0.1,
                glowAlpha: 0.3,
                showCanvas: false,
            },

            treeParameters: {
                leavesColor: DEFAULT_COLORS.leaves,
                trunkColorA: '#ffffff',
                trunkColorB: '#000000',
                bushWiggleStrength: 0.09,
                bushWiggleSpeed: 0.53,
                bushWorldNoiseScale: 0.17,
                bushUvWiggleScale: 0.56,
                bushNoiseMix: 0.35,
                bushFresnelPower: 1.83,
                bushFresnelStrength: 0.25,
                bushFresnelColor: DEFAULT_COLORS.bushFresnelColor,
                bushAlphaTest: 0.9,
                boneAngleMax: 0.47,
                boneSpeedMul: 1.59,
                boneNoiseStrength: 0.34,
                boneNoiseScale: 0.5,
                boneNoiseSpeed: 0.35,
                boneXFactor: 0.3,
                boneZFactor: 0.3,
                boneParentInfluence: 0.79,
            },

            ballFadeParameters: {
                radius: 2.53,
                width: 0.92,
                noiseScale: 0.3,
                noiseStrength: 0.71,
                maxFade: 0.7,
            },

            generalParameters: {
                trees: true,
                foliage: true,
                wind: true,
            },

            // ── Debug / UI ────────────────────────────────────────────

            perfVisible: false,
            setPerfVisible: (visible: boolean) => set({ perfVisible: visible }),

            physicsDebug: false,
            setPhysicsDebug: (visible: boolean) => set({ physicsDebug: visible }),

            backgroundWireframe: false,
            setBackgroundWireframe: (visible: boolean) => set({ backgroundWireframe: visible }),

            // ── Theme ─────────────────────────────────────────────────

            theme: DEFAULT_THEME as ThemeName,
            setTheme: (theme: ThemeName) => {
                const colors = THEMES[theme] ?? DEFAULT_COLORS
                set((state: any) => ({
                    theme,
                    terrainParameters: { ...state.terrainParameters, color: colors.terrain, backgroundColor: colors.background },
                    grassParameters: { ...state.grassParameters, colorBase: colors.grassBase, colorTop: colors.grassTop },
                    treeParameters: { ...state.treeParameters, leavesColor: colors.leaves, bushFresnelColor: colors.bushFresnelColor },
                }))
            },

            // ── Controls (keyboard input for UI buttons — optional) ──

            controls: {
                forward: false,
                backward: false,
                leftward: false,
                rightward: false,
                jump: false,
            },
            setControl: (name: string, value: boolean) => {
                set((state: any) => ({
                    controls: { ...state.controls, [name]: value },
                }))
            },

            // ── Map Placements (loaded from .mapdef.json) ────────
            mapPlacements: [] as MapdefPlacement[],
            setMapPlacements: (p: MapdefPlacement[]) => set({ mapPlacements: p }),
            mapTerrain: null as LocalMapTerrain | null,
            setMapTerrain: (terrain: LocalMapTerrain | null) => set({ mapTerrain: terrain }),
            mapRoads: [] as RoadSpline[],
            setMapRoads: (roads: RoadSpline[]) => set({ mapRoads: roads }),

            // ── Game State ─────────────────────────────────────────
            connected: false,
            myId: null as string | null,
            myTeam: 0,
            gameMode: 'tdm' as GameMode,
            health: 100,
            alive: true,
            downed: false,
            ammo: 30,
            maxAmmo: 30,
            reloading: false,
            weaponSlot: 0,
            weaponName: 'Rifle',
            suppression: 0,
            flash: 0,
            selectedGrenadeIndex: 0,
            remotePlayers: new Map<string, PlayerState>(),
            kills: [] as KillEntry[],
            ticketsAlpha: 0,
            ticketsBravo: 0,
            conquestScoreAlpha: 0,
            conquestScoreBravo: 0,
            capturePoints: [] as CapturePointState[],
            sessionToken: null as string | null,
            scoreboard: [] as ScoreboardEntry[],
            matchConfig: null as MatchConfig | null,
            lobbyPlayers: [] as LobbyPlayer[],
            lobbyHostId: '' as string,
            lobbyRoomCode: '' as string,
            lobbyPhase: 'idle' as ServerPhase,
            lobbyMapName: '' as string,
            lobbyAvailableMaps: [] as { id: string; name: string }[],
            lobbySeed: 1337,
            placementColliders: [] as PlacementCollider[],
            obstacleDiscs: [] as CollisionDisc[],
            lobbyError: '' as string,
            pendingRespawnPosition: null as Vec3 | null,
            respawnEndsAt: 0,
            authoritativePosition: null as Vec3 | null,
            localAimYaw: 0,
            localScreenPos: { xPct: 50, yPct: 60 },
            consumeRespawnPosition: () => {
                const pos = (useStore.getState() as any).pendingRespawnPosition as Vec3 | null
                if (pos) set({ pendingRespawnPosition: null })
                return pos
            },

            // ── Hit Confirm State ──────────────────────────────────
            /** Pending hit confirmations for sound/visual feedback */
            pendingHitConfirms: [] as { targetId: string; damage: number; sourcePos: Vec3 }[],
            /** Consume pending hit confirms (called by CombatEffects each frame) */
            consumeHitConfirms: () => {
                const hits = (useStore.getState() as any).pendingHitConfirms
                if (hits.length > 0) set({ pendingHitConfirms: [] })
                return hits as { targetId: string; damage: number; sourcePos: Vec3 }[]
            },

            // ── Combat State ─────────────────────────────────────
            serverProjectiles: [] as ProjectileState[],
            serverGrenades: [] as GrenadeState[],
            serverSmokeGrenades: [] as SmokeGrenadeState[],
            serverFlashGrenades: [] as FlashGrenadeState[],
            pendingExplosions: [] as ExplosionEvent[],
            pendingSmokeDeploys: [] as SmokeDeployEvent[],
            pendingFlashDetonations: [] as FlashDetonateEvent[],
            /** Consume pending explosions (called by CombatEffects each frame) */
            consumeExplosions: () => {
                const exps = (useStore.getState() as any).pendingExplosions
                if (exps.length > 0) set({ pendingExplosions: [] })
                return exps as ExplosionEvent[]
            },
            /** Consume pending smoke deploy events (called by smoke renderer each frame) */
            consumeSmokeDeploys: () => {
                const deploys = (useStore.getState() as any).pendingSmokeDeploys
                if (deploys.length > 0) set({ pendingSmokeDeploys: [] })
                return deploys as SmokeDeployEvent[]
            },
            consumeFlashDetonations: () => {
                const flashes = (useStore.getState() as any).pendingFlashDetonations
                if (flashes.length > 0) set({ pendingFlashDetonations: [] })
                return flashes as FlashDetonateEvent[]
            },

            // ── Server Message Handler ─────────────────────────────
            handleServerMessage: (msg: ServerMessage) => {
                switch (msg.type) {
                    case 'welcome':
                        set({
                            myId: msg.id,
                            myTeam: msg.team,
                            gameMode: msg.gameMode,
                            sessionToken: msg.sessionToken ?? null,
                            matchConfig: msg.matchConfig ?? null,
                            placementColliders: msg.placementColliders ?? [],
                            obstacleDiscs: msg.obstacleDiscs ?? [],
                            connected: true,
                            respawnEndsAt: 0,
                            lobbyPhase: 'in_game',
                            lobbyError: '',
                        })
                        break

                    case 'room_created':
                        set({
                            myId: msg.playerId,
                            lobbyHostId: msg.playerId,
                            lobbyRoomCode: msg.roomCode,
                            connected: false,
                            lobbyPhase: 'lobby',
                            placementColliders: [],
                            obstacleDiscs: [],
                            lobbyError: '',
                        })
                        break

                    case 'room_joined':
                        set({
                            myId: msg.playerId,
                            lobbyRoomCode: msg.roomCode,
                            lobbyHostId: msg.hostId,
                            connected: false,
                            lobbyPhase: 'lobby',
                            lobbyError: '',
                        })
                        break

                    case 'lobby_state':
                        set({
                            lobbyPlayers: msg.players,
                            lobbyHostId: msg.hostId,
                            lobbyRoomCode: msg.roomCode,
                            lobbyPhase: msg.phase,
                            gameMode: msg.gameMode,
                            lobbyMapName: msg.mapName,
                            lobbyAvailableMaps: msg.availableMaps,
                            lobbySeed: msg.seed ?? 1337,
                            lobbyError: '',
                        })
                        break

                    case 'room_error':
                        set({ lobbyError: msg.message })
                        break

                    case 'placement_colliders':
                        set({ placementColliders: msg.colliders })
                        break

                    case 'return_to_lobby':
                        set({
                            connected: false,
                            myId: null,
                            remotePlayers: new Map<string, PlayerState>(),
                            lobbyPhase: 'lobby',
                            placementColliders: [],
                            obstacleDiscs: [],
                        })
                        break

                    case 'room_closed':
                        set({
                            connected: false,
                            myId: null,
                            remotePlayers: new Map<string, PlayerState>(),
                            lobbyPlayers: [],
                            lobbyHostId: '',
                            lobbyRoomCode: '',
                            lobbyPhase: 'idle',
                            placementColliders: [],
                            obstacleDiscs: [],
                            lobbyError: 'Room closed by host.',
                        })
                        break

                    case 'state': {
                        const myId = (useStore.getState() as any).myId
                        const remote = new Map<string, PlayerState>()
                        let localUpdate: Partial<Record<string, any>> = {}
                        for (const p of msg.players) {
                            if (p.id === myId) {
                                localUpdate = {
                                    health: p.health,
                                    ammo: p.ammo,
                                    maxAmmo: p.maxAmmo,
                                    reloading: p.reloading,
                                    alive: p.alive,
                                    downed: p.downed,
                                    weaponSlot: p.weaponSlot,
                                    weaponName: p.weaponName,
                                    suppression: p.suppression ?? 0,
                                    flash: p.flash ?? 0,
                                    authoritativePosition: p.position,
                                }
                            } else {
                                remote.set(p.id, p)
                            }
                        }
                        set({ remotePlayers: remote, ...localUpdate })
                        break
                    }

                    case 'hit_confirm':
                        set((state: any) => ({
                            pendingHitConfirms: [
                                ...state.pendingHitConfirms,
                                { targetId: msg.targetId, damage: msg.damage, sourcePos: msg.sourcePos },
                            ],
                        }))
                        break

                    case 'kill':
                        set((state: any) => ({
                            kills: [...state.kills.slice(-4), msg.entry],
                        }))
                        break

                    case 'death':
                        set({
                            alive: false,
                            downed: false,
                            respawnEndsAt: Date.now() + Math.max(0, Number(msg.respawnTime ?? 0)) * 1000,
                        })
                        break

                    case 'downed':
                        set({ downed: true, respawnEndsAt: 0 })
                        break

                    case 'revived':
                        set({ alive: true, downed: false, health: msg.health, respawnEndsAt: 0 })
                        break

                    case 'respawn':
                        set({
                            alive: true,
                            downed: false,
                            health: 100,
                            respawnEndsAt: 0,
                            pendingRespawnPosition: msg.position,
                        })
                        break

                    case 'tickets':
                        set({ ticketsAlpha: msg.alpha, ticketsBravo: msg.bravo })
                        break

                    case 'capture_points':
                        set({ capturePoints: msg.points })
                        break

                    case 'conquest_score':
                        set({ conquestScoreAlpha: msg.alpha, conquestScoreBravo: msg.bravo })
                        break

                    case 'scoreboard':
                        set({ scoreboard: msg.players })
                        break

                    case 'projectiles':
                        set({ serverProjectiles: msg.projectiles })
                        break

                    case 'grenades':
                        set({ serverGrenades: msg.grenades })
                        break

                    case 'smoke_grenades':
                        set({ serverSmokeGrenades: msg.grenades })
                        break

                    case 'flash_grenades':
                        set({ serverFlashGrenades: msg.grenades })
                        break

                    case 'smoke_deploy':
                        set((state: any) => ({
                            pendingSmokeDeploys: [...state.pendingSmokeDeploys, msg.event],
                        }))
                        break

                    case 'flash_detonate':
                        set((state: any) => ({
                            pendingFlashDetonations: [...state.pendingFlashDetonations, msg.event],
                        }))
                        break

                    case 'explosion':
                        set((state: any) => ({
                            pendingExplosions: [...state.pendingExplosions, msg.event],
                        }))
                        break
                }
            },
        }))
    )

const useStore = (import.meta as any)?.hot?.data?.store ?? createStore()
if ((import.meta as any)?.hot) {
    ;(import.meta as any).hot.data.store = useStore
}

// Expose for Playwright/debug access
;(window as any).__ZUSTAND_STORE__ = useStore

export default useStore
