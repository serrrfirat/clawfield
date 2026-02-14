#!/usr/bin/env tsx

import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(__dirname, '..')
const CATALOG_PATH = path.join(ROOT, 'apps/client/src/editor/asset-catalog.json')
const MAP_PATH = path.join(ROOT, 'assets/maps/france-ai-frontline.mapdef.json')
const SOURCE_AI_DIR = path.join(ROOT, 'assets/france/ai_gen')
const PUBLIC_ROOT = path.join(ROOT, 'apps/client/public')

const AI_SCALE_FACTORS: Record<string, number> = {
  'france-ai-village-housing': 12,
  'france-ai-stone-house': 10,
  'france-ai-stone-building': 11,
  'france-ai-municipal-hall': 14,
  'france-ai-rural-barn': 13,
  'france-ai-logistics-compound': 16,
  'france-ai-masonry-bridge': 16,
  'france-ai-stone-tower-windmill': 15,
  'france-ai-canvas-tent': 8,
  'france-ai-defensive-wall': 3.5,
  'france-ai-defensive-obstacle': 4.2,
  'france-ai-barbed-wire': 3.6,
  'france-ai-stone-retaining-wall': 6,
  'france-ai-streetlamp': 3,
  'france-ai-ammo-stack': 2.5,
  'france-ai-fuel-drums': 2.6,
  'france-ai-straight-road': 12,
  'france-ai-dirt-ramp': 7,
  'france-ai-grapevines': 5.5,
  'france-ai-transport-vehicle': 7,
  'france-ai-medium-tank': 7.5,
  'france-ai-wwii-south-prism': 9.5,
  'france-ai-wwii-south-meshy': 9.5,
  'france-ai-wwii-south-prism-alt': 9.5,
  'france-ai-narrow-townhouse': 10.5,
  'france-ai-wedge-stone-building': 10,
  'france-ai-stone-village-house': 10,
  'france-ai-water-canal-section': 9,
  'france-ai-z-ruin': 8.5,
}

function readJson(filePath: string): any {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'))
}

