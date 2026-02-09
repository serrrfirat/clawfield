# Clawfield - Lessons Learned

## Rendering / Materials

### Custom palettes break hardcoded material assumptions
Material indices 1-6 (MAT_GRASS through MAT_WATER) have hardcoded atlas tile textures, but custom maps (like Shoreline) override these palette indices with completely different colors (e.g. index 1 = sand, not grass). Any mesher/shader code that assumes "material 1 = grass" must verify the palette color matches the expected color first. Otherwise, fall back to palette RGB + white fallback tile. The guard is:
```typescript
const hasAtlasTile = MATERIAL_TILES[mat] !== undefined
  && MATERIAL_COLORS[mat] === EXPECTED_COLORS[mat];
```

## Project Setup

### Shared package must be rebuilt after pulling
The `packages/shared/` workspace is compiled to `packages/shared/dist/` via `tsc`. The client imports from the dist. After any `git pull` that touches `packages/shared/src/`, you MUST run `pnpm --filter shared build` or the client will use stale exports — causing black screens, undefined imports, or missing symbols. This has caused black screens multiple times already.

### Kill old server before testing protocol changes
The game server (`tsx --watch`) may not always restart cleanly. If new message types are added (e.g. `create_room`), an old server silently ignores unknown messages — nothing crashes, nothing errors, the client just gets no response. Always check `lsof -ti :3000` and kill stale processes before testing.
