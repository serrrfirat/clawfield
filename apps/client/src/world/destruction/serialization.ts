import type * as THREE from 'three'

/* -------------------------------------------------------------------------- */
/*  Types                                                                     */
/* -------------------------------------------------------------------------- */

export interface SerializedGeometry {
  position: Float32Array
  normal: Float32Array | null
  uv: Float32Array | null
  index: Uint32Array | null
  groups: Array<{ start: number; count: number; materialIndex: number }>
}

export interface SerializedFragment {
  geometry: SerializedGeometry
  /** World-space center of this fragment (set by the worker). */
  center: { x: number; y: number; z: number }
}

export interface FractureRequestPayload {
  id: number
  geometry: SerializedGeometry
  position: { x: number; y: number; z: number }
  quaternion: { x: number; y: number; z: number; w: number }
  scale: { x: number; y: number; z: number }
  localImpact: { x: number; y: number; z: number }
  fragmentCount: number
  voronoiMode: '3D' | '2.5D'
  impactRadius: number
}

export interface FractureResponse {
  id: number
  ok: boolean
  fragments: SerializedFragment[]
  error?: string
}

/* -------------------------------------------------------------------------- */
/*  Serialization helpers                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Clone geometry attribute buffers into fresh typed-arrays suitable for
 * `postMessage` transferable list.
 */
export function serializeGeometry(geom: THREE.BufferGeometry): SerializedGeometry {
  const pos = geom.getAttribute('position') as THREE.BufferAttribute
  const norm = geom.getAttribute('normal') as THREE.BufferAttribute | undefined
  const uv = geom.getAttribute('uv') as THREE.BufferAttribute | undefined
  const idx = geom.getIndex()

  return {
    position: new Float32Array(pos.array),
    normal: norm ? new Float32Array(norm.array) : null,
    uv: uv ? new Float32Array(uv.array) : null,
    index: idx ? new Uint32Array(idx.array) : null,
    groups: geom.groups.map((g) => ({
      start: g.start,
      count: g.count,
      materialIndex: g.materialIndex ?? 0,
    })),
  }
}

/**
 * Collect transferable array-buffers from a serialized geometry so they can be
 * zero-copy transferred via `postMessage`.
 */
export function collectTransferables(sg: SerializedGeometry): ArrayBuffer[] {
  const out: ArrayBuffer[] = [sg.position.buffer]
  if (sg.normal) out.push(sg.normal.buffer)
  if (sg.uv) out.push(sg.uv.buffer)
  if (sg.index) out.push(sg.index.buffer)
  return out
}
