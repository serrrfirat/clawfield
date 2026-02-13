import * as THREE from 'three'
import { createContext, useContext, MutableRefObject } from 'react'

interface DitherUniformsData {
    treeMaterialUniforms?: Record<string, { value: any }>
    noiseTexture?: THREE.Texture
}

export type TerrainUniformsRef = MutableRefObject<DitherUniformsData>

export const TerrainUniformsContext = createContext<TerrainUniformsRef | null>(null)

export const useTerrainUniforms = () => useContext(TerrainUniformsContext)
