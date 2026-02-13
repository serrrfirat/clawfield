import { Physics } from '@react-three/rapier'
import { Perf } from 'r3f-perf'
import React, { useRef } from 'react'
import * as THREE from 'three'

import Lights from './Lights'
import Terrain from './Terrain'
import Controls from './Controls'
import BackgroundSphere from './BackgroundSphere'
import RemotePlayers from '../player/RemotePlayers'
import MapPlacements from './MapPlacements'
import PlayerController from '../player/PlayerController'
import CombatEffects from '../combat/CombatEffects'
import useStore from '../stores/useStore'
import { TerrainUniformsContext, type TerrainUniformsRef } from './TerrainUniformsContext'

export default function Experience() {
    const perfVisible = useStore((state) => state.perfVisible)
    const physicsDebug = useStore((state) => state.physicsDebug)
    const backgroundColor = useStore((state) => state.terrainParameters.backgroundColor)
    
    const terrainUniformsRef = useRef<{ treeMaterialUniforms?: Record<string, { value: any }>; noiseTexture?: THREE.Texture }>({})

    return (
        <TerrainUniformsContext.Provider value={terrainUniformsRef as TerrainUniformsRef}>
            <color args={[backgroundColor]} attach="background" />

            {perfVisible && <Perf position="top-left" />}

            <Physics debug={physicsDebug}>
                <Lights />
                <Terrain uniformsRef={terrainUniformsRef} />
                <MapPlacements />
                <RemotePlayers />
                <PlayerController />
            </Physics>

            <CombatEffects />
            <Controls />
            <BackgroundSphere color={backgroundColor} />
        </TerrainUniformsContext.Provider>
    )
}
