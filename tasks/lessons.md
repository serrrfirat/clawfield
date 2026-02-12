# Clawfield - Lessons Learned

## VoxelEarth / Tile Assembly

### Voxelizer ignores GLB scene graph transforms — must extract translations manually
The VoxelEarth `java-cpu-voxelizer` reads vertex positions in "object coords (no node transforms)". Each tile's vertices are in a local frame (centered near 0), so independently voxelizing 465 tiles produces 465 copies of the same ~128³ grid → solid cube. **Fix:** After the decoder runs with `--rotate-flat --origin`, the root node has a translation-only transform in ENU meters. Parse each decoded GLB's JSON chunk to extract this translation, then apply `round(translation / voxelUnit)` as an offset when merging voxels. The `emitPosition()` method exists in the voxelizer source but is never called — don't rely on `_position.json` files.

### Decoder --rotate-flat bakes rotation but NOT translation
The decoder's `--rotate-flat` flag bakes `R·S` into vertex positions and sets the root node to "translation-only". This means vertices get Y-up orientation but remain in local space. The ECEF→ENU translation is preserved in the scene graph, not in vertex data. Any downstream tool that reads "object-space" vertices will miss the spatial positioning entirely.

## Rendering / Materials

### Validate map silhouette in viewer before claiming "playable"
Large imported `.vobj` building assets can have very different footprint/origin scales than expected, which can collapse a map into overlapping blocks even if placement coordinates look reasonable in JSON. For any new map pipeline output, always do a viewer silhouette sanity pass (top-down + low-angle) and check for overlap/readability before handing it off. If silhouette fails, fall back to procedural blockout first, then reintroduce imported assets gradually.

### First-pass blockouts must hit a density benchmark
When the goal is an urban battlefield, a sparse prototype with widely spaced boxes will feel "empty and wrong" even if lanes are technically playable. Before presenting, enforce a minimum density bar: multiple road hierarchies (major + minor), block subdivision, varied building heights, and intersection cover at most key nodes. In practice: generate district-level structure first, then add micro-detail passes (cover, rubble, lane blockers) in the same iteration.

### Greedy mesher water filter silently eats voxel object voxels
The `greedyMesh()` function filters palette indices 6 and 17 via `isWater()` — designed for terrain chunks. Voxel objects (.vobj.json) use their own palettes where indices 6/17 are regular colors (e.g. khaki, dark gray). This caused the sandbag cover to lose 44% of its voxels, the wall segment 18%, and the watchtower 13%. Fix: added `skipWaterFilter` parameter to `greedyMesh()` — always pass `true` when meshing voxel objects. **Rule: any terrain-specific filter in shared mesher code must have an opt-out for voxel objects.**

### Triangle winding order matters for terrain heightmaps
When generating terrain mesh via heightmap triangulation, the vertex winding order determines which side is the "front face". Three.js uses CCW = front face (OpenGL convention). A quad at corners (x0,z0), (x1,z0), (x0,z1), (x1,z1) must have CCW order when viewed from above (positive Y). The triangle (00→10→11) is CW from above → backface-culled → invisible terrain. Fix: use (00→11→10) instead. Symptom: terrain appears "white" because the sky dome is visible through the culled terrain. Always verify: `e1 × e2` should give positive Y for upward-facing terrain.

### Custom palettes break hardcoded material assumptions
Material indices 1-6 (MAT_GRASS through MAT_WATER) have hardcoded atlas tile textures, but custom maps (like Shoreline) override these palette indices with completely different colors (e.g. index 1 = sand, not grass). Any mesher/shader code that assumes "material 1 = grass" must verify the palette color matches the expected color first. Otherwise, fall back to palette RGB + white fallback tile. The guard is:
```typescript
const hasAtlasTile = MATERIAL_TILES[mat] !== undefined
  && MATERIAL_COLORS[mat] === EXPECTED_COLORS[mat];
```

## Map Design

### Standard map size: 1000×1000 voxels (bounds ±500)
All maps should target 1000×1000 voxel bounds (`xMin: -500, xMax: 500, zMin: -500, zMax: 500`). This matches BF2 64-player scale (~1km²). When scaling up a smaller map, use the "scale the world, not the buildings" principle: landmark positions scale fully (3.33x for 300→1000), but individual building footprints only scale ~1.5x to stay human-readable. The extra space becomes courtyards, open terrain, and side streets. Karkand at this size: 33 MB output, 0.67s generation, 8429 chunks.

## Physics

### Physics coordinates are in voxel units, not meters
The physics system (`aabbOverlapsSolid`, `playerAABB`, `movePlayer`) operates in **voxel units** where 1 unit = 1 voxel. `VOXEL_SIZE = 0.5` is only for rendering scale, not physics. A 1-voxel terrain step = 1.0 in physics coords. When setting step-up/jump/size constants, always think in voxel units. Example: `STEP_HEIGHT = 0.6` was wrong because 0.6 < 1.0 voxel (the blocking voxel still overlapped). Fixed to `STEP_HEIGHT = 1.1` (slightly more than 1 voxel, gravity settles the rest).

## Project Setup

### Shared package must be rebuilt after pulling
The `packages/shared/` workspace is compiled to `packages/shared/dist/` via `tsc`. The client imports from the dist. After any `git pull` that touches `packages/shared/src/`, you MUST run `pnpm --filter shared build` or the client will use stale exports — causing black screens, undefined imports, or missing symbols. This has caused black screens multiple times already.

### Google 3D Tiles use RTC (Relative-To-Center) coordinates
Google's Photorealistic 3D Tiles store GLB vertex positions in a local coordinate system centered on the tile's bounding volume center — NOT in ECEF. The tile hierarchy transforms are often identity for leaf nodes. To get correct ECEF positions, you must add the BV center as an offset: `ECEF_pos = bvCenter + glb_pos`. The transform chain is `enuMatrix * tileTransform * translate(bvCenter)`. Session tokens must also be propagated from parent URIs to child sub-tileset URIs that lack them.

### Flood fill on large 3D grids: use flat arrays, not string Sets
For BFS flood fill on voxel grids, NEVER use `Set<string>` with keys like `"x,y,z"` — the string hashing is O(n) per key and memory-heavy. Also never use `Array.shift()` for a BFS queue — it's O(n) per call. Instead: use a flat `Uint8Array(width*height*depth)` for the visited/state field, and a typed array with a head pointer for the queue. This takes a 128M-cell flood fill from "hangs forever" to 0.4 seconds.

### Kill old server before testing protocol changes
The game server (`tsx --watch`) may not always restart cleanly. If new message types are added (e.g. `create_room`), an old server silently ignores unknown messages — nothing crashes, nothing errors, the client just gets no response. Always check `lsof -ti :3000` and kill stale processes before testing.
