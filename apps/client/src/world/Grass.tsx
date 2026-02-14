import { useEffect, useMemo } from 'react'
import * as THREE from 'three'

import useStore from '../stores/useStore'
import { mulberry32 } from './utils/randomUtils'
import { smoothstep } from './utils/stoneUtils'
import assetCatalog from '../editor/asset-catalog.json'
import type { AssetEntry, EditorPlacement } from '../editor/editor-types'
import { getPlacementGrassSuppressRadius, getPlacementSuppressGrass } from '../editor/collision-defaults'

function distanceToSegment2D(px, pz, ax, az, bx, bz) {
    const abx = bx - ax
    const abz = bz - az
    const apx = px - ax
    const apz = pz - az
    const abLenSq = abx * abx + abz * abz
    if (abLenSq < 1e-8) {
        const dx = px - ax
        const dz = pz - az
        return Math.sqrt(dx * dx + dz * dz)
    }
    let t = (apx * abx + apz * abz) / abLenSq
    t = Math.max(0, Math.min(1, t))
    const cx = ax + abx * t
    const cz = az + abz * t
    const dx = px - cx
    const dz = pz - cz
    return Math.sqrt(dx * dx + dz * dz)
}

export default function Grass({ size, chunkX, chunkZ, chunkIndexX, chunkIndexZ, noise2D, scale, amplitude, stones, roads = [], placements = [], grassMaterial }) {
    const grassParameters = useStore((s) => s.grassParameters)
    const stoneParameters = useStore((s) => s.stoneParameters)

    // Geometry
    const grassGeometry = useMemo(() => {
        const vertexNumber = (grassParameters.segmentsCount + 1) * 2
        const indices = []

        for (let i = 0; i < grassParameters.segmentsCount; ++i) {
            const vi = i * 2
            indices[i * 12] = vi
            indices[i * 12 + 1] = vi + 1
            indices[i * 12 + 2] = vi + 2

            indices[i * 12 + 3] = vi + 2
            indices[i * 12 + 4] = vi + 1
            indices[i * 12 + 5] = vi + 3

            const fi = vertexNumber + vi
            indices[i * 12 + 6] = fi + 2
            indices[i * 12 + 7] = fi + 1
            indices[i * 12 + 8] = fi

            indices[i * 12 + 9] = fi + 3
            indices[i * 12 + 10] = fi + 1
            indices[i * 12 + 11] = fi + 2
        }

        const grassGeometry = new THREE.InstancedBufferGeometry()
        grassGeometry.instanceCount = grassParameters.count
        grassGeometry.setIndex(indices)
        grassGeometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 1 + size / 2)

        // distribute blades inside this chunk; Y from terrain noise
        const positions = new Float32Array(grassParameters.count * 3)
        const stoneInfluence = new Float32Array(grassParameters.count)
        const rng = mulberry32((chunkIndexX * 73856093) ^ (chunkIndexZ * 19349663) ^ 0xdecafbad)

        // Precompute cheap "footprints" for grass suppression.
        // This used to do per-stone inverse-rotation math via Vector3.applyAxisAngle(), which is expensive and allocates.
        // For grass suppression we can approximate using an axis-aligned ellipse in XZ (scale-aware, rotation-agnostic).
        const footprints =
            stoneParameters?.enabled && Array.isArray(stones) && stones.length > 0
                ? (() => {
                      const clearMul = stoneParameters.grassClearRadiusMultiplier ?? 1.0
                      const fadeW = Math.max(0.0, stoneParameters.grassFadeWidth ?? 0.0)

                      return stones.map((s) => {
                          const sx = Math.max(1e-6, (s.scaleX ?? 1.0) * clearMul)
                          const sz = Math.max(1e-6, (s.scaleZ ?? 1.0) * clearMul)
                          const avgScale = (sx + sz) * 0.5
                          const fadeN = fadeW / Math.max(1e-6, avgScale)
                          const end = 1.0 + fadeN
                          const endSq = end * end

                          return {
                              x: s.x ?? 0,
                              z: s.z ?? 0,
                              invSx2: 1.0 / (sx * sx),
                              invSz2: 1.0 / (sz * sz),
                              end,
                              endSq,
                          }
                      })
                  })()
                : null

        const roadFootprints = Array.isArray(roads) && roads.length > 0
            ? (() => {
                const fadeW = Math.max(0.2, stoneParameters?.grassFadeWidth ?? 0.8)
                const out = []
                for (let r = 0; r < roads.length; r++) {
                    const road = roads[r]
                    const pts = road?.points
                    if (!Array.isArray(pts) || pts.length < 2) continue
                    const half = Math.max(0.25, Number(road.width ?? 0) * 0.5)
                    for (let i = 0; i < pts.length - 1; i++) {
                        const a = pts[i]
                        const b = pts[i + 1]
                        if (!a || !b) continue
                        const ax = Number(a[0])
                        const az = Number(a[1])
                        const bx = Number(b[0])
                        const bz = Number(b[1])
                        if (!Number.isFinite(ax) || !Number.isFinite(az) || !Number.isFinite(bx) || !Number.isFinite(bz)) continue
                        out.push({ ax, az, bx, bz, radius: half, fade: fadeW })
                    }
                }
                return out.length > 0 ? out : null
            })()
            : null

        const placementFootprints = Array.isArray(placements) && placements.length > 0
            ? (() => {
                const fadeW = Math.max(0.2, stoneParameters?.grassFadeWidth ?? 0.8)
                const out = []
                for (let i = 0; i < placements.length; i++) {
                    const p = placements[i]
                    const editorP = p as EditorPlacement
                    const entry = (assetCatalog as AssetEntry[]).find((a) => a.id === p.componentId)
                    if (!getPlacementSuppressGrass(editorP, entry)) continue

                    const radius = getPlacementGrassSuppressRadius(editorP, entry)

                    const x = Number(p.position?.[0] ?? 0)
                    const z = Number(p.position?.[2] ?? 0)
                    if (!Number.isFinite(x) || !Number.isFinite(z)) continue

                    out.push({ x, z, radius, fade: fadeW })
                }
                return out.length > 0 ? out : null
            })()
            : null

        for (let i = 0; i < grassParameters.count; i++) {
            const x = (rng() - 0.5) * size
            const z = (rng() - 0.5) * size

            const worldX = x + chunkX
            const worldZ = z + chunkZ

            const y = noise2D ? noise2D(worldX * scale, worldZ * scale) * amplitude : 0

            positions[i * 3] = x
            positions[i * 3 + 1] = y
            positions[i * 3 + 2] = z

            // Fade grass height near actual stones
            if (!footprints) {
                stoneInfluence[i] = 0
                continue
            }

            let best = 0
            for (let s = 0; s < footprints.length; s++) {
                const fp = footprints[s]
                const dx = x - fp.x
                const dz = z - fp.z

                const distSqN = dx * dx * fp.invSx2 + dz * dz * fp.invSz2
                if (distSqN >= fp.endSq) continue

                const distN = Math.sqrt(distSqN)
                const influence = 1.0 - smoothstep(1.0, fp.end, distN)
                if (influence > best) best = influence
                if (best >= 0.999) break
            }

            if (roadFootprints) {
                const wx = x + chunkX
                const wz = z + chunkZ
                for (let r = 0; r < roadFootprints.length; r++) {
                    const rf = roadFootprints[r]
                    const d = distanceToSegment2D(wx, wz, rf.ax, rf.az, rf.bx, rf.bz)
                    if (d >= rf.radius + rf.fade) continue
                    const influence = 1.0 - smoothstep(rf.radius, rf.radius + rf.fade, d)
                    if (influence > best) best = influence
                    if (best >= 0.999) break
                }
            }

            if (placementFootprints) {
                const wx = x + chunkX
                const wz = z + chunkZ
                for (let p = 0; p < placementFootprints.length; p++) {
                    const fp = placementFootprints[p]
                    const dx = wx - fp.x
                    const dz = wz - fp.z
                    const d = Math.sqrt(dx * dx + dz * dz)
                    if (d >= fp.radius + fp.fade) continue
                    const influence = 1.0 - smoothstep(fp.radius, fp.radius + fp.fade, d)
                    if (influence > best) best = influence
                    if (best >= 0.999) break
                }
            }

            stoneInfluence[i] = best
        }

        grassGeometry.setAttribute('aInstancePosition', new THREE.InstancedBufferAttribute(positions, 3))
        grassGeometry.setAttribute('aStoneInfluence', new THREE.InstancedBufferAttribute(stoneInfluence, 1))

        return grassGeometry
    }, [
        grassParameters.segmentsCount,
        grassParameters.count,
        size,
        chunkX,
        chunkZ,
        chunkIndexX,
        chunkIndexZ,
        noise2D,
        scale,
        amplitude,
        stones,
        stoneParameters?.enabled,
        stoneParameters?.grassClearRadiusMultiplier,
        stoneParameters?.grassFadeWidth,
        roads,
        placements,
    ])

    useEffect(() => {
        return () => {
            grassGeometry.dispose()
        }
    }, [grassGeometry])

    return <mesh geometry={grassGeometry} material={grassMaterial} />
}
