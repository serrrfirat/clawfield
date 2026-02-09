---
name: generate-map
description: >
  Use when the user asks to generate a map, create a map, design a battlefield,
  build a level, or mentions "generate map", "AI map", "map from description",
  "create level", "design map", or "new map layout". Also use when the user
  pastes a natural language description of a game map and expects a mapdef file
  to be generated. Invokable via /generate-map.
---

# Clawfield Map Generator

Generate `.mapdef.json` files for the Clawfield voxel battlefield game from
natural language descriptions using a **POI-driven design workflow**.

## How It Works

1. Read the component registry at `assets/components/registry.json`
2. Take the user's natural language description
3. Design POIs and districts first, then place components
4. Generate a valid `.mapdef.json` file
5. Write it to `assets/maps/_ai_generated.mapdef.json`

## Step-by-Step

### 1. Read Available Components

```
Read file: assets/components/registry.json
```

Components available (with approximate sizes):

**Buildings** (13 models) — use `terrainCarve: true`:
| ID | Approx Size (XxYxZ) | Use |
|----|---------------------|-----|
| `buildings/apartment_a/model_000` | 36x36x36 | Residential block |
| `buildings/apartment_b/model_000` | 36x35x36 | Residential block |
| `buildings/cafe/model_000` | 18x15x18 | Small commercial |
| `buildings/cinema/model_000` | 36x40x36 | Large landmark |
| `buildings/complex/model_000` | 72x54x72 | Major landmark (HUGE) |
| `buildings/house_a/model_000` | 18x15x18 | Small residential |
| `buildings/office_large_a/model_000` | 36x36x36 | Large office |
| `buildings/office_med_a/model_000` | 36x24x36 | Medium office |
| `buildings/office_med_b/model_000` | 36x24x36 | Medium office |
| `buildings/office_small_a/model_000` | 18x15x18 | Small office |
| `buildings/office_small_b/model_000` | 18x15x18 | Small office |
| `buildings/skyscraper_a/model_000` | 36x72x36 | Tall sniper tower |
| `buildings/tower_a/model_000` | 18x36x18 | Watchtower |

**Oasis props** (291 models: `oasis/model_000` through `oasis/model_290`) — walls, arches, ruins, vegetation. Use `terrainCarve: false`.

**Vehicles** (use `terrainCarve: false`, model_000 variants):
`vehicles/bus-big`, `vehicles/bus-small`, `vehicles/car-v1` through `v6`,
`vehicles/container`, `vehicles/emergency-ambulance-1`,
`vehicles/emergency-fire-engine-1`, `vehicles/emergency-police-1`,
`vehicles/racer-v1`, `vehicles/tractor`, `vehicles/truck-v1` through `v3`

### 2. Design the Map (POI-First Workflow)

**Do NOT scatter buildings randomly.** Follow this design process:

#### Step A: Define 3-5 Points of Interest (POIs)

POIs are the memorable landmarks that give the map identity. Each POI should:
- Have a **name** and **gameplay purpose** (overwatch, chokepoint, flank route, staging area)
- Occupy a **region** of the map (roughly 40x40 units)
- Be placed to create interesting **sightline relationships** with other POIs

Example POIs for a city map:
- "Central Plaza" at (0, 0) — open area with fountain/statue, capture point B
- "West Office District" at (-70, -40) — cluster of offices, capture point A
- "East Industrial Yard" at (70, 30) — containers and trucks, capture point C
- "North Overwatch" at (0, -75) — tall building or tower with long sightlines
- "South Market" at (0, 65) — small shops forming a covered flanking route

#### Step B: Build Districts Around POIs

Group buildings into coherent blocks:
- **Office district**: 2-3 office buildings + tower, tight streets (8-10 unit gaps)
- **Residential area**: apartments + houses, wider streets (10-12 unit gaps)
- **Industrial zone**: containers, trucks, warehouses (sparse, open)
- **Commercial strip**: cafe, cinema, small offices along a road

Buildings within a district should:
- Face the same street or form an L/U shape around a courtyard
- Have consistent spacing (pick 8, 10, or 12 units and stick with it)
- Leave clear pathways between them

#### Step C: Connect Districts with Three Lanes

