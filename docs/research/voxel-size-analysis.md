# Cell Size Analysis: Are We Too Constrained?

## Current Configuration

| Parameter | Value | Notes |
|-----------|-------|-------|
| `VOXEL_SIZE` | 0.5m | Base terrain/world cell |
| `CHUNK_SIZE` | 16³ | 16×16×16 = 4096 cells per chunk |
| Chunk world size | 8m³ | 16 × 0.5m |
| Player height | 1.8m | ~3.6 cells tall |
| Terrain resolution | 2 cells/m | 0.5m cells |
| Building resolution | 4 cells/m | 0.25m cells |
| Prop resolution | 8 cells/m | 0.125m cells |
| Vegetation resolution | 5 cells/m | 0.2m cells |

## Industry Comparisons

| Game/Engine | Cell Size | Chunk Size | Context |
|-------------|-----------|------------|---------|
| **Minecraft** | 1.0m | 16×16×16 | Iconic blocky style, infinite worlds |
| **Teardown** | 0.1m | Custom | High-fidelity destruction, small maps |
| **Vintage Story** | 1.0m | 32×32×32 | Survival sandbox |
| **Ace of Spades** | 1.0m | — | Multiplayer FPS + cells |
| **Cell.js** | 1.0m | 32×32×32 | Browser-based (Three.js) |
| **Clawfield (ours)** | 0.5m | 16×16×16 | Browser multiplayer FPS, 24v24 |

## Are We Too Constrained?

### Short answer: No — the multi-resolution system already solves this well.

The base `VOXEL_SIZE = 0.5m` for terrain is reasonable. And the `CATEGORY_RESOLUTION` system in `cell-object.ts` already provides finer detail where it matters (buildings at 0.25m, props at 0.125m). This is a smart approach that most cell engines don't have.

### What the research says

**1. The O(n³) scaling problem is real**
Halving cell size means 8× more cells. Going from 0.5m to 0.25m globally would increase terrain memory from ~32MB to ~256MB uncompressed. In a browser context with WebGL, this is a hard constraint.

**2. The browser is the actual constraint, not the cell size**
CPU-side mesh generation (greedy meshing) is the primary bottleneck in browser cell engines, not GPU rendering. Three.js + WebGL doesn't have access to compute shaders or hardware tessellation for advanced LOD techniques. The 0.5m terrain cell keeps chunk remeshing fast enough for real-time destruction.

**3. Teardown's 0.1m cells come with severe tradeoffs**
Teardown achieves high-res destruction with 10cm cells, but:
- Requires a custom C++ engine with cell ray tracing
- Maps are intentionally small (technical limitation on level size)
- No multiplayer (no network sync of cell state)
- Structural integrity doesn't scale — big buildings can float on a single cell strand

For a 24v24 browser multiplayer game streaming chunks over WebSocket, these tradeoffs don't apply.

**4. 16³ chunks are the standard for a reason**
The consensus across multiple engines is 16³ or 32³ chunks with power-of-2 dimensions. Our 16³ is appropriate given:
- Smaller chunks = faster remeshing after destruction (critical for gameplay feel)
- Smaller chunks = more granular LOD and streaming
- 32³ would mean 32,768 cells per chunk vs 4,096 — much slower to remesh on destruction events

**5. Player scale is well-calibrated**
At 0.5m/cell, a player is ~3.6 cells tall. This is close to the design target of "~4 cells tall" and provides enough granularity for cover, doorways, windows, and destruction holes that players can move through. Minecraft's 1m cells make the player only ~2 blocks tall, which limits gameplay options significantly.

## Where We Could Be Less Constrained

Rather than changing the base cell size, these are more impactful areas to investigate:

### 1. Increase building/prop resolution where it matters
The multi-resolution system already supports this. Consider:
- Bump `building` from 4 cells/m to 6 or 8 cells/m for more detailed destruction
- Only matters for visual fidelity of destruction holes

### 2. Larger destruction radii instead of smaller cells
A grenade destroying a 5-cell radius (2.5m) at 0.5m resolution creates a satisfying crater. The visual quality of destruction edges matters more than cell size — and greedy meshing already handles this.

### 3. Consider 32³ chunks for terrain-only
Terrain rarely gets remeshed (ground is indestructible). Larger terrain chunks would reduce draw calls for the landscape while keeping building chunks at 16³ for fast destruction remeshing. This is a hybrid approach.

### 4. Sub-cell visual detail via normals/AO
Teardown and modern cell engines add visual detail through per-cell ambient occlusion, normal mapping on LOD meshes, and material-specific rendering. This adds perceived detail without increasing cell count.

### 5. Network bandwidth is the real ceiling
With 24v24 multiplayer and chunk streaming, cell state sync is the limiting factor. Each destruction event sends cell changes over WebSocket. The current `MAX_VOXEL_CHANGES_PER_TICK = 600` budget already limits destruction throughput. Smaller cells would mean more changes per explosion, hitting this cap faster.

## Recommendation

**Keep `VOXEL_SIZE = 0.5m` for terrain.** It's the right balance for a browser-based 24v24 FPS.

**The multi-resolution object system is the correct architecture.** It lets buildings and props have higher detail where players interact with them, without bloating terrain memory.

**If we want more visual fidelity, invest in:**
1. Sub-cell rendering techniques (AO, normals) rather than smaller cells
2. Tuning per-category resolutions for the destruction feel we want
3. Optimizing chunk remeshing speed (web workers, WASM greedy mesher) to unlock higher object resolutions

## Sources

- [The Perfect Cell Engine — John Lin](https://voxely.net/blog/the-perfect-cell-engine/)
- [High Performance Cell Engine — Nick's Blog](https://nickmcd.me/2021/04/04/high-performance-cell-engine/)
- [Cell Tools Performance Documentation](https://cell-tools.readthedocs.io/en/latest/performance/)
- [Aokana: GPU-Driven Cell Rendering Framework (2025)](https://arxiv.org/html/2505.02017v1)
- [High-Performance Cell Rendering — Vulkan Guide](https://vkguide.dev/docs/ascendant/ascendant_geometry/)
- [Teardown Render Techniques Breakdown](https://zacxalot.github.io/rendering/9-teardown/)
- [How Beautiful Cells Laid the Way for Teardown — Game Developer](https://www.gamedeveloper.com/design/how-beautiful-cells-laid-the-way-for-i-teardown-s-i-heist-y-framework)
- [How Games Do Destruction — GMTK](https://gmtk.substack.com/p/how-games-do-destruction)
- [Multiplayer Cell Browser Game Engine — Kev Zettler](https://kevzettler.com/2023/04/25/multiplayer-cell-game-engine/)
- [Cell Terrain Storage — zeux.io](https://zeux.io/2017/03/27/cell-terrain-storage/)
- [Chunk Optimizations — Let's Make a Cell Engine](https://sites.google.com/site/letsmakeavoxelengine/home/chunk-optimizations)
