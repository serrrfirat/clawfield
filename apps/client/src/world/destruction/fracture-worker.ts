/**
 * Web Worker entry-point — runs three-pinata Voronoi fracturing off the main thread.
 *
 * Vite auto-bundles this as a separate chunk when imported via
 * `new Worker(new URL('./fracture-worker.ts', import.meta.url), { type: 'module' })`
 */

import * as THREE from 'three'
import { DestructibleMesh, FractureOptions } from '@dgreenheck/three-pinata'
import type {
  FractureRequestPayload,
  FractureResponse,
  SerializedFragment,
  SerializedGeometry,
} from './serialization'

/* -------------------------------------------------------------------------- */
/*  Helpers                                                                   */
/* -------------------------------------------------------------------------- */

function rebuildGeometry(sg: SerializedGeometry): THREE.BufferGeometry {
  const geom = new THREE.BufferGeometry()
  geom.setAttribute('position', new THREE.BufferAttribute(sg.position, 3))
  if (sg.normal) geom.setAttribute('normal', new THREE.BufferAttribute(sg.normal, 3))
  if (sg.uv) geom.setAttribute('uv', new THREE.BufferAttribute(sg.uv, 2))
  if (sg.index) geom.setIndex(new THREE.BufferAttribute(sg.index, 1))
  for (const g of sg.groups) {
    geom.addGroup(g.start, g.count, g.materialIndex)
  }
  return geom
}

function serializeFragGeometry(geom: THREE.BufferGeometry): SerializedGeometry {
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

/* -------------------------------------------------------------------------- */
/*  Message handler                                                           */
/* -------------------------------------------------------------------------- */

self.onmessage = (evt: MessageEvent<FractureRequestPayload>) => {
  const req = evt.data

  try {
    const geometry = rebuildGeometry(req.geometry)

    // Dummy materials — the worker only cares about geometry.
    const outerMat = new THREE.MeshBasicMaterial()
    const innerMat = new THREE.MeshBasicMaterial()

    const destructible = new DestructibleMesh(geometry, outerMat, innerMat)
    destructible.position.set(req.position.x, req.position.y, req.position.z)
    destructible.quaternion.set(req.quaternion.x, req.quaternion.y, req.quaternion.z, req.quaternion.w)
    destructible.scale.set(req.scale.x, req.scale.y, req.scale.z)
    destructible.updateMatrixWorld(true)

    const localImpact = new THREE.Vector3(req.localImpact.x, req.localImpact.y, req.localImpact.z)
    const options = new FractureOptions({
      fractureMethod: 'voronoi',
      fragmentCount: req.fragmentCount,
      voronoiOptions: {
        mode: req.voronoiMode,
        impactPoint: localImpact,
        impactRadius: req.impactRadius,
      },
    })

    const fragments = destructible.fracture(options) as DestructibleMesh[]
    const serialized: SerializedFragment[] = []
    const transferables: ArrayBuffer[] = []

    for (const frag of fragments) {
      frag.updateMatrixWorld(true)
      const wp = new THREE.Vector3()
      frag.getWorldPosition(wp)

      const fragGeom = (frag as unknown as THREE.Mesh).geometry
      if (!fragGeom) continue

      const sg = serializeFragGeometry(fragGeom)
      transferables.push(sg.position.buffer)
      if (sg.normal) transferables.push(sg.normal.buffer)
      if (sg.uv) transferables.push(sg.uv.buffer)
      if (sg.index) transferables.push(sg.index.buffer)

      serialized.push({
        geometry: sg,
        center: { x: wp.x, y: wp.y, z: wp.z },
      })

      frag.dispose()
    }

    destructible.dispose()
    outerMat.dispose()
    innerMat.dispose()

    const resp: FractureResponse = { id: req.id, ok: true, fragments: serialized }
    ;(self as unknown as Worker).postMessage(resp, transferables)
  } catch (err: any) {
    const resp: FractureResponse = {
      id: req.id,
      ok: false,
      fragments: [],
      error: String(err?.message ?? err),
    }
    ;(self as unknown as Worker).postMessage(resp)
  }
}
