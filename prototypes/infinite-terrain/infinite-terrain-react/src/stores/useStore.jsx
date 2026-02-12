import { create } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'
import * as THREE from 'three'

const THEMES = {
    dark: {
        terrain: '#3f5553',
        background: '#203a3b',
        grassBase: '#396c18',
        grassTop: '#77aa1a',
        ball: '#582ec7',
        leaves: '#cb3e0b',
        bushFresnelColor: '#ffcc00',
    },
    light: {
        terrain: '#908343',
        background: '#9a9065',
        grassBase: '#669019',
        grassTop: '#acc125',
        ball: '#c7442d',
        leaves: '#204a11',
        bushFresnelColor: '#84cd27',
    },
}

const DEFAULT_THEME = 'light'
const DEFAULT_COLORS = THEMES[DEFAULT_THEME]

const createStore = () =>
    create(
        subscribeWithSelector((set) => ({
            trailTexture: null,
            setTrailTexture: (texture) => {
                set({ trailTexture: texture })
            },

            ballPosition: new THREE.Vector3(0, 0, 0),
            setBallPosition: (position) => {
                set({ ballPosition: position })
            },

            smoothedCircleCenter: new THREE.Vector3(0, 0, 0),
            setSmoothedCircleCenter: (position) => {
                set({ smoothedCircleCenter: position })
            },

            landBallDistance: 1.0,
            setLandBallDistance: (distance) => {
                set({ landBallDistance: distance })
            },

            /**
             * Terrain parameters
             */
            terrainParameters: {
                color: DEFAULT_COLORS.terrain,
                backgroundColor: DEFAULT_COLORS.background,
                chunkSize: 10,
                segments: 16,
                scale: 0.05,
                amplitude: 2,
            },

            /**Border parameters */
            borderParameters: {
                noiseStrength: 0.45,
                noiseScale: 0.35,
                circleRadiusFactor: 0.9,
                grassFadeOffset: 3.5,
                groundOffset: -0.75,
                groundFadeOffset: 1.0,
                borderTreesMultiplier: 0.9,
            },
            setBorderParameters: (parameters) => {
                set({ borderParameters: parameters })
            },

            /**
             * Dithering parameters
             */
            ditheringParameters: {
                ditherMode: 'Diamond', // 'Diamond' | 'Bayer'
                pixelSize: 1,
            },

            /**
             * Grass parameters
             */
            grassParameters: {
                colorBase: DEFAULT_COLORS.grassBase,
                colorTop: DEFAULT_COLORS.grassTop,
                count: 2500,
                segmentsCount: 4,
                width: 0.15,
                height: 1.15,
                leanFactor: 0.2,
                sobelMode: 2.0,

                // Procedural flowers (small blossom at the tip of some blades)
                flowersEnabled: true,
                flowerDensity: 0.02, // ~3.5% of blades become flowers
                flowerNoiseScale: 0.26, // noise UV scale used to cluster flower density
                flowerHeightBoost: 0.13, // flower blades are slightly taller than grass
                flowerTipStart: 0.68, // where on the blade (0..1) blossoms start
                flowerBaseScale: 1.0, // make flower blades thinner at the base
                flowerExpand: 2.25, // widens the blade near the tip for visible blossoms
                flowerColorA: '#ffffff', // white
                flowerColorB: '#ffcc00', // yellow
                flowerColorC: '#ff73be', // pink
                flowerColorD: '#6e8dff', // blue-ish
            },

            /**
             * Wind parameters (global)
             */
            windParameters: {
                direction: 0.8, // radians, used for grass sway direction in XZ
                strength: 0.7,
                speed: 1.0,
                scale: 0.35,
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

            /**
             * Stone parameters
             */
            stoneParameters: {
                enabled: true,
                count: 3, // per chunk
                minScale: 0.7,
                maxScale: 1.4,
                yOffset: 0.02,
                color: '#adadad', //#707e89
                noiseScale: 0.15,
                noiseThreshold: 0.55,

                // Grass suppression around stones (computed from actual stone instances)
                grassClearRadiusMultiplier: 0.8, // >1 means grass clears a bit beyond the stone mesh
                grassFadeWidth: 0.4, // extra fade distance beyond the clear radius
            },

            /**
             * Trail parameters
             */
            trailParameters: {
                chunkSize: 256,
                glowSize: 0.18,
                fadeAlpha: 0.1,
                glowAlpha: 0.3,
                showCanvas: false,
            },

            /**
             * Tree parameters
             */
            treeParameters: {
                leavesColor: DEFAULT_COLORS.leaves, //#701a13 //#c14b30 //#141f3b //#2956c7 //#de2d0d //#175803 //a04009 //#33156c //#204a11 //#0a6ecc
                trunkColorA: '#ffffff',
                trunkColorB: '#000000',

                // Bush/leaves material controls (Leva)
                bushWiggleStrength: 0.09,
                bushWiggleSpeed: 0.53,
                bushWorldNoiseScale: 0.17,
                bushUvWiggleScale: 0.56,
                bushNoiseMix: 0.35, // 0 = only world, 1 = only UV

                bushFresnelPower: 1.83, //2.64
                bushFresnelStrength: 0.25, //0.10
                bushFresnelColor: DEFAULT_COLORS.bushFresnelColor, //#005cff //#00e2ff //#894185 //#ce1ac5 //#6c6bd8 //#a6ff00 //ffc900 //#8987ff //#84cd27 //#cc00ff

                bushAlphaTest: 0.9,

                // Tree bone wind controls (Leva)
                boneAngleMax: 0.47, // radians
                boneSpeedMul: 1.59,
                boneNoiseStrength: 0.34,
                boneNoiseScale: 0.5,
                boneNoiseSpeed: 0.35,
                boneXFactor: 0.3,
                boneZFactor: 0.3,
                boneParentInfluence: 0.79, // 0 = each bone independent, 1 = fully follows parent sway
            },

            /**
             * Ball parameters
             */
            ballParameters: {
                color: DEFAULT_COLORS.ball, // Changed from red to purple/blue-ish by default
            },

            /**
             * Ball fade (see-through) parameters
             */
            ballFadeParameters: {
                radius: 2.53,
                width: 0.92,
                noiseScale: 0.3,
                noiseStrength: 0.71,
                maxFade: 0.7,
            },

            /**
             * General toggles
             */
            generalParameters: {
                trees: true,
                wind: true,
            },

            /**
             * Performance & Debug parameters
             */
            perfVisible: false,
            setPerfVisible: (visible) => {
                set({ perfVisible: visible })
            },

            physicsDebug: false,
            setPhysicsDebug: (visible) => {
                set({ physicsDebug: visible })
            },

            backgroundWireframe: false,
            setBackgroundWireframe: (visible) => {
                set({ backgroundWireframe: visible })
            },

            /**
             * Theme
             */
            theme: DEFAULT_THEME, // Set default theme
            setTheme: (theme) => {
                const colors = THEMES[theme] ?? DEFAULT_COLORS

                set((state) => ({
                    theme,
                    terrainParameters: { ...state.terrainParameters, color: colors.terrain, backgroundColor: colors.background },
                    grassParameters: { ...state.grassParameters, colorBase: colors.grassBase, colorTop: colors.grassTop },
                    ballParameters: { ...state.ballParameters, color: colors.ball },
                    treeParameters: { ...state.treeParameters, leavesColor: colors.leaves, bushFresnelColor: colors.bushFresnelColor },
                }))
            },

            /**
             * Controls
             */
            controls: {
                forward: false,
                backward: false,
                leftward: false,
                rightward: false,
                jump: false,
            },
            setControl: (name, value) => {
                set((state) => ({
                    controls: {
                        ...state.controls,
                        [name]: value,
                    },
                }))
            },
        }))
    )

const useStore = import.meta?.hot?.data?.store ?? createStore()
if (import.meta?.hot) {
    import.meta.hot.data.store = useStore
}

export default useStore
