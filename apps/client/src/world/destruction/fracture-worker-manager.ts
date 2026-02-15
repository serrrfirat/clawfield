import type {
  FractureRequestPayload,
  FractureResponse,
  SerializedFragment,
  SerializedGeometry,
} from './serialization'
import { collectTransferables } from './serialization'
import FractureWorkerConstructor from './fracture-worker?worker'

const TIMEOUT_MS = 5_000

interface PendingRequest {
  resolve: (fragments: SerializedFragment[]) => void
  reject: (err: Error) => void
  timer: ReturnType<typeof setTimeout>
}

class FractureWorkerManager {
  private worker: Worker | null = null
  private nextId = 1
  private pending = new Map<number, PendingRequest>()
  private disposed = false

  /** Create the worker eagerly (call from setScene). */
  init(): void {
    this.disposed = false
    if (!this.worker) this.spawnWorker()
  }

  /** Terminate worker + reject all pending (call from clear). */
  dispose(): void {
    this.disposed = true
    this.rejectAll(new Error('FractureWorkerManager disposed'))
    if (this.worker) {
      this.worker.terminate()
      this.worker = null
    }
  }

  /**
   * Post a fracture request and return a promise that resolves with the
   * serialized fragment data.
   */
  requestFracture(
    geometry: SerializedGeometry,
    position: { x: number; y: number; z: number },
    quaternion: { x: number; y: number; z: number; w: number },
    scale: { x: number; y: number; z: number },
    localImpact: { x: number; y: number; z: number },
    fragmentCount: number,
    voronoiMode: '3D' | '2.5D',
    impactRadius: number,
  ): Promise<SerializedFragment[]> {
    if (this.disposed) return Promise.reject(new Error('disposed'))

    if (!this.worker) this.spawnWorker()

    const id = this.nextId++
    const payload: FractureRequestPayload = {
      id,
      geometry,
      position,
      quaternion,
      scale,
      localImpact,
      fragmentCount,
      voronoiMode,
      impactRadius,
    }

    return new Promise<SerializedFragment[]>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error('Fracture worker timeout'))
      }, TIMEOUT_MS)

      this.pending.set(id, { resolve, reject, timer })

      const transferables = collectTransferables(geometry)
      this.worker!.postMessage(payload, transferables)
    })
  }

  /* ---------------------------------------------------------------------- */
  /*  Internal                                                               */
  /* ---------------------------------------------------------------------- */

  private spawnWorker(): void {
    this.worker = new FractureWorkerConstructor()

    this.worker.onmessage = (evt: MessageEvent<FractureResponse>) => {
      const resp = evt.data
      const pending = this.pending.get(resp.id)
      if (!pending) return
      this.pending.delete(resp.id)
      clearTimeout(pending.timer)

      if (resp.ok) {
        pending.resolve(resp.fragments)
      } else {
        pending.reject(new Error(resp.error ?? 'Fracture failed in worker'))
      }
    }

    this.worker.onmessageerror = (e) => {
      console.warn('[FractureWorker] messageerror:', e)
    }

    this.worker.onerror = (e) => {
      console.warn('[FractureWorker] worker error:', e.message ?? e)
      this.rejectAll(new Error(`Fracture worker crashed: ${e.message ?? 'unknown'}`))
      if (this.worker) {
        this.worker.terminate()
        this.worker = null
      }
    }
  }

  private rejectAll(err: Error): void {
    for (const p of this.pending.values()) {
      clearTimeout(p.timer)
      p.reject(err)
    }
    this.pending.clear()
  }
}

export const fractureWorkerManager = new FractureWorkerManager()
