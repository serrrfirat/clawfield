import type { CollisionDisc } from '@clawfield/shared'

export const VISIBILITY_FOV_DEGREES = 185
export const VISIBILITY_FOV_COS = Math.cos((VISIBILITY_FOV_DEGREES * Math.PI) / 360)
export const LOS_MEMORY_MS = 1200

export interface XZPos {
    x: number
    z: number
}

export function segmentBlockedByDisc(ox: number, oz: number, tx: number, tz: number, disc: CollisionDisc): boolean {
    const dx = tx - ox
    const dz = tz - oz
    const segLenSq = dx * dx + dz * dz

    if (segLenSq < 1e-6) return false

    const t = ((disc.x - ox) * dx + (disc.z - oz) * dz) / segLenSq
    if (t <= 0 || t >= 1) return false

    const closestX = ox + dx * t
    const closestZ = oz + dz * t
    const cx = disc.x - closestX
    const cz = disc.z - closestZ
    const distSq = cx * cx + cz * cz

    return distSq <= disc.r * disc.r
}

export function isTargetVisibleToLocal(
    localPos: XZPos,
    localYaw: number,
    targetPos: XZPos,
    obstacleDiscs: Array<CollisionDisc> | undefined,
): boolean {
    if (!Number.isFinite(localPos?.x) || !Number.isFinite(localPos?.z) || !Number.isFinite(targetPos?.x) || !Number.isFinite(targetPos?.z)) {
        return false
    }

    const toX = targetPos.x - localPos.x
    const toZ = targetPos.z - localPos.z
    const distSq = toX * toX + toZ * toZ
    if (distSq < 0.03) return true

    const dist = Math.sqrt(distSq)
    const forwardX = Math.sin(localYaw)
    const forwardZ = -Math.cos(localYaw)
    const dot = (toX * forwardX + toZ * forwardZ) / dist
    if (dot < VISIBILITY_FOV_COS) return false

    for (let i = 0; i < (obstacleDiscs?.length ?? 0); i++) {
        const disc = obstacleDiscs[i]
        if (!disc) continue

        const sourceInside = (localPos.x - disc.x) ** 2 + (localPos.z - disc.z) ** 2 <= disc.r ** 2
        const targetInside = (targetPos.x - disc.x) ** 2 + (targetPos.z - disc.z) ** 2 <= disc.r ** 2
        if (sourceInside || targetInside) continue

        if (segmentBlockedByDisc(localPos.x, localPos.z, targetPos.x, targetPos.z, disc)) {
            return false
        }
    }

    return true
}