Design three main routes between the Alpha (west, x ~ -100) and Bravo (east, x ~ 100) spawns:

1. **North lane** (z ~ -50 to -70): Could be an elevated ridge, sniper-friendly, less cover
2. **Center lane** (z ~ -10 to 10): Main road, most direct, highest intensity combat
3. **South lane** (z ~ 50 to 70): Flanking route through buildings, more CQB

Each lane should have:
- A distinct **character** (wide road vs narrow alleys vs open field)
- **Cross-connections** between lanes every ~40-60 units
- **Cover objects** every 10-15 units (vehicles, oasis props, walls)

#### Step D: Place Cover Chains

Ensure players can advance through each lane by hopping between cover:
- Place vehicles (cars, trucks) along roads every 10-15 units
- Use oasis props (walls, crates) in open areas
- Break long sightlines with perpendicular walls or parked buses
- **No corridor longer than ~25 units without cover**

### 3. Terrain Configuration

**CRITICAL: Set `waterLevel: -10` for urban/land maps.** Only use `waterLevel >= 0`
if the user specifically requests water features (rivers, canals, coastline).

The generic terrain generator produces gentle rolling hills:
- Heights range from ~1 to ~5 (centered at y=3)
- Seed-based variation: different seeds produce different hill patterns
- Edge drop-off at map borders
- All heights stay positive — no accidental water with `waterLevel: -10`

**Estimating Y position for placements:**
The generic heightmap formula is approximately:
```
h ≈ 3 + 1.5*sin(x/25 + s)*cos(z/20 + s*0.7) + smaller harmonics
```
where `s = seed * 0.1`. For most placements, use:
- Map center (x=0, z=0): **y ≈ 3**
- Near edges (|x| > 100 or |z| > 80): **y ≈ 1-2**
- Everywhere else: **y ≈ 2-4**

When in doubt, use **y = 3** with `terrainCarve: true` for buildings.

### 4. Generate the Mapdef JSON

The output must be a valid JSON file:

```jsonc
{
  "name": "Map Name",

  // World bounds — keep these standard
  "bounds": {
    "xMin": -130, "xMax": 130,
    "yMin": -4, "yMax": 32,
    "zMin": -110, "zMax": 110
  },

  "terrain": {
    "generator": "heightmap",
    "waterLevel": -10,    // USE -10 for urban maps (no water)
    "seed": 42            // integer, pick any value for variety
  },

  // Standard terrain palette — copy as-is
  "terrainPalette": {
    "SAND_LIGHT":    { "index": 1,  "r": 212, "g": 184, "b": 150 },
    "SAND_DARK":     { "index": 2,  "r": 196, "g": 166, "b": 122 },
    "GRASS":         { "index": 3,  "r": 90,  "g": 140, "b": 63  },
    "GRASS_DARK":    { "index": 4,  "r": 74,  "g": 122, "b": 51  },
    "DIRT":          { "index": 5,  "r": 122, "g": 92,  "b": 58  },
    "STONE":         { "index": 6,  "r": 136, "g": 136, "b": 136 },
    "STONE_DARK":    { "index": 7,  "r": 102, "g": 102, "b": 102 },
    "CONCRETE":      { "index": 8,  "r": 160, "g": 160, "b": 160 },
    "CONCRETE_DARK": { "index": 9,  "r": 128, "g": 128, "b": 128 },
    "WOOD":          { "index": 10, "r": 139, "g": 105, "b": 20  },
    "WOOD_DARK":     { "index": 11, "r": 107, "g": 79,  "b": 16  },
    "BRICK":         { "index": 12, "r": 160, "g": 82,  "b": 45  },
    "ROOF_TILE":     { "index": 13, "r": 139, "g": 69,  "b": 19  },
    "WATER":         { "index": 14, "r": 34,  "g": 102, "b": 170 },
    "WATER_DEEP":    { "index": 15, "r": 26,  "g": 76,  "b": 128 },
    "ROAD":          { "index": 16, "r": 85,  "g": 85,  "b": 85  },
    "WINDOW":        { "index": 17, "r": 135, "g": 206, "b": 235 },
    "METAL":         { "index": 18, "r": 112, "g": 128, "b": 144 }
  },

  "placements": [
    // Buildings — use terrainCarve: true
    {
      "componentId": "buildings/cinema/model_000",
      "position": { "x": -30, "y": 3, "z": -40 },
      "rotation": 0,
      "terrainCarve": true
    },
    // Vehicles/props — use terrainCarve: false
    {
      "componentId": "vehicles/car-v1/model_000",
      "position": { "x": -15, "y": 3, "z": 0 },
      "rotation": 90,
      "terrainCarve": false
    }
    // ... more placements
  ],

  "metadata": {
    "spawnPoints": {
      "alpha": [            // West side, x ~ -100 to -90
        { "x": -100, "y": 2, "z": -20 },
        { "x": -100, "y": 2, "z": 0 },
        { "x": -100, "y": 2, "z": 20 },
        { "x": -95, "y": 2, "z": -40 }
      ],
      "bravo": [            // East side, x ~ 90 to 100
        { "x": 100, "y": 3, "z": -20 },
        { "x": 100, "y": 3, "z": 0 },
        { "x": 100, "y": 3, "z": 20 },
        { "x": 95, "y": 3, "z": 40 }
      ]
    },
    "capturePoints": [      // Place at POI centers
      { "id": "A", "position": { "x": -55, "y": 3, "z": 0 }, "initialOwner": 0 },
      { "id": "B", "position": { "x": 0, "y": 3, "z": 0 }, "initialOwner": -1 },
      { "id": "C", "position": { "x": 55, "y": 3, "z": 0 }, "initialOwner": 1 }
    ],
    "objectives": []
  }
}
```

