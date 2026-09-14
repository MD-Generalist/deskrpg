# Shared studio architecture

Original DeskRPG assets, authored by `scripts/assets/build-creative-studio-architecture.py`. No external models or textures; repository-original license. Blender 5.1.1, deterministic seed 140926.

Rebuild from repository root:

```sh
blender --background --factory-startup --python-exit-code 1 --python scripts/assets/build-creative-studio-architecture.py
```

Nine versioned GLBs provide a 3×2m oak floor module, 2×3.6m brick and plaster panels, a 4×2.5m grid window, a 2×3.6m partition, a glass corner, a single door, a low cutaway double entrance, and a 3m timber plinth. Exports use meters, +Y up, +Z front, ground-center origins. Snap by catalog bounds, not visual mesh centers. The corner footprint is centered after authoring.

Oak, brick and plaster use embedded 1024×1024 WebP color, tangent-normal and roughness textures. The same encoded images are emitted separately to `../surfaces/` for continuous runtime surfaces. Color is sRGB; normal and roughness are linear. Roughness images are glTF metallic/roughness packed images (Three reads the green channel). Periodic texture fields and periodic normal derivatives avoid boundary discontinuities. Runtime shell modules reproject UVs in meters after their placement/scaling: oak repeat 3×2m, brick/plaster repeat 2×2m. This preserves brick course height across low sill and full-height pier variants.

`build-report.json` records measured exported triangles, file bytes, world bounds, source, seed and mesh validation. Every model is below 12,000 triangles and 2MB; ordinary panel/plinth geometry is 188 triangles. Beveled steel frame members, sill, handles, threshold and transparent glass are model-owned. Glass uses alpha blending, is marked non-shadow-casting in the catalog, and gets depthWrite=false at attachment.

`creative-studio-architecture.ts` owns composition and procedural fallbacks. It waits for GLB loads, shares identical explicitly declared material slots within its own disposable shell, then batches opaque meshes and only coplanar glass. It retains the catalog's independent source-cache/host lifetime contract. The shell stays isolated from outer batches. A failed GLB keeps the fallback; unavailable maps keep scalar materials/grain. No source model is mutated.

The default adapter targets only agency v3 at 42×26. Edited/unmigrated v2 maps use the legacy renderer. The entrance reads the layout's authoritative column range. Meeting and photo partitions follow authoritative collision tiles. The reconciled meeting boundary includes the front row and rear connection, while the two-tile west opening remains unobstructed. The full door leaf folds 180 degrees back inside the west wall collision tiles, separated from the fixed glazing by its hinge offset.

Studio shadows use Three.js's supported 17-tap `PCFShadowMap` kernel with radius 3; legacy environments retain `PCFSoftShadowMap`. The latter ignores radius in Three 0.180. Changing filter invalidates retained actor materials so their shader defines follow map switches. Both paths keep percentage-closer filtered shadows and the existing single directional shadow map. Reproduce loaded shell and pixel-edge verification with:

```sh
node scripts/assets/verify-creative-studio-architecture.cjs /tmp/deskrpg-studio-visual
```

The headless probe uses actual OfficeRenderer/assets, captures corner/meeting/full views, and asserts that wider filtering both changes scene pixels and widens a controlled 10–90% shadow transition. It is not a staging FPS benchmark.

Acceptance in this task: generated file/bounds/triangle budgets, fallback bounds, material channels, late loads, camera frustum, legacy gate, and loaded shell batching. Final furnished screenshots, floor window reflections and visible-browser frame-time/transfer measurements belong to integration/staging verification; PBR/PMREM alone does not establish a mirrored window image on the floor.
