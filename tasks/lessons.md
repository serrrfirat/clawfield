# Clawfield - Lessons Learned

## Rendering / Materials

### Greedy mesher water filter silently eats voxel object voxels
The `greedyMesh()` function filters palette indices 6 and 17 via `isWater()` — designed for terrain chunks. Voxel objects (.vobj.json) use their own palettes where indices 6/17 are regular colors (e.g. khaki, dark gray). This caused the sandbag cover to lose 44% of its voxels, the wall segment 18%, and the watchtower 13%. Fix: added `skipWaterFilter` parameter to `greedyMesh()` — always pass `true` when meshing voxel objects. **Rule: any terrain-specific filter in shared mesher code must have an opt-out for voxel objects.**

### Custom palettes break hardcoded material assumptions
Material indices 1-6 (MAT_GRASS through MAT_WATER) have hardcoded atlas tile textures, but custom maps (like Shoreline) override these palette indices with completely different colors (e.g. index 1 = sand, not grass). Any mesher/shader code that assumes "material 1 = grass" must verify the palette color matches the expected color first. Otherwise, fall back to palette RGB + white fallback tile. The guard is:
```typescript
const hasAtlasTile = MATERIAL_TILES[mat] !== undefined
  && MATERIAL_COLORS[mat] === EXPECTED_COLORS[mat];
```

## Project Setup

### Shared package must be rebuilt after pulling
The `packages/shared/` workspace is compiled to `packages/shared/dist/` via `tsc`. The client imports from the dist. After any `git pull` that touches `packages/shared/src/`, you MUST run `pnpm --filter shared build` or the client will use stale exports — causing black screens, undefined imports, or missing symbols. This has caused black screens multiple times already.

### Google 3D Tiles use RTC (Relative-To-Center) coordinates
Google's Photorealistic 3D Tiles store GLB vertex positions in a local coordinate system centered on the tile's bounding volume center — NOT in ECEF. The tile hierarchy transforms are often identity for leaf nodes. To get correct ECEF positions, you must add the BV center as an offset: `ECEF_pos = bvCenter + glb_pos`. The transform chain is `enuMatrix * tileTransform * translate(bvCenter)`. Session tokens must also be propagated from parent URIs to child sub-tileset URIs that lack them.

### Flood fill on large 3D grids: use flat arrays, not string Sets
For BFS flood fill on voxel grids, NEVER use `Set<string>` with keys like `"x,y,z"` — the string hashing is O(n) per key and memory-heavy. Also never use `Array.shift()` for a BFS queue — it's O(n) per call. Instead: use a flat `Uint8Array(width*height*depth)` for the visited/state field, and a typed array with a head pointer for the queue. This takes a 128M-cell flood fill from "hangs forever" to 0.4 seconds.

### Kill old server before testing protocol changes
The game server (`tsx --watch`) may not always restart cleanly. If new message types are added (e.g. `create_room`), an old server silently ignores unknown messages — nothing crashes, nothing errors, the client just gets no response. Always check `lsof -ti :3000` and kill stale processes before testing.
