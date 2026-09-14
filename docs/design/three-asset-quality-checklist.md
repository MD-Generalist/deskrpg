# Shared Three asset acceptance checklist

Use this checklist for each new asset set and again for the integrated scene. Keep the source script, seed, catalog entry, build report and browser captures together. A procedural fallback is a loading/error state, not final visual acceptance.

## Authored asset and catalog

- [ ] Stable asset ID and versioned public URL; approved source script/license; valid fallback ID, category, destination tags, material slots and allowed variants.
- [ ] Coordinates: meters, Y-up, +Z front, ground-center origin. Catalog world AABB contains measured GLB bounds within 0.001m. Logical footprints and seat anchors use integer tiles; visual offsets never change navigation/persistence anchors.
- [ ] No invalid normals, NaNs, hidden construction geometry, unintended transparent materials or loose temporary export meshes. Record exceptions explicitly.
- [ ] Ordinary props <3,000 triangles, common furniture <12,000, heroes <30,000; individual GLBs normally <2,000,000 bytes. Any approved exception is named in catalog and generated report with a reason. Actual triangles/bytes and source/seed are present in each build report and match shipped files.
- [ ] Every generated GLB is registered and covered by its build report. Reports, textures and versioned thumbnails remain in `public`; Docker/npm contain the complete shared runtime directory and every catalog URL.

## PBR surfaces and color

- [ ] Principal oak, brick, plaster and fabric surfaces have base color, normal and roughness maps. Ordinary texture resolution is 512–1024px; hero/large surfaces may use up to 2048px. Metallic maps are only needed for mixed metal/nonmetal regions.
- [ ] Base color uses sRGB; normal and roughness data remain linear. Inspect normal strength and UV scale at close range; adjacent oak/brick modules have continuous texture density and no visible seam/stretch.
- [ ] ACES Filmic tone mapping and sRGB output remain enabled. Pale oak stays neutral, faces stay readable, and coral/teal/mustard highlights do not clip. Compare overview and close-ups at the same exposure.
- [ ] Named material variants affect only the attached instance. Deep-cloned disposable resources cannot dispose or recolor another instance/source cache. Repeated textures are shared only through an explicit ownership policy.

## Reflections, glazing and shadows

- [ ] PMREM environment is present and disposed with its owner. The creative studio uses a one-time 128px local probe from the loaded scene; document that this is a static approximate reflection, not a planar mirror or moving-actor reflection.
- [ ] Floor reflection is broad and faint. Capture an identical production/floor view with reflection on/off to prove a visible controlled difference; bright window sheen must not obscure oak grain. Glass and metal reflect; fabric, brick and unfinished wood remain diffuse.
- [ ] Glazing has the intended alpha/depth policy at adjacent corners and does not cast opaque shadows. Inspect overlapping panes through orbit, not only the reference camera.
- [ ] PCF soft shadows remain enabled. Furniture/plants cast and receive soft contact shadows; inspect chair legs, table feet, leaf edges and wall/window transitions for acne, striping, peter-panning or excessive hardness. Record residual patterned transitions instead of declaring them fixed from material settings alone.

## Integrated geometry, seats and interaction

- [ ] Reference overview includes the highest furniture, external cutaway edges and all eight zones at 1748×900 CSS pixels. Record DPR, camera, exposure and browser/GPU. Compare relative zone placement, density and palette against the approved reference.
- [ ] Capture photo bay, production, main lounge, meeting and pantry, plus window/brick seams, glass corners and plant leaves. Inspect leg/cushion/table intersections for chair, sofa, armchair, conference and stool poses.
- [ ] Production body-clear routes connect the entrance, photo, workstations, production, pantry and meeting room. Primary aisles are at least two logical tiles; entrance/aisles are not ambient stops. All 38 studio seat anchors are reachable and reversible.
- [ ] Exercise native orbit, pan and zoom; fixed-seat departure/return, temporary seating, refresh persistence and at least two simultaneous NPC walkers. Do the server reservation/persistence cases in the authenticated staging application; isolated renderer fixtures do not prove those contracts.
- [ ] Cold load, failed load/retry, scene disposal during pending load and repeated attach/dispose preserve visible fallbacks and do not attach late models or leak resources. No console/page errors or failed runtime asset requests.

## Measured scene budgets

- [ ] After assets settle: ≤1,200,000 main-pass triangles and ≤350 main-pass draw calls in overview and orbit/walk maxima. Report Three `renderer.info` counter semantics; shadow cost must remain represented by measured frame time.
- [ ] Initial compressed transfer for creative-studio and newly shared scene assets <25,000,000 bytes. Record unique URLs and measured compressed bytes separately from total npm package size and character downloads.
- [ ] Reference desktop Chrome/Comet: 10s warmup, then 30s continuous orbit/walk with 10 NPC and 2 player fixtures, labels and speech visible. Median FPS ≥55 and p95 frame time <25ms. Record hardware, GPU backend, browser version, viewport/DPR, frame count and raw timing samples.
- [ ] Software/headless rendering, background throttling or missing reference hardware is recorded as an invalid/incomplete performance acceptance sample. Do not silently waive a threshold or substitute the earlier Task 6 result for the deployment build.

## Evidence and regression

- [ ] Store overview, zone close-ups, orbit/pan/zoom, movement, seated arrival, reflection on/off, report JSON and benchmark JSON under a dated private evidence directory. The reusable public thumbnail must come from the same builder/renderer/camera.
- [ ] Executive, publishing, trading and tech retain their prior dimensions, seats, policies and assets; edited/legacy agency keeps its supported fallback path.
- [ ] Record visual limits: approved layout/reference coordinate-density mismatch, approximate reflections, bounds-based label occlusion and any remaining pantry/rug/shadow polish. Passing numeric budgets does not establish reference-identical appearance.
- [ ] Follow `docs/creative-studio-map-upgrade.md` and the predeploy checklist before enabling lazy map upgrades. Backup/config, exact-map protection and non-map preservation are separate deployment gates.
