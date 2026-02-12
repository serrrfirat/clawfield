# Clawfield - Task Tracking

## Completed: BattleBit-Style Visual Enhancement (5 Phases)
- [x] Phase 1: Per-Vertex Ambient Occlusion (mesher.ts, chunk-mesh.ts, world-renderer.ts, viewer.ts, voxel-object-renderer.ts)
- [x] Phase 2: Hi-Res Texture Atlas — 16→32px tiles, LinearFilter + mipmaps (texture-atlas.ts, build-atlas.ts)
- [x] Phase 3: Normal Maps — Sobel-filter normal atlas generation + shader TBN perturbation (build-atlas.ts, world-renderer.ts, texture-atlas.ts)
- [x] Phase 4: Detail Props — grass/rocks/rubble InstancedMesh system (detail-props.ts, world-renderer.ts, main.ts)
- [x] Phase 5: Per-Material PBR & Edge Darkening — materialId vertex attribute, 256x1 PBR lookup texture (roughness/metalness/emissive/edgeDark per material), shader patches for per-material roughness+metalness+emissive, voxel edge darkening for chamfered look, post-processing tuning (bloom threshold 0.80, SSAO radius 2, exposure 0.85)

## Completed: Astroneer-Style Low-Poly Visual Transition
- [x] Phase 0: Playwright test harness (playwright.config.ts, tests/visual-check.spec.ts)
- [x] Phase 1: Enhanced terrain with simplex noise micro-displacement + slope-based coloring (chunk-mesh.ts)
- [x] Phase 2: Surface Nets mesher for buildings — Astroneer-style flat-shaded smooth geometry (surface-nets.ts, voxel-object-renderer.ts, world-renderer.ts)
- [x] Phase 3: Section-based destruction swap — smooth→voxel on damage, 8x8x8 sections (building-section-manager.ts, main.ts)
- [x] Phase 4: Polish — pastelized building palettes, stronger ambient fill, section rebuild cap (voxel-object-renderer.ts, renderer.ts)

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
