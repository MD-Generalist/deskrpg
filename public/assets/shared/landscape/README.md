# Shared landscape assets

Original DeskRPG assets, authored with Blender; no third-party downloads.
Distributed under the repository license. Authoring source:
`scripts/assets/build-shared-landscape.py`.

| ID          | Use                        | Ground footprint | Height limit |
| ----------- | -------------------------- | ---------------- | ------------ |
| ficus       | broad-leaf indoor planter  | 1 × 1 m          | 1.7 m        |
| olive       | narrow-leaf indoor planter | 1 × 1 m          | 1.7 m        |
| street-tree | branching avenue tree      | 3.6 × 3.6 m      | 4 m          |
| glass-tower | glass office tower         | 1.6 × 1.4 m      | 8 m          |
| stone-tower | stone office tower         | 1.6 × 1.4 m      | 7 m          |

Meters, Y-up, +Z front. The tree root flare extends up to 0.06m below ground.
Registry: `src/game/three/shared-scene-assets.ts`. Use `attachSceneAsset` for
scene-owned asynchronous loading and late-load disposal. Background buildings
receive light but do not cast oversized shadows into the playable office.

Leaves have curved pointed silhouettes and midrib relief with opaque geometry,
not spheres or alpha billboards. Planters have a real lip, recessed soil and
soil granules. Buildings have separate window panes, facade mullions, parapets,
and roof equipment. Window geometry is intentionally simple at background distance.

Geometry/size statistics are in build-report.json. Each asset must stay below
60,000 triangles and 2 MB; the shared asset tests enforce bounds and budgets.
Backdrop placement does not add navigation obstacles. Indoor placements retain
the original plant tile footprint. Catalogue registration makes the models
available to other maps; this change activates them in the executive environment.

Rebuild from the repository root:

```sh
blender --background --factory-startup --python-exit-code 1 --python scripts/assets/build-shared-landscape.py
```
