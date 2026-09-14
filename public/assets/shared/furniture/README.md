# Shared studio furniture

Original DeskRPG geometry and procedural PBR textures, authored with Blender 5.1.1.
Repository license applies; no downloaded models, stock textures, or image-generation service is used.

## Rebuild

From the repository root:

```sh
blender --background --factory-startup --python-exit-code 1 --python scripts/assets/build-shared-studio-furniture.py
node scripts/assets/verify-shared-studio-furniture.cjs /tmp/deskrpg-task4-visual
```

The deterministic seed is `140927`. Every model is in meters, Y-up, ground-center origin, front +Z.
Baked transforms keep rotated curved-sofa modules inside their 3×1 tile footprint. Rounded edges,
weighted normals, distinct cushion seams, caster/footrest hardware, cabinet reveals and joinery
remain visible at close range. The script rejects repaired invalid meshes and budget overruns.
`build-report.json` records actual exported bounds, triangles, byte sizes and material slots.
An isolated rebuild reproduces these measurements; Blender may reorder equivalent mesh data.

## Inventory and materials

Seventeen silhouettes cover workstation, office chair, side chair, round table, production table,
curved sofa, straight sofa, armchair, stool, credenza, low shelf, mobile board, round rug, woven rug,
pantry counter, conference table and coffee table. Furniture surfaces remain undressed so environment
kits can add equipment without duplicating interactive geometry. Low-shelf books are part of the
reusable shelf silhouette. Rugs are decoration adapters, not new navigation object types.

Oak and cloth use embedded 512px WebP base-color, normal and roughness textures with world-scaled UVs.
Catalog slots identify `oak`, `upholstery`, `painted-metal` explicitly. Side chairs retain the explicit
`Cream linen` upholstery slot for catalog API compatibility. Off-white, teal, coral, mustard and
neutral variants tint upholstery only; wood, hardware and textures are preserved.

## Integration contract

`scene-asset-definitions.ts` is the pure metadata authority. It contains no Three or GLTFLoader
runtime dependency and is imported by server seating/projection. `scene-asset-catalog.ts` re-exports
this API and owns loading/caching/cloning. It is browser-facing.

Use `studioFurnitureAsset(object)` to select an asset/variant, `buildStudioFurnitureFallback` for a
scene-owned fallback, and `attachSceneAsset` on that host to replace the fallback asynchronously.
Tagged studio chairs and armchairs opt in; untagged legacy and executive objects retain their paths.
The verifier assembles the real assets on the approved shell; production renderer wiring is Task 6.

`assetSeats` rotates integer local tile anchors exactly on cardinal axes. `Seat.anchorX/anchorZ`
remain navigation tile centers; `Seat.x/z` are the separate visual actor pose. Catalog `visual[1]`
is physical seat height, while `actorElevation` is the actor-root lift for the supplied sitting clip:
chairs 0, sofas/armchairs 0.055m, stools 0.24m. Never apply the physical height as a second root lift.
Render chairs at `resolveSeat` x/z/direction; use `attachFurnitureSeats` for shared picking metadata.
The v3 layout exposes 38 anchors, including nine sofa/stool anchors, and 34 common destinations.
