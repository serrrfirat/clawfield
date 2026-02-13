import { INTERPOLATION_DELAY } from '@clawfield/shared'
import type { PlayerState, Vec3 } from '@clawfield/shared'
import { SnapshotInterpolation } from '@geckos.io/snapshot-interpolation'

type SnapshotEntity = {
  id: string
  x: number
  y: number
  z: number
  yaw: number
}

type SnapshotPacket = {
  id: string
  time: number
  state: SnapshotEntity[]
}

export class StateInterpolator {
  private si = new SnapshotInterpolation(30)
  private latest: PlayerState | null = null
  private seq = 0

  constructor() {
    // Keep interpolation latency aligned with the project's reveal/sync tuning.
    this.si.interpolationBuffer.set(INTERPOLATION_DELAY)
  }

  push(state: PlayerState): void {
    this.latest = state
    this.seq++

    const snapshot: SnapshotPacket = {
      id: String(this.seq),
      time: Date.now(),
      state: [
        {
          id: state.id,
          x: state.position.x,
          y: state.position.y,
          z: state.position.z,
          yaw: state.yaw,
        },
      ],
    }

    this.si.snapshot.add(snapshot as any)
  }

  /** Get interpolated position and yaw at current render time */
  getInterpolated(): { position: Vec3; yaw: number } | null {
    const interpolated = this.si.calcInterpolation('x y z yaw') as any
    const entity = interpolated?.state?.[0]

    if (entity) {
      return {
        position: {
          x: entity.x,
          y: entity.y,
          z: entity.z,
        },
        yaw: entity.yaw,
      }
    }

    if (this.latest) {
      return { position: this.latest.position, yaw: this.latest.yaw }
    }

    return null
  }

  get latestState(): PlayerState | null {
    return this.latest
  }
}