### 5. Placement Rules

- **Check component dimensions** from the registry. Don't overlap buildings.
- **Y position**: Use y=2-4 based on location (see terrain section above).
  With `terrainCarve: true`, exact Y is forgiving — terrain will be carved flat.
- **Rotation**: 0, 90, 180, or 270 only.
- **Spacing**: 8-12 units between buildings for streets. At least 5 units for alleys.
- **Balance**: Roughly mirror layout across the X axis (Alpha side vs Bravo side).
  The center should be contested ground.
- **Large buildings** (complex, cinema, skyscraper) work best as **POI anchors**.
- **Small buildings** (cafe, house, small offices) fill in district edges.
- **Vehicles** go along roads and in parking areas. Mix types for visual variety.

### 6. Sightline Management

- **No infinite straight corridors**: Break every corridor with a perpendicular
  building, parked bus, or wall prop after ~25 units.
- **Overwatch positions** (skyscrapers, towers) should have **counter-play**:
  place flanking routes that bypass the sightline.
- **Use L-shaped and T-shaped intersections**, not 4-way crosses (too many angles to check).
- **Central capture points** should have cover but not be fully enclosed.

### 7. Spatial Relationship Language

When designing, think in spatial relationships:
- "South of capture point B, forming a courtyard entrance"
- "Flanking the central plaza from the northwest corner"
- "Along the main east-west road at the intersection with the north alley"
- "Backing onto the industrial yard, creating a wall for the south lane"

This produces coherent layouts instead of random coordinate scatter.

### 8. Write Output

Write the generated mapdef to:
```
assets/maps/_ai_generated.mapdef.json
```

After writing, tell the user:
- The map has been generated
- They can load it in the editor via **Open** button or at
  `http://localhost:5173/editor.html`
- They can rebuild the compiled map with:
  `npx tsx tools/map-compose.ts assets/maps/_ai_generated.mapdef.json`

### 9. Checklist Before Writing

Verify your mapdef meets these criteria:
- [ ] `waterLevel: -10` (unless user requested water features)
- [ ] Map name is NOT "Shoreline" (that's the built-in map)
- [ ] 3-5 capture points placed at POI locations
- [ ] 3-4 spawn points per team, ~80-100 units from enemy spawns
- [ ] No two buildings overlap (check positions + dimensions)
- [ ] Cover objects every 10-15 units along each lane
- [ ] No sightline longer than ~25 units without interruption
- [ ] Buildings form coherent districts, not random scatter
- [ ] At least 15 vehicle placements for road cover
- [ ] Three distinct routes between spawns
