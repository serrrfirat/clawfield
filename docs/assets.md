# Free Voxel Assets

Curated list of free voxel assets compatible with Clawfield's pipeline (`.vox` → chunked `.map`).

## Texture Packs (for voxel atlas)

### Kenney Voxel Pack
- **URL**: https://www.kenney.nl/assets/voxel-pack
- **License**: CC0 (public domain) — no attribution required, commercial use OK
- **Contents**: 190 assets — terrain tiles (grass, dirt, sand, stone, brick, snow, gravel), items, characters, skybox, particles, sun/moon
- **Format**: PNG (individual tiles + spritesheet)
- **Use case**: Texture atlas for voxel materials — replaces flat vertex colors with textured block faces

### ProgrammerArt
- **URL**: https://github.com/deathcap/ProgrammerArt
- **License**: Free for any use
- **Contents**: Original textures designed for voxel/block games — terrain, ores, wood, leaves, water
- **Format**: PNG (individual tiles)
- **Use case**: Alternative/supplementary terrain textures

## 3D Models & Props (`.vox` format)

### Gorlaks Voxel Assets
- **URL**: https://gorlaks.itch.io/voxel-assets
- **License**: Free
- **Contents**: Miscellaneous props and environment pieces made in MagicaVoxel
- **Format**: `.vox` (direct pipeline compatibility)
- **Use case**: Map decoration — drop into MagicaVoxel scenes before converting

### Enkisoftware Voxel Models
- **URL**: https://github.com/enkisoftware/voxel-models
- **License**: CC BY 4.0 (some CC0 from MountainLabs)
- **Contents**: Buildings, environment props, trees
- **Format**: `.vox`
- **Use case**: Map decoration, buildings, environmental variety

## Weapons & Items

### Miventech Voxel Weapon Pack
- **URL**: https://miventech.itch.io/voxel-weapon-pack
- **License**: Free
- **Contents**: Multiple weapon models, editable in MagicaVoxel
- **Format**: `.vox`, OBJ, FBX
- **Use case**: First-person weapon viewmodels (requires separate Three.js model loader)

### itch.io Free Voxel Weapons
- **URL**: https://itch.io/game-assets/free/tag-voxel/tag-weapons
- **License**: Varies per asset
- **Contents**: Various voxel weapon models (guns, RPG, fantasy)
- **Use case**: Browse for FPS-relevant weapon models

## Vehicles & Military

### itch.io Free Voxel Assets (Military)
- **URL**: https://itch.io/game-assets/free/tag-voxel
- **License**: Varies per asset
- **Contents**: Tanks, APCs, military vehicles (6 vehicles, 3 textures each in some packs)
- **Use case**: Map decoration or future drivable vehicles

## Browse More

- **itch.io Voxel Assets**: https://itch.io/game-assets/free/tag-voxel
- **itch.io MagicaVoxel Assets**: https://itch.io/game-assets/free/tag-magicavoxel
- **OpenGameArt Voxel**: https://opengameart.org/art-search-advanced?keys=voxel

## Pipeline Notes

Assets in `.vox` format can be placed into MagicaVoxel scenes and baked into maps via the existing pipeline:
```
.vox → vox-converter.ts → .chunks.json + .palette.json → map-packer.ts → .map
```

For standalone 3D models (weapon viewmodels, vehicle entities), a separate Three.js model loader would be needed — that's not yet implemented.

For texture atlas, PNG tile assets get packed into a single atlas image and mapped to material IDs via UV coordinates in the mesher.
