## Stylized Water Vendor Module

- Upstream repository: `https://github.com/thaslle/stylized-water`
- Vendored commit: `76a335f75dcccac0785ce9d84c914328bd3a1ea0`
- Vendored snapshot path: `apps/client/vendor/stylized-water`

### Guarantee

- The upstream repository snapshot is copied as-is under `apps/client/vendor/stylized-water`.
- No edits were made to upstream water shader files.

### Modular usage

- Runtime adapter component: `apps/client/src/world/StylizedWaterPlane.tsx`
- Runtime world integration: `apps/client/src/world/Terrain.tsx`
- Map editor integration: `apps/client/src/editor/EditorTerrain.tsx`
- The adapter imports the upstream water shaders directly from the vendored path; shader files remain unmodified.
