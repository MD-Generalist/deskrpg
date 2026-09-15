# Creative studio detail kits

Original DeskRPG geometry, abstract artwork and procedural PBR textures. Repository license applies;
no downloaded artwork, logos, photographs, external models, alpha-card plants or generated images.

## Rebuild and inspect

```sh
blender --background --factory-startup --python-exit-code 1 --python scripts/assets/build-creative-studio-kits.py
node scripts/assets/verify-creative-studio-kits.cjs /tmp/deskrpg-task5-visual
```

Blender 5.1.1; deterministic seed `140928`. The script writes only this environment directory and
can run from an isolated output root. The generated report measures actual GLB triangles, bytes,
world bounds and material names; invalid repaired meshes and budget overruns abort the build.
Isolated rebuilds reproduce these measurements. Equivalent Blender mesh ordering may change bytes.

All assets use meters, Y-up, front +Z and ground-center origin. Dressing has final surface heights
baked in: production/ideation/conference/workstation tops near 0.86m, coffee table near 0.49m,
pantry top 0.95m, shelf top 1.0575m. Do not add the table height again in the renderer.
The cyclorama floor is at 45mm, above the 35mm architectural oak slab; its continuous sweep joins
the floor to the vertical coral backdrop. The posing stool is decorative inside its solid footprint.

## Inventory

Photo kits include cyclorama/backdrop supports/posing stool, two instances of the softbox,
camera/tripod, reflector and open equipment shelf with cases and spare lenses. Softbox fabric is
emissive; reflector fabric is ordinary opaque cloth. These are noninteractive visual bodies for
existing authoritative collision objects. The reflector decoration fits inside the existing solid
cyclorama footprint.

Production/ideation kits add original varied editorial prints, stacked publications, color swatches,
cutting mat/grid, tablets, ruler, pens, cups, note cards and pins, material samples and rolled stock.
Pantry dressing includes an espresso machine, grinder, cups, bottles, fruit and a printed card.
Art-wall frames contain original geometric compositions. Workstation, conference and coffee-table
clusters reuse the same prop family within the approved zones.

Principal materials use embedded 512px WebP base-color, normal and roughness maps. The print atlas
has sixteen tiles with original geometric designs; generic rules are graphic marks, not borrowed text. Explicit
catalog slots include `paper`, `printed-paper`, `oak`, `painted-metal`, `coral`, `diffuser`, `ceramic`.
Uniform metal components use a scalar metallic factor. Every material is opaque.

## Task 6 integration

`creativeStudioKitFor(object)` selects the kit. `creativeStudioKitOwnsBody(id)` is true for photo
kits: skip the generic furniture body for these, including the equipment shelf. Other kits are
additive dressing and keep their shared Task 4 furniture bodies and seats.

`attachCreativeStudioKit(host, object, options)` creates its own child host, adds a meaningful
procedural fallback and calls the catalog loader. Success replaces only that child fallback;
failed loads retain it. Existing sibling furniture, seat metadata and disposal ownership survive.
Attach once per object during composition. Put shared furniture loading in a separate child too,
so its asynchronous replacement cannot remove the dressing sibling.

`creativeStudioDecorations()` supplies reflector and art-wall placement descriptors; all their
horizontal bounds stay inside already solid photo/perimeter cells. These are renderer-only extras,
not changes to authoritative layout JSON or collision. Do not turn them into ambient destinations.

The offline verifier assembles real kits beside furniture on the approved shell and records load
outcomes/screenshots. Production composition, v3 gating, desktop monitor facing toward adjacent
chairs, shared rugs/plants, runtime batching, actors and final performance acceptance belong to
Task 6. Its gallery's injected loads use their own readiness promises; renderer `assetsReady` is
not meaningful for that fixture.

## Integrated scene thumbnail

`agency-v5.webp` is an 874×450 reference-aligned preview for the version-5 director-suite scene using
`buildOfficeEnvironment('agency')` and the production overview camera. It contains
no character fixture and is displayed by the environment picker. Regenerate with
`node scripts/assets/verify-creative-studio-scene.cjs /tmp/studio-review --headed`,
then copy `/tmp/studio-review/agency-v5.webp` here. The script also supports
`--benchmark` (10s warmup + 30s orbit/walk with 12 real actors), `--review-ui`
(actual React review controls), and `--smoke` (headless load/overview).
`--generic-object --smoke` adds a collision-bearing legacy bookshelf to verify
edited legacy fallback rendering. `--review-ui` also exercises a real fractional floor
click and an in-flight movement retarget through the component's pointer handler.
