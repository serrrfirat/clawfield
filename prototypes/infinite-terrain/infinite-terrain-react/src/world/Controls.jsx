import { useControls } from 'leva'
import useStore from '../stores/useStore.jsx'

export default function Controls() {
    const terrainParameters = useStore((state) => state.terrainParameters)
    const borderParameters = useStore((state) => state.borderParameters)
    const ditheringParameters = useStore((state) => state.ditheringParameters)
    const grassParameters = useStore((state) => state.grassParameters)
    const windParameters = useStore((state) => state.windParameters)
    const windLineParameters = useStore((state) => state.windLineParameters)
    const stoneParameters = useStore((state) => state.stoneParameters)
    const treeParameters = useStore((state) => state.treeParameters)
    const trailParameters = useStore((state) => state.trailParameters)
    const ballParameters = useStore((state) => state.ballParameters)
    const ballFadeParameters = useStore((state) => state.ballFadeParameters)
    const generalParameters = useStore((state) => state.generalParameters)
    const perfVisible = useStore((state) => state.perfVisible)
    const physicsDebug = useStore((state) => state.physicsDebug)
    const backgroundWireframe = useStore((state) => state.backgroundWireframe)

    const setParam = (section, param) => (value) => {
        useStore.setState((state) => ({
            [section]: {
                ...state[section],
                [param]: value,
            },
        }))
    }

    /**
     * General parameters
     */
    useControls('General', {
        trees: {
            value: generalParameters.trees,
            onChange: setParam('generalParameters', 'trees'),
        },
        wind: {
            value: generalParameters.wind,
            onChange: setParam('generalParameters', 'wind'),
        },
        flowers: {
            value: grassParameters.flowersEnabled,
            onChange: setParam('grassParameters', 'flowersEnabled'),
        },
        stones: {
            value: stoneParameters.enabled,
            onChange: setParam('stoneParameters', 'enabled'),
        },
        canvas: {
            value: trailParameters.showCanvas,
            onChange: setParam('trailParameters', 'showCanvas'),
        },
        perfMonitor: {
            value: perfVisible,
            onChange: (value) => useStore.getState().setPerfVisible(value),
        },
        physicsDebug: {
            value: physicsDebug,
            onChange: (value) => useStore.getState().setPhysicsDebug(value),
        },
        bgWireframe: {
            value: backgroundWireframe,
            onChange: (value) => useStore.getState().setBackgroundWireframe(value),
        },
    })

    /**
     * Terrain Chunk parameters
     */
    useControls('Terrain', {
        color: {
            value: terrainParameters.color,
            onChange: setParam('terrainParameters', 'color'),
        },
        backgroundColor: {
            value: terrainParameters.backgroundColor,
            onChange: setParam('terrainParameters', 'backgroundColor'),
        },
        segments: {
            value: terrainParameters.segments,
            min: 1,
            max: 100,
            step: 1,
            onChange: setParam('terrainParameters', 'segments'),
        },
        scale: {
            value: terrainParameters.scale,
            min: 0,
            max: 1,
            step: 0.01,
            onChange: setParam('terrainParameters', 'scale'),
        },
        amplitude: {
            value: terrainParameters.amplitude,
            min: 0,
            max: 10,
            step: 0.1,
            onChange: setParam('terrainParameters', 'amplitude'),
        },
        chunkSize: {
            value: terrainParameters.chunkSize,
            min: 2,
            max: 50,
            step: 1,
            onChange: setParam('terrainParameters', 'chunkSize'),
        },
    })

    /**
     * Border parameters
     */
    useControls('Border', {
        nStrength: {
            value: borderParameters.noiseStrength,
            min: 0,
            max: 1,
            step: 0.01,
            onChange: setParam('borderParameters', 'noiseStrength'),
        },
        nScale: {
            value: borderParameters.noiseScale,
            min: 0.01,
            max: 1.0,
            step: 0.01,
            onChange: setParam('borderParameters', 'noiseScale'),
        },
        radius: {
            value: borderParameters.circleRadiusFactor,
            min: 0.1,
            max: 1.0,
            step: 0.01,
            onChange: setParam('borderParameters', 'circleRadiusFactor'),
        },
        grassFade: {
            value: borderParameters.grassFadeOffset,
            min: 0,
            max: 8.0,
            step: 0.01,
            onChange: setParam('borderParameters', 'grassFadeOffset'),
        },
        groundOffset: {
            value: borderParameters.groundOffset,
            min: -3.0,
            max: 3.0,
            step: 0.001,
            onChange: setParam('borderParameters', 'groundOffset'),
        },
        groundFade: {
            value: borderParameters.groundFadeOffset,
            min: 0,
            max: 3.0,
            step: 0.01,
            onChange: setParam('borderParameters', 'groundFadeOffset'),
        },
        treeBorderMul: {
            value: borderParameters.borderTreesMultiplier,
            min: 0.1,
            max: 2.0,
            step: 0.01,
            onChange: setParam('borderParameters', 'borderTreesMultiplier'),
        },
    })

    /**
     * Dithering parameters
     */
    useControls('Dithering Params', {
        ditherMode: {
            value: ditheringParameters.ditherMode,
            options: ['Diamond', 'Bayer'],
            onChange: setParam('ditheringParameters', 'ditherMode'),
        },
        pixelSize: {
            value: ditheringParameters.pixelSize,
            min: 1,
            max: 10,
            step: 1,
            onChange: setParam('ditheringParameters', 'pixelSize'),
        },
    })

    /**
     * Grass parameters
     */
    useControls('Grass', {
        colorBase: {
            value: grassParameters.colorBase,
            onChange: setParam('grassParameters', 'colorBase'),
        },
        colorTop: {
            value: grassParameters.colorTop,
            onChange: setParam('grassParameters', 'colorTop'),
        },
        count: {
            value: grassParameters.count,
            min: 0,
            max: 5000,
            step: 10,
            onChange: setParam('grassParameters', 'count'),
        },
        segments: {
            value: grassParameters.segmentsCount,
            min: 1,
            max: 10,
            step: 1,
            onChange: setParam('grassParameters', 'segmentsCount'),
        },
        width: {
            value: grassParameters.width,
            min: 0,
            max: 0.4,
            step: 0.001,
            onChange: setParam('grassParameters', 'width'),
        },
        height: {
            value: grassParameters.height,
            min: 0,
            max: 3,
            step: 0.01,
            onChange: setParam('grassParameters', 'height'),
        },
        lean: {
            value: grassParameters.leanFactor,
            min: 0,
            max: 1,
            step: 0.01,
            onChange: setParam('grassParameters', 'leanFactor'),
        },
        sobelMode: {
            options: ['8 tap Sobel', '4 tap central difference', '2 tap approximation'],
            value: grassParameters.sobelMode === 2.0 ? '8 tap Sobel' : grassParameters.sobelMode === 1.0 ? '4 tap central difference' : '2 tap approximation',
            onChange: (value) => setParam('grassParameters', 'sobelMode')(value === '8 tap Sobel' ? 2.0 : value === '4 tap central difference' ? 1.0 : 0.0),
        },
    })

    /**
     * Wind parameters
     */
    useControls('Wind', {
        direction: {
            value: windParameters.direction,
            min: 0,
            max: Math.PI * 2,
            step: 0.01,
            onChange: setParam('windParameters', 'direction'),
        },
        strength: {
            value: windParameters.strength,
            min: 0,
            max: 1.5,
            step: 0.01,
            onChange: setParam('windParameters', 'strength'),
        },
        speed: {
            value: windParameters.speed,
            min: 0,
            max: 2.5,
            step: 0.01,
            onChange: setParam('windParameters', 'speed'),
        },
        scale: {
            value: windParameters.scale,
            min: 0,
            max: 1,
            step: 0.01,
            onChange: setParam('windParameters', 'scale'),
        },
    })

    /**
     * Wind line parameters
     */
    useControls('Wind Lines', {
        gridSpacing: {
            value: windLineParameters.gridSpacing,
            min: 0.5,
            max: 10,
            step: 0.1,
            onChange: setParam('windLineParameters', 'gridSpacing'),
        },
        height: {
            value: windLineParameters.height,
            min: -5,
            max: 10,
            step: 0.1,
            onChange: setParam('windLineParameters', 'height'),
        },
        heightVariation: {
            value: windLineParameters.heightVariationRange,
            min: 0,
            max: 5,
            step: 0.1,
            onChange: setParam('windLineParameters', 'heightVariationRange'),
        },
        timeMultiplier: {
            value: windLineParameters.timeMultiplier,
            min: 0,
            max: 0.5,
            step: 0.01,
            onChange: setParam('windLineParameters', 'timeMultiplier'),
        },
        alphaMultiplier: {
            value: windLineParameters.alphaMultiplier,
            min: 0,
            max: 1,
            step: 0.01,
            onChange: setParam('windLineParameters', 'alphaMultiplier'),
        },
        length: {
            value: windLineParameters.lengthMultiplier,
            min: 0.1,
            max: 3,
            step: 0.01,
            onChange: setParam('windLineParameters', 'lengthMultiplier'),
        },
        width: {
            value: windLineParameters.width,
            min: 0.02,
            max: 1.0,
            step: 0.01,
            onChange: setParam('windLineParameters', 'width'),
        },
    })

    /**
     * Flowers (procedural on grass shader)
     */
    useControls('Flowers', {
        density: {
            value: grassParameters.flowerDensity,
            min: 0,
            max: 0.25,
            step: 0.001,
            onChange: setParam('grassParameters', 'flowerDensity'),
        },
        noiseScale: {
            value: grassParameters.flowerNoiseScale,
            min: 0.0,
            max: 2.0,
            step: 0.01,
            onChange: setParam('grassParameters', 'flowerNoiseScale'),
        },
        heightBoost: {
            value: grassParameters.flowerHeightBoost,
            min: 0,
            max: 0.75,
            step: 0.01,
            onChange: setParam('grassParameters', 'flowerHeightBoost'),
        },
        baseScale: {
            value: grassParameters.flowerBaseScale,
            min: 0.1,
            max: 1.0,
            step: 0.01,
            onChange: setParam('grassParameters', 'flowerBaseScale'),
        },
        tipStart: {
            value: grassParameters.flowerTipStart,
            min: 0.0,
            max: 1.0,
            step: 0.01,
            onChange: setParam('grassParameters', 'flowerTipStart'),
        },
        tipWiden: {
            value: grassParameters.flowerExpand,
            min: 0.0,
            max: 5.0,
            step: 0.01,
            onChange: setParam('grassParameters', 'flowerExpand'),
        },
        colorA: {
            value: grassParameters.flowerColorA,
            onChange: setParam('grassParameters', 'flowerColorA'),
        },
        colorB: {
            value: grassParameters.flowerColorB,
            onChange: setParam('grassParameters', 'flowerColorB'),
        },
        colorC: {
            value: grassParameters.flowerColorC,
            onChange: setParam('grassParameters', 'flowerColorC'),
        },
        colorD: {
            value: grassParameters.flowerColorD,
            onChange: setParam('grassParameters', 'flowerColorD'),
        },
    })

    /**
     * Stones (instanced)
     */
    useControls('Stones', {
        count: {
            value: stoneParameters.count,
            min: 0,
            max: 10,
            step: 1,
            onChange: setParam('stoneParameters', 'count'),
        },
        minScale: {
            value: stoneParameters.minScale,
            min: 0.05,
            max: 2.0,
            step: 0.01,
            onChange: setParam('stoneParameters', 'minScale'),
        },
        maxScale: {
            value: stoneParameters.maxScale,
            min: 0.05,
            max: 3.0,
            step: 0.01,
            onChange: setParam('stoneParameters', 'maxScale'),
        },
        yOffset: {
            value: stoneParameters.yOffset,
            min: -1.0,
            max: 1.0,
            step: 0.001,
            onChange: setParam('stoneParameters', 'yOffset'),
        },
        color: {
            value: stoneParameters.color,
            onChange: setParam('stoneParameters', 'color'),
        },
        noiseScale: {
            value: stoneParameters.noiseScale,
            min: 0.0,
            max: 1.0,
            step: 0.01,
            onChange: setParam('stoneParameters', 'noiseScale'),
        },
        noiseThreshold: {
            value: stoneParameters.noiseThreshold,
            min: 0.0,
            max: 1.0,
            step: 0.01,
            onChange: setParam('stoneParameters', 'noiseThreshold'),
        },
        grassClearRadiusMultiplier: {
            value: stoneParameters.grassClearRadiusMultiplier,
            min: 0.0,
            max: 3.0,
            step: 0.01,
            onChange: setParam('stoneParameters', 'grassClearRadiusMultiplier'),
        },
        grassFadeWidth: {
            value: stoneParameters.grassFadeWidth,
            min: 0.0,
            max: 3.0,
            step: 0.01,
            onChange: setParam('stoneParameters', 'grassFadeWidth'),
        },
    })

    /**
     * Tree parameters
     */
    useControls('Tree/Leaves', {
        leavesColor: {
            value: treeParameters.leavesColor,
            onChange: setParam('treeParameters', 'leavesColor'),
        },
        alphaTest: {
            value: treeParameters.bushAlphaTest,
            min: 0.0,
            max: 1.0,
            step: 0.01,
            onChange: setParam('treeParameters', 'bushAlphaTest'),
        },

        wiggleStrength: {
            value: treeParameters.bushWiggleStrength,
            min: 0.0,
            max: 0.5,
            step: 0.001,
            onChange: setParam('treeParameters', 'bushWiggleStrength'),
        },
        wiggleSpeed: {
            value: treeParameters.bushWiggleSpeed,
            min: 0.0,
            max: 2.0,
            step: 0.01,
            onChange: setParam('treeParameters', 'bushWiggleSpeed'),
        },
        worldNoiseScale: {
            value: treeParameters.bushWorldNoiseScale,
            min: 0.0,
            max: 5.0,
            step: 0.01,
            onChange: setParam('treeParameters', 'bushWorldNoiseScale'),
        },
        uvNoiseScale: {
            value: treeParameters.bushUvWiggleScale,
            min: 0.0,
            max: 10.0,
            step: 0.01,
            onChange: setParam('treeParameters', 'bushUvWiggleScale'),
        },
        noiseMix: {
            value: treeParameters.bushNoiseMix,
            min: 0.0,
            max: 1.0,
            step: 0.01,
            onChange: setParam('treeParameters', 'bushNoiseMix'),
        },

        fresnelPower: {
            value: treeParameters.bushFresnelPower,
            min: 0.1,
            max: 8.0,
            step: 0.01,
            onChange: setParam('treeParameters', 'bushFresnelPower'),
        },
        fresnelStrength: {
            value: treeParameters.bushFresnelStrength,
            min: 0.0,
            max: 1.0,
            step: 0.001,
            onChange: setParam('treeParameters', 'bushFresnelStrength'),
        },
        fresnelColor: {
            value: treeParameters.bushFresnelColor,
            onChange: setParam('treeParameters', 'bushFresnelColor'),
        },
    })

    useControls('Tree/Trunk', {
        colorA: {
            value: treeParameters.trunkColorA,
            onChange: setParam('treeParameters', 'trunkColorA'),
        },
        colorB: {
            value: treeParameters.trunkColorB,
            onChange: setParam('treeParameters', 'trunkColorB'),
        },

        angleMax: {
            value: treeParameters.boneAngleMax,
            min: 0.0,
            max: 0.6,
            step: 0.001,
            onChange: setParam('treeParameters', 'boneAngleMax'),
        },
        speedMul: {
            value: treeParameters.boneSpeedMul,
            min: 0.0,
            max: 3.0,
            step: 0.01,
            onChange: setParam('treeParameters', 'boneSpeedMul'),
        },
        noiseStrength: {
            value: treeParameters.boneNoiseStrength,
            min: 0.0,
            max: 2.0,
            step: 0.01,
            onChange: setParam('treeParameters', 'boneNoiseStrength'),
        },
        noiseScale: {
            value: treeParameters.boneNoiseScale,
            min: 0.0,
            max: 3.0,
            step: 0.01,
            onChange: setParam('treeParameters', 'boneNoiseScale'),
        },
        noiseSpeed: {
            value: treeParameters.boneNoiseSpeed,
            min: 0.0,
            max: 2.0,
            step: 0.01,
            onChange: setParam('treeParameters', 'boneNoiseSpeed'),
        },
        xFactor: {
            value: treeParameters.boneXFactor,
            min: 0.0,
            max: 2.0,
            step: 0.01,
            onChange: setParam('treeParameters', 'boneXFactor'),
        },
        zFactor: {
            value: treeParameters.boneZFactor,
            min: 0.0,
            max: 2.0,
            step: 0.01,
            onChange: setParam('treeParameters', 'boneZFactor'),
        },
        parentInfluence: {
            value: treeParameters.boneParentInfluence,
            min: 0.0,
            max: 1.25,
            step: 0.01,
            onChange: setParam('treeParameters', 'boneParentInfluence'),
        },
    })

    /**
     * Trail parameters
     */
    useControls('Trail', {
        chunkSize: {
            options: [16, 32, 64, 128, 256],
            value: trailParameters.chunkSize,
            onChange: setParam('trailParameters', 'chunkSize'),
        },
        glowSize: {
            value: trailParameters.glowSize,
            min: 0,
            max: 0.2,
            step: 0.01,
            onChange: setParam('trailParameters', 'glowSize'),
        },
        fadeAlpha: {
            value: trailParameters.fadeAlpha,
            min: 0,
            max: 0.5,
            step: 0.01,
            onChange: setParam('trailParameters', 'fadeAlpha'),
        },
        glowAlpha: {
            value: trailParameters.glowAlpha,
            min: 0,
            max: 1,
            step: 0.01,
            onChange: setParam('trailParameters', 'glowAlpha'),
        },
    })

    /**
     * Ball parameters
     */
    useControls('Ball', {
        color: {
            value: ballParameters.color,
            onChange: setParam('ballParameters', 'color'),
        },
    })

    /**
     * Ball fade parameters
     */
    useControls('BallFade', {
        radius: {
            value: ballFadeParameters.radius,
            min: 0.1,
            max: 4.0,
            step: 0.01,
            onChange: setParam('ballFadeParameters', 'radius'),
        },
        width: {
            value: ballFadeParameters.width,
            min: 0.0,
            max: 2.0,
            step: 0.01,
            onChange: setParam('ballFadeParameters', 'width'),
        },
        noiseScale: {
            value: ballFadeParameters.noiseScale,
            min: 0.0,
            max: 1.0,
            step: 0.001,
            onChange: setParam('ballFadeParameters', 'noiseScale'),
        },
        noiseStrength: {
            value: ballFadeParameters.noiseStrength,
            min: 0.0,
            max: 2.0,
            step: 0.01,
            onChange: setParam('ballFadeParameters', 'noiseStrength'),
        },
        maxFade: {
            value: ballFadeParameters.maxFade,
            min: 0.0,
            max: 1.0,
            step: 0.01,
            onChange: setParam('ballFadeParameters', 'maxFade'),
        },
    })

    return null
}