function writeJson(filePath: string, value: any): void {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`)
}

async function bakeScaleInPlace(filePath: string, scale: number): Promise<void> {
  if (!fs.existsSync(filePath)) return
  if (Math.abs(scale - 1) < 1e-6) return

  const glb = fs.readFileSync(filePath)
  const scaled = scaleGlbSceneRoots(glb, scale)
  fs.writeFileSync(filePath, scaled)
}

function readGlbChunks(glb: Buffer): { json: any; jsonChunk: Buffer; otherChunks: { type: number; data: Buffer }[] } {
  const dv = new DataView(glb.buffer, glb.byteOffset, glb.byteLength)
  if (dv.getUint32(0, true) !== 0x46546c67) {
    throw new Error(`Invalid GLB magic: ${glb.toString('utf8', 0, 4)}`)
  }
  const version = dv.getUint32(4, true)
  if (version !== 2) {
    throw new Error(`Unsupported GLB version: ${version}`)
  }

  let offset = 12
  let jsonChunk: Buffer | null = null
  const otherChunks: { type: number; data: Buffer }[] = []

  while (offset < glb.byteLength) {
    const chunkLength = dv.getUint32(offset, true)
    const chunkType = dv.getUint32(offset + 4, true)
    const start = offset + 8
    const end = start + chunkLength
    const chunkData = glb.subarray(start, end)

    if (chunkType === 0x4e4f534a) {
      jsonChunk = chunkData
    } else {
      otherChunks.push({ type: chunkType, data: Buffer.from(chunkData) })
    }

    offset = end
  }

  if (!jsonChunk) throw new Error('GLB JSON chunk missing')
  const jsonText = jsonChunk.toString('utf8').trim()
  return { json: JSON.parse(jsonText), jsonChunk, otherChunks }
}

function getNodeUniformScale(node: any): number {
  if (Array.isArray(node?.scale) && node.scale.length >= 3) {
    const [sx, sy, sz] = node.scale
    return (Math.abs(sx) + Math.abs(sy) + Math.abs(sz)) / 3
  }
  if (Array.isArray(node?.matrix) && node.matrix.length >= 16) {
    const m = node.matrix as number[]
    const sx = Math.hypot(m[0], m[1], m[2])
    const sy = Math.hypot(m[4], m[5], m[6])
    const sz = Math.hypot(m[8], m[9], m[10])
    return (sx + sy + sz) / 3
  }
  return 1
}

function getBakeTargetNodeIds(json: any): number[] {
  const sceneIndex = Number.isInteger(json.scene) ? json.scene : 0
  const scene = json.scenes?.[sceneIndex]
  const rootNodeIds: number[] = Array.isArray(scene?.nodes) ? scene.nodes : []
  if (!rootNodeIds.length || !Array.isArray(json.nodes)) return []

  const targetNodeIds: number[] = []
  for (const rootNodeId of rootNodeIds) {
    const rootNode = json.nodes[rootNodeId]
    const childNodeIds: number[] = Array.isArray(rootNode?.children) ? rootNode.children : []
    if (childNodeIds.length) {
      targetNodeIds.push(...childNodeIds)
    } else {
      targetNodeIds.push(rootNodeId)
    }
  }
  return targetNodeIds
}

function multiplyNodeScale(node: any, factor: number): void {
  if (Array.isArray(node?.scale) && node.scale.length >= 3) {
    node.scale = [node.scale[0] * factor, node.scale[1] * factor, node.scale[2] * factor]
    return
  }

  if (Array.isArray(node?.matrix) && node.matrix.length >= 16) {
    const m = [...(node.matrix as number[])]
    m[0] *= factor
    m[1] *= factor
    m[2] *= factor
    m[4] *= factor
    m[5] *= factor
    m[6] *= factor
    m[8] *= factor
    m[9] *= factor
    m[10] *= factor
    node.matrix = m
    return
  }

  node.scale = [factor, factor, factor]
}

function scaleGlbSceneRoots(glb: Buffer, factor: number): Buffer {
  const { json, otherChunks } = readGlbChunks(glb)
  const targetNodeIds = getBakeTargetNodeIds(json)

  if (!targetNodeIds.length || !Array.isArray(json.nodes)) {
    return glb
  }

  for (const nodeId of targetNodeIds) {
    const node = json.nodes[nodeId]
    if (!node) continue
    multiplyNodeScale(node, factor)
  }

  return writeGlb(json, otherChunks)
}

function writeGlb(json: any, otherChunks: { type: number; data: Buffer }[]): Buffer {
  const jsonRaw = Buffer.from(JSON.stringify(json), 'utf8')
  const jsonPad = (4 - (jsonRaw.length % 4)) % 4
  const jsonChunk = jsonPad > 0 ? Buffer.concat([jsonRaw, Buffer.alloc(jsonPad, 0x20)]) : jsonRaw

  const chunks: Buffer[] = []
  const jsonHeader = Buffer.alloc(8)
  jsonHeader.writeUInt32LE(jsonChunk.length, 0)
  jsonHeader.writeUInt32LE(0x4e4f534a, 4)
  chunks.push(jsonHeader, jsonChunk)

  for (const chunk of otherChunks) {
    const pad = (4 - (chunk.data.length % 4)) % 4
    const data = pad > 0 ? Buffer.concat([chunk.data, Buffer.alloc(pad)]) : chunk.data
    const header = Buffer.alloc(8)
    header.writeUInt32LE(data.length, 0)
    header.writeUInt32LE(chunk.type, 4)
    chunks.push(header, data)
  }

  const body = Buffer.concat(chunks)
  const header = Buffer.alloc(12)
  header.write('glTF', 0, 4, 'ascii')
  header.writeUInt32LE(2, 4)
  header.writeUInt32LE(12 + body.length, 8)
  return Buffer.concat([header, body])
}

function approximatelyEqual(a: number, b: number, tolerance = 1e-3): boolean {
  return Math.abs(a - b) <= tolerance
}

function isLikelyAlreadyBaked(filePath: string, targetScale: number): boolean {
  if (!fs.existsSync(filePath)) return false
  const glb = fs.readFileSync(filePath)
  const { json } = readGlbChunks(glb)
  const targetNodeIds = getBakeTargetNodeIds(json)
  if (!targetNodeIds.length || !Array.isArray(json.nodes)) return false

  const scales = targetNodeIds
    .map((nodeId) => json.nodes[nodeId])
    .filter(Boolean)
    .map((node: any) => getNodeUniformScale(node))

  if (!scales.length) return false
  return scales.every((value) => approximatelyEqual(value, targetScale))
}

async function main() {
  const catalog = readJson(CATALOG_PATH)
  const allEntries = catalog as any[]
  const aiEntries = allEntries.filter(
    (entry) => String(entry.id).startsWith('france-ai-') || (entry.tags ?? []).includes('ai-gen'),
  )

  const factorById = new Map<string, number>()
  for (const entry of aiEntries) {
    const factor = AI_SCALE_FACTORS[String(entry.id)] ?? 1
    factorById.set(String(entry.id), factor)
  }

  const touched = {
    baked: 0,
    skippedAlreadyBaked: 0,
    mapScalesNormalized: 0,
  }

  for (const entry of aiEntries) {
    const relPath = String(entry.path)
    const factor = AI_SCALE_FACTORS[String(entry.id)] ?? 1
    if (Math.abs(factor - 1) < 1e-6) continue

    const publicPath = path.join(PUBLIC_ROOT, relPath.replace(/^\//, ''))
    const publicAlreadyBaked = isLikelyAlreadyBaked(publicPath, factor)
    if (!publicAlreadyBaked) {
      await bakeScaleInPlace(publicPath, factor)
      touched.baked += 1
    } else {
      touched.skippedAlreadyBaked += 1
    }

    const base = path.basename(relPath)
    const sourcePath = path.join(SOURCE_AI_DIR, base)
    const sourceAlreadyBaked = isLikelyAlreadyBaked(sourcePath, factor)
    if (!sourceAlreadyBaked) {
      await bakeScaleInPlace(sourcePath, factor)
      touched.baked += 1
    } else {
      touched.skippedAlreadyBaked += 1
    }

  }

  writeJson(CATALOG_PATH, catalog)

  const mapdef = readJson(MAP_PATH)
  if (Array.isArray(mapdef.placements)) {
    for (const placement of mapdef.placements) {
      const id = String(placement.componentId)
      const factor = factorById.get(id)
      if (!factor || Math.abs(factor - 1) < 1e-6) continue
      const s = Array.isArray(placement.scale) ? placement.scale : [1, 1, 1]
      const maxAxis = Math.max(Math.abs(s[0]), Math.abs(s[1]), Math.abs(s[2]))
      if (maxAxis > 4) {
        placement.scale = [s[0] / factor, s[1] / factor, s[2] / factor]
        touched.mapScalesNormalized += 1
      }
    }
  }
  writeJson(MAP_PATH, mapdef)

  console.log(`Baked AI GLBs: ${touched.baked}`)
  console.log(`Skipped already-baked files: ${touched.skippedAlreadyBaked}`)
  console.log(`Normalized map placement scales: ${touched.mapScalesNormalized}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
