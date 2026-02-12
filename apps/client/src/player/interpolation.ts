import { INTERPOLATION_DELAY } from '@clawfield/shared'
import type { PlayerState, Vec3 } from '@clawfield/shared'

interface BufferedState {
  time: number
  state: PlayerState
}

export class StateInterpolator {
  private states: BufferedState[] = []

  push(state: PlayerState): void {
    this.states.push({ time: performance.now(), state })
    // Keep only last 1 second
    const cutoff = performance.now() - 1000
    while (this.states.length > 2 && this.states[0].time < cutoff) {
      this.states.shift()
    }
  }

  /** Get interpolated position and yaw at current render time */
  getInterpolated(): { position: Vec3; yaw: number } | null {
    if (this.states.length === 0) return null

    const now = performance.now() - INTERPOLATION_DELAY

    if (this.states.length < 2) {
      const s = this.states[0].state
      return { position: s.position, yaw: s.yaw }
    }

    let from = this.states[0]
    let to = this.states[1]

    for (let i = 1; i < this.states.length; i++) {
      if (this.states[i].time >= now) {
        to = this.states[i]
        from = this.states[i - 1]
        break
      }
      from = this.states[i]
      to = this.states[Math.min(i + 1, this.states.length - 1)]
    }

    const range = to.time - from.time
    const t = range > 0 ? Math.max(0, Math.min(1, (now - from.time) / range)) : 1

    return {
      position: {
        x: from.state.position.x + (to.state.position.x - from.state.position.x) * t,
        y: from.state.position.y + (to.state.position.y - from.state.position.y) * t,
        z: from.state.position.z + (to.state.position.z - from.state.position.z) * t,
      },
      yaw: from.state.yaw + (to.state.yaw - from.state.yaw) * t,
    }
  }

  get latestState(): PlayerState | null {
    return this.states.length > 0 ? this.states[this.states.length - 1].state : null
  }
}
