# Clawfield - Lessons Learned

## Rendering / Materials

### Custom palettes break hardcoded material assumptions
Material indices 1-6 (MAT_GRASS through MAT_WATER) have hardcoded atlas tile textures, but custom maps (like Shoreline) override these palette indices with completely different colors (e.g. index 1 = sand, not grass). Any mesher/shader code that assumes "material 1 = grass" must verify the palette color matches the expected color first. Otherwise, fall back to palette RGB + white fallback tile. The guard is:
```typescript
const hasAtlasTile = MATERIAL_TILES[mat] !== undefined
  && MATERIAL_COLORS[mat] === EXPECTED_COLORS[mat];
```

## Project Setup
- (none yet)
