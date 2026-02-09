# Voxelize Engine Research Notes

Research conducted on [Voxelize](https://github.com/voxelize/voxelize) — a multiplayer voxel engine (Rust backend + TypeScript/Three.js frontend, 614 stars, 1,737 commits).

Goal: identify techniques worth adopting in Clawfield's custom engine.

---

## Tier 1: High Impact

### 1. 4-Tier Lighting System

Voxelize uses a layered approach:

**Tier A — Per-Vertex AO (2 bits, 4 levels)**
```glsl
int ao = (light >> 16) & 0x3;
vAO = uAOTable[ao] / 255.0;  // Table: [140, 185, 220, 255]
```

**Tier B — Per-Voxel Packed RGBS Light (16 bits)**
```glsl
vec4 unpackLight(int l) {
  return vec4(
    (l >> 8) & 0xF,   // Red torch
    (l >> 4) & 0xF,   // Green torch
    l & 0xF,           // Blue torch
    (l >> 12) & 0xF    // Sunlight
  ) / 15.0;
}
```

**Tier C — 3D Light Volume Texture**
- `Data3DTexture` (128x64x128) with `LinearFilter` for smooth interpolation
- Updated when camera moves or `LightSourceRegistry` changes
- Dynamic lights (muzzle flash, explosions) with configurable falloff:
  `pow(max(0, 1 - dist/radius), falloffExponent)`

**Tier D — Cascaded Shadow Maps**
- 3 cascades at splits [16, 48, 128] units
- Logarithmic split distribution
- Texel-aligned stabilization to reduce shimmering
- Per-cascade dirty flags (only re-render when sun direction changes >0.01)
- Smooth cascade blending with 10% overlap region
- Far cascade: cheap 5-tap sampling; near cascade: 5x5 weighted PCF
- Slope bias: `max(0.005 * (1.0 - NdotL), 0.001)`

**Light combination — ACES tonemapping:**
```glsl
vec3 totalLight = 1.0 - (1.0 - sunTotal) * (1.0 - torchLight);
vec3 warmTint = vec3(1.05, 0.92, 0.75);
vec3 coolTint = vec3(0.92, 0.95, 1.05);
totalLight *= mix(coolTint, warmTint, torchDominance);
totalLight = (totalLight * (2.51 * totalLight + 0.03))
           / (totalLight * (2.43 * totalLight + 0.59) + 0.14);
```

### 2. Spatial Entity Sync

Server-side KD-tree radius search + per-client knowledge tracking:

```typescript
class EntitySync {
  private clientKnownEntities = new Map<string, Set<string>>();

  tick(clients: Client[], entities: Entity[]) {
    for (const client of clients) {
      const known = this.clientKnownEntities.get(client.id) ?? new Set();
      const visible = this.spatialIndex.queryRadius(client.position, VISIBLE_RADIUS);

      for (const eid of visible) {
        if (!known.has(eid)) { sendCreate(client, eid); known.add(eid); }
      }
      for (const eid of known) {
        if (!visible.has(eid)) { sendDelete(client, eid); known.delete(eid); }
      }
      for (const eid of visible) {
        if (known.has(eid) && hasChanged(eid)) { sendUpdate(client, eid); }
      }
    }
  }
}
```

### 3. Water Shader

3-octave simplex wave displacement + fresnel + caustics + wavelength absorption:

**Vertex (wave displacement):**
```glsl
float wave1 = snoise(worldPos * 0.15 + time * 0.3) * 0.08;
float wave2 = snoise(worldPos * 0.4 - time * 0.5) * 0.04;
float wave3 = snoise(worldPos * 0.8 + time * 0.7) * 0.02;
transformed.y += wave1 + wave2 + wave3;
```

**Fragment:**
- Fresnel: `0.02 + 0.6 * pow(1.0 - NdotV, 4.0)` clamped to [0.02, 0.55]
- Caustics: `(snoise(xz*0.3+t)^2 + snoise(xz*0.5-t)^2) * 0.5`
- Absorption: `exp(-vec3(0.025, 0.012, 0.004) * waterDepth * absorption)` (red absorbs fastest)

### 4. Priority Chunk Streaming

Chunks the player is looking toward are prioritized:
```typescript
function chunkPriority(chunkPos: Vec2, playerPos: Vec3, playerDir: Vec3): number {
  const dx = chunkPos.x * CHUNK_SIZE - playerPos.x;
  const dz = chunkPos.z * CHUNK_SIZE - playerPos.z;
  const dist = Math.sqrt(dx * dx + dz * dz);
  const dirX = dx / dist, dirZ = dz / dist;
  const dot = dirX * playerDir.x + dirZ * playerDir.z;
  return dist - dot * 32; // lower = higher priority
}
```

---

## Tier 2: Quick Wins

### 5. Height + Distance Fog

Combined formula creates natural valley haze:
```glsl
float distFog = smoothstep(uFogNear, uFogFar, depth);
float heightFog = 1.0 - exp(-uFogHeightDensity * max(0.0, uFogHeightOrigin - vWorldPosition.y));
float heightDistScale = smoothstep(uFogNear * 0.3, uFogFar * 0.6, depth);
float fogFactor = max(distFog, heightFog * heightDistScale);
```

### 6. Transparent Face Radix Sort

O(n) radix sort instead of O(n log n) for water/glass faces:
```typescript
// Float-to-int for unsigned descending sort
_floatView[0] = distances[i];
const bits = _intView[0];
keys[i] = bits ^ (-(bits >> 31) | 0x80000000) ^ 0xffffffff;
```
- Camera movement threshold (0.25 sq dist) to skip unnecessary re-sorts
- Pre-allocated buffers to avoid GC pressure

### 7. Light Attribute Bit Packing

Single `int` attribute per vertex:
```
Bits 0-15:  RGBS light (4 bits each)
Bits 16-17: AO level (0-3)
Bit 18:     isFluid
Bit 19:     isGreedy
Bit 20:     shouldWave
```

### 8. Message Compression Threshold

Only LZ4-compress messages over 4KB:
```typescript
function encodeMessage(msg: Message): Buffer {
  const encoded = Message.encode(msg).finish();
  if (encoded.length > 4096) {
    return lz4.encode(encoded);
  }
  return Buffer.from(encoded);
}
```

### 9. Greedy Mesh UV Fix

Use `fract(worldPosition)` in fragment shader to tile textures across merged faces:
```glsl
if (absNormal.y > 0.5) {
  localUv = vec2(1.0 - fract(vWorldPosition.x), fract(vWorldPosition.z));
} else if (absNormal.x > 0.5) {
  localUv = vec2(fract(vWorldPosition.z), fract(vWorldPosition.y));
} else {
  localUv = vec2(fract(vWorldPosition.x), fract(vWorldPosition.y));
}
```

---

## Tier 3: Architecture Patterns

### 10. Dual Transport (WebSocket + WebRTC)

- WebSocket: reliable (chunks, events, RPC)
- WebRTC data channel: unreliable low-latency (player positions, entity updates)
- Messages auto-routed by type
- Large messages fragmented into 15,991-byte chunks with 9-byte header

### 11. Worker Pool with Generation Tracking

Each chunk tracks mesh freshness:
```typescript
// Prevents stale mesh results from replacing newer ones
onJobComplete(key: string, jobGeneration: number): boolean {
  state.inFlightGeneration = null;
  if (jobGeneration < state.displayedGeneration) return false; // Stale
  state.displayedGeneration = jobGeneration;
  return true;
}
```
- LIFO available-worker index for cache warmth
- Transferable ArrayBuffers to avoid copies

### 12. Background Chunk Saver

Deduplicating save queue with atomic writes:
```typescript
class ChunkSaver {
  private pending = new Map<string, ChunkData>();

  queue(cx: number, cz: number, data: ChunkData) {
    this.pending.set(`${cx},${cz}`, data); // Deduplicates naturally
  }

  private async flush() {
    const batch = new Map(this.pending);
    this.pending.clear();
    for (const [key, data] of batch) {
      const compressed = zlib.deflateSync(data.toBuffer());
      await fs.writeFile(`${key}.json.tmp`, JSON.stringify({ voxels: compressed.toString('base64') }));
      await fs.rename(`${key}.json.tmp`, `${key}.json`); // Atomic
    }
  }
}
```

### 13. Stage-Based Generation Pipeline

Composable terrain stages with neighbor dependency declarations:
```typescript
interface ChunkStage {
  name: string;
  process(chunk: ChunkData, registry: BlockRegistry): void;
  neighbors?(cx: number, cz: number): [number, number][];
}
```

### 14. Voxel Bit Packing

Pack voxel data into `Uint32Array`:
- Bits 0-15: Block ID (65536 types)
- Bits 16-19: Rotation (4 bits)
- Bits 20-23: Y-rotation (4 bits)
- Bits 24-27: Stage/variant (4 bits, e.g. fluid level)

### 15. Character Rendering

- Modular body parts (head, body, arms, legs) as `CanvasBox` groups
- Head tracks look direction instantly; body slerps to catch up
- Walking animation: sinusoidal arm/leg swing with lerp smoothing
- Weapon swap: easeOutCubic drop + easeInOutQuad rise, 0.2s

---

## Other Notable Techniques

- **CSM debug modes** (7 modes): shadow only, NdotL, AO, cascade vis, slope bias, sun exposure, tunnel darkening
- **Protobuf + LZ4** networking with structure-of-arrays layout for bulk updates
- **Client-driven chunk loading** (LOAD/UNLOAD messages)
- **Entity persistence** with `DoNotPersistComp` for transient objects (projectiles)
- **Sleep system** for physics bodies at rest
- **Auto-stepping** for climbing small obstacles without jumping

---

## Sources

- [Voxelize GitHub](https://github.com/voxelize/voxelize)
- [Divine Voxel Engine](https://github.com/lucasdamianjohnson/DivineVoxelEngine)
- [Voxelize Demo](https://realms.voxelize.io/parkour)
