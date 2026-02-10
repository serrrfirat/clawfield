# Clawfield - Task Tracking

## Completed: BattleBit-Style Visual Enhancement (4 Phases)
- [x] Phase 1: Per-Vertex Ambient Occlusion (mesher.ts, chunk-mesh.ts, world-renderer.ts, viewer.ts, voxel-object-renderer.ts)
- [x] Phase 2: Hi-Res Texture Atlas — 16→32px tiles, LinearFilter + mipmaps (texture-atlas.ts, build-atlas.ts)
- [x] Phase 3: Normal Maps — Sobel-filter normal atlas generation + shader TBN perturbation (build-atlas.ts, world-renderer.ts, texture-atlas.ts)
- [x] Phase 4: Detail Props — grass/rocks/rubble InstancedMesh system (detail-props.ts, world-renderer.ts, main.ts)

## Active Task: Scale Karkand Map to ~600m (1200 voxels)

### Size Comparison
| | Current | Target | BF2 Karkand |
|---|---|---|---|
| Voxels | 300×300 | 1200×1200 | ~1400×1400 equiv |
| World meters | 150m | 600m | ~700m playable |
| VOXEL_SIZE | 0.5m | 0.5m (unchanged) | ~1m |

### Scale Factor: 4×
All X/Z coordinates × 4. Y heights stay the same — buildings are already realistic scale.
Building footprints stay similar. What changes is spacing between landmarks and terrain area.

### Checklist
- [ ] mapdef.json: bounds ±150 → ±600, all coords × 4
- [ ] heightAtKarkand(): scale suburb/factory/river params × 4
- [ ] generateKarkandRoads(): waypoints × 4, wider roads, scaled alley grid
- [ ] generateKarkandBuildings(): scaled block grid, same building sizes
- [ ] generateKarkandRiver(): channel × 4, wider
- [ ] All 9 landmarks: center coords × 4, footprints same or +50%
- [ ] generateKarkandCover(): all positions × 4
- [ ] generateKarkandOutskirts(): all positions × 4
- [ ] generateKarkandPerimeter(): L-shaped wall × 4
- [ ] Generate map, verify output
- [ ] Visual check in viewer
