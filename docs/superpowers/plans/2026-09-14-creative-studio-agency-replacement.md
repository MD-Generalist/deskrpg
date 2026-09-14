# Creative Studio Agency Replacement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the built-in `agency` environment with a 42×26 high-fidelity creative studio matching the supplied reference while preserving gameplay, channel data, and reusable asset boundaries.

**Architecture:** A deterministic layout module emits tile-space furniture, zones, and metadata. A typed scene-asset catalog owns reusable GLBs, surfaces, seats, variants, fallbacks, and quality budgets; environment-specific adapters assemble those assets without leaking studio coordinates into navigation or ambient schedulers. Exact official v2 agency maps are lazily upgraded with optimistic concurrency, while edited maps remain untouched.

**Tech Stack:** TypeScript, Three.js 0.180, React/Next.js 16, Tiled JSON, node:test/tsx, Blender 5.1 Python asset generators, GLB 2.0 with embedded WebP PBR textures, Drizzle ORM, PostgreSQL/SQLite, Playwright/Comet staging verification.

**Spec:** `docs/superpowers/specs/2026-09-14-creative-studio-agency-replacement-design.md`

## Global Constraints

- Keep the environment ID `agency`; rename its labels to “크리에이티브 스튜디오” and “Creative studio.”
- The replacement map is exactly 42×26 logical tiles with a centered entrance and at least two clear tiles along primary circulation routes.
- Preserve channel ID, users, memberships, NPC/profile assignments, chats, gateway configuration, and all non-map fields.
- Migrate only an exact previous official agency snapshot; never overwrite edited map data.
- Principal surfaces use base-color, normal, and roughness maps; retain ACES, sRGB, PMREM, and PCF soft shadows.
- Ordinary props stay below 3,000 triangles, common furniture below 12,000, hero assets below 30,000, and individual GLBs normally below 2 MB.
- Default full-map view targets at most 1.2 million triangles, 350 draw calls, and 25 MB initial compressed scene transfer.
- Staging target is median ≥55 FPS and p95 frame time <25 ms over a 30-second orbit-and-walk sample.
- Renderer offsets never alter authoritative navigation coordinates.
- No map editor, character production, prop physics, or production release is included.

---

### Task 1: Typed Scene Asset Catalog and Cached Loading

**Files:**
- Create: `src/game/three/scene-asset-catalog.ts`
- Create: `src/game/three/scene-asset-catalog.test.ts`
- Modify: `src/game/three/shared-scene-assets.ts`
- Modify: `src/game/three/furniture-asset.ts`
- Modify: `src/game/three/furniture-asset.test.ts`

**Interfaces:**
- Consumes: existing `disposeTree()`, `GLTFLoader`, executive asset URLs, and shared landscape URLs.
- Produces: `SceneAssetId`, `SceneAssetDefinition`, `SCENE_ASSETS`, `sceneAsset(id)`, and `attachSceneAsset(host, id, options?)` for all later tasks.

- [ ] **Step 1: Write failing catalog contract tests**

```ts
test("every asset has a versioned URL, footprint, fallback and budget", () => {
  for (const [id, asset] of Object.entries(SCENE_ASSETS)) {
    assert.match(asset.url, /-v\d+\.glb$/);
    assert.ok(asset.footprint[0] > 0 && asset.footprint[1] > 0, id);
    assert.ok(asset.fallback, id);
    assert.ok(asset.budget.maxBytes <= 2_000_000 || asset.budget.exception, id);
  }
});

test("seat variants declare navigation and visual transforms separately", () => {
  const chair = sceneAsset("shared-side-chair");
  assert.deepEqual(chair.seats?.[0].anchor, [0, 0.5]);
  assert.equal(chair.seats?.[0].visual.length, 3);
});
```

- [ ] **Step 2: Run tests and verify missing catalog symbols fail**

Run: `npx tsx --test src/game/three/scene-asset-catalog.test.ts`

Expected: FAIL because `scene-asset-catalog.ts` does not exist.

- [ ] **Step 3: Define the catalog types and register existing assets**

```ts
export type SceneAssetDefinition = {
  url: string;
  category: "architecture" | "furniture" | "decor" | "landscape" | "kit";
  tags: readonly string[];
  footprint: readonly [number, number];
  maxHeight: number;
  fallback: string;
  variants?: Readonly<Record<string, Readonly<Record<string, string>>>>;
  seats?: readonly { anchor: readonly [number, number]; visual: readonly [number, number, number]; direction: "up" | "down" | "left" | "right" }[];
  shadows: { cast: boolean; receive: boolean };
  batch: "none" | "static" | "instance";
  lod: "hero" | "standard" | "small";
  budget: { maxTriangles: number; maxBytes: number; exception?: string };
  source: string;
};

export const SCENE_ASSETS = {
  "shared-ficus": SHARED_FICUS_DEFINITION,
  "shared-olive": SHARED_OLIVE_DEFINITION,
  "executive-desk": EXECUTIVE_DESK_DEFINITION,
} as const satisfies Record<string, SceneAssetDefinition>;
export type SceneAssetId = keyof typeof SCENE_ASSETS;
export function sceneAsset(id: SceneAssetId): SceneAssetDefinition { return SCENE_ASSETS[id]; }
```

Move existing executive and landscape URL resolution behind this catalog while keeping compatibility exports in `shared-scene-assets.ts` until all callers migrate.

- [ ] **Step 4: Add cached source loading with cloned instances**

Implement one Promise cache per URL. Cache the loaded source scene, clone per host, and keep each host responsible only for its clone. Apply catalog shadow policy, anisotropy, environment intensity, normal scale, explicit material variant maps, and late-load cancellation. Failed loads retain the procedural fallback.

- [ ] **Step 5: Test cache, clone ownership, variants, failure and disposal**

```ts
assert.equal(loadCalls, 1);
assert.notEqual(first.children[0], second.children[0]);
assert.equal(await attachSceneAsset(disposedHost, "ficus", { load }), false);
assert.equal(failedHost.userData.assetStatus, "failed");
```

Run: `npx tsx --test src/game/three/scene-asset-catalog.test.ts src/game/three/furniture-asset.test.ts src/game/three/static-batching.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit the catalog foundation**

```bash
git add src/game/three/scene-asset-catalog.ts src/game/three/scene-asset-catalog.test.ts src/game/three/shared-scene-assets.ts src/game/three/furniture-asset.ts src/game/three/furniture-asset.test.ts
git commit -m "refactor(ui2): add reusable typed scene asset catalog"
```

### Task 2: Creative Studio Layout and Behavior Contract

**Files:**
- Create: `src/game/three/creative-studio-layout.ts`
- Create: `src/game/three/creative-studio-layout.test.ts`
- Modify: `src/game/three/office-environments.ts`
- Modify: `src/game/three/office-environments.test.ts`
- Modify: `src/game/three/office-room-layout.ts`
- Modify: `src/game/three/office-room-layout.test.ts`
- Modify: `src/components/map-editor/hooks/useMapEditor.ts`
- Modify: `src/lib/tiled-geometry.ts`
- Modify: `src/game/ambient-zones.ts`
- Modify: `src/game/ambient-zones.test.ts`
- Modify: `src/lib/object-types.ts`

**Interfaces:**
- Consumes: `TiledObject`, `MapObject`, `getObjectDimensions()`, `furnitureSeats()`, and `readAmbientZones()`.
- Produces: `CREATIVE_STUDIO_SIZE`, `CREATIVE_STUDIO_ZONES`, `furnishCreativeStudio(add)`, `StudioZone`, and optional `destinationTags`/`access` in ambient metadata.

- [ ] **Step 1: Write failing tests for exact size, zones, circulation and seats**

```ts
test("agency is the deterministic 42x26 creative studio", () => {
  const map = buildOfficeEnvironment("agency");
  assert.equal(map.width, 42);
  assert.equal(map.height, 26);
  assert.equal(map.layers.find(l => l.name === "Objects")?.properties?.find(p => p.name === "officeEnvironmentVersion")?.value, 3);
  assert.deepEqual(CREATIVE_STUDIO_ZONES.map(z => z.id), ["photo", "workstations", "ideation", "main-lounge", "production", "meeting", "pantry", "small-lounge"]);
});
```

Add assertions that the centered entrance tiles are unblocked, all empty tiles connect, all seats are reachable, primary aisle sample lines retain two clear tiles, and furniture footprints do not overlap.

- [ ] **Step 2: Run the focused tests and observe 30×22 failures**

Run: `npx tsx --test src/game/three/creative-studio-layout.test.ts src/game/three/office-environments.test.ts src/game/three/office-room-layout.test.ts src/game/ambient-zones.test.ts`

Expected: FAIL on dimensions, absent zones, and missing object types.

- [ ] **Step 3: Define layout records and environment-specific dimensions**

```ts
export const CREATIVE_STUDIO_SIZE = { cols: 42, rows: 26 } as const;
export type StudioZone = AmbientZone & {
  access: "ambient" | "purpose-only";
  destinationTags: readonly string[];
};
export const CREATIVE_STUDIO_ZONES: readonly StudioZone[] = [
  { id: "photo", x: 1, y: 2, width: 9, height: 9, roaming: false, access: "purpose-only", destinationTags: ["photo"] },
  { id: "workstations", x: 11, y: 2, width: 13, height: 7, roaming: true, access: "ambient", destinationTags: ["work", "desk"] },
  { id: "ideation", x: 10, y: 9, width: 10, height: 8, roaming: true, access: "ambient", destinationTags: ["ideation", "collaboration"] },
  { id: "main-lounge", x: 22, y: 7, width: 10, height: 8, roaming: true, access: "ambient", destinationTags: ["lounge", "sofa"] },
  { id: "production", x: 16, y: 16, width: 14, height: 8, roaming: true, access: "ambient", destinationTags: ["production", "worktable"] },
  { id: "meeting", x: 32, y: 2, width: 10, height: 9, roaming: false, access: "purpose-only", destinationTags: ["meeting"] },
  { id: "pantry", x: 32, y: 11, width: 10, height: 8, roaming: true, access: "ambient", destinationTags: ["pantry", "stool"] },
  { id: "small-lounge", x: 32, y: 19, width: 10, height: 7, roaming: true, access: "ambient", destinationTags: ["lounge", "sofa"] },
];
```

Change `buildOfficeEnvironment()` to choose 42×26 only for `agency`, 18×18 for `executive`, and 30×22 otherwise. Route `agency` directly to `furnishCreativeStudio()` rather than the generic three-room suite.

- [ ] **Step 4: Add object types required for collision and seating**

Register stable types for `studio_worktable`, `studio_round_table`, `studio_sofa`, `studio_stool`, `studio_shelf`, `studio_counter`, `photo_cyclorama`, `photo_camera`, `photo_light`, `mobile_board`, and `glass_partition`. Give each a tested footprint and collision policy; keep visual variants in Tiled properties.

- [ ] **Step 5: Extend ambient metadata without breaking old maps**

```ts
export type AmbientZone = {
  id: string; x: number; y: number; width: number; height: number; roaming: boolean;
  access?: "ambient" | "purpose-only";
  destinationTags?: readonly string[];
};
```

Treat absent fields as the current behavior. Random ambient selection rejects `roaming:false`; explicit destination actions may select a matching purpose-only zone.

- [ ] **Step 6: Implement the approved object placement**

Place the eight zones, rear perimeter, central double entrance, workstation island, production table, lounge furniture, meeting enclosure, pantry, low dividers, and reference shelves. Keep two-tile primary aisles and attach seat/destination variants as object properties.

- [ ] **Step 7: Run geometry, navigation, seating and server projection tests**

Run: `npx tsx --test src/game/three/creative-studio-layout.test.ts src/game/three/office-environments.test.ts src/game/three/office-room-layout.test.ts src/game/ambient-zones.test.ts src/server/channel-motion-layout.test.ts src/game/three/seating.test.ts`

Expected: PASS.

- [ ] **Step 8: Commit the layout contract**

```bash
git add src/game/three/creative-studio-layout.ts src/game/three/creative-studio-layout.test.ts src/game/three/office-environments.ts src/game/three/office-environments.test.ts src/game/three/office-room-layout.ts src/game/three/office-room-layout.test.ts src/components/map-editor/hooks/useMapEditor.ts src/lib/tiled-geometry.ts src/game/ambient-zones.ts src/game/ambient-zones.test.ts src/lib/object-types.ts
git commit -m "feat(ui2): replace agency layout with creative studio contract"
```

### Task 3: PBR Architecture, Surfaces, Camera and Lighting

**Files:**
- Create: `scripts/assets/build-creative-studio-architecture.py`
- Create: `public/assets/shared/architecture/README.md`
- Create: `public/assets/shared/architecture/build-report.json`
- Create: `public/assets/shared/architecture/*.glb`
- Create: `public/assets/shared/surfaces/{oak,brick,plaster}-*.webp`
- Create: `src/game/three/creative-studio-architecture.ts`
- Create: `src/game/three/creative-studio-architecture.test.ts`
- Modify: `src/game/three/scene-asset-catalog.ts`
- Modify: `src/game/three/office-renderer.ts`
- Modify: `src/game/three/office-lighting.ts`
- Modify: `src/game/three/office-lighting.test.ts`
- Modify: `src/game/three/office-finishes.ts`

**Interfaces:**
- Consumes: `SCENE_ASSETS`, `attachSceneAsset()`, `surfaceTexture()`, `batchCoplanarGlass()`, `officeLighting()`.
- Produces: `addCreativeStudioArchitecture(root, cols, rows)`, shared architecture GLBs, and the warm agency lighting profile.

- [ ] **Step 1: Write failing architecture and lighting tests**

Assert registered oak, brick, plaster, grid-window, glass-partition, glass-door, and cutaway-plinth assets; agency exposure and warm sun values; glass `cast:false`; PBR map color spaces; and architecture bounds matching 42×26.

- [ ] **Step 2: Run the tests and verify missing architecture fails**

Run: `npx tsx --test src/game/three/creative-studio-architecture.test.ts src/game/three/office-lighting.test.ts src/game/three/scene-asset-catalog.test.ts`

Expected: FAIL on missing assets and builder.

- [ ] **Step 3: Author reusable architecture and PBR surfaces in Blender**

Generate modular steel-grid windows, glass partitions/corners/doors, brick panels, plaster panels, timber plinth, and double entrance. Generate seamless oak, brick, and plaster base-color/normal/roughness textures with deterministic seeds. Export meters, Y-up, +Z front, embedded WebP where the surface is model-owned, and record byte/triangle/bounds metrics.

- [ ] **Step 4: Assemble the studio shell**

Implement rear/left windows, alternating rear brick piers, right meeting-room glass, pantry coral feature wall, photo-bay boundary, continuous cutaway edge, and centered double entrance. Batch only coplanar glazing and static opaque modules.

- [ ] **Step 5: Add reference camera and agency lighting profile**

Add environment-specific overview framing rather than changing the global camera behavior. Keep orbit/pan/zoom. Set a warm broad sun, soft fill, hemisphere light, exposure, shadow extent, and selective practical-light emissive surfaces; do not add many shadow-casting point lights.

- [ ] **Step 6: Rebuild assets and validate reports**

Run:

```bash
blender --background --factory-startup --python-exit-code 1 --python scripts/assets/build-creative-studio-architecture.py
npx tsx --test src/game/three/creative-studio-architecture.test.ts src/game/three/scene-asset-catalog.test.ts src/game/three/office-lighting.test.ts
```

Expected: Blender exits 0 with no invalid-mesh warning; tests PASS.

- [ ] **Step 7: Commit architecture and surfaces**

```bash
git add scripts/assets/build-creative-studio-architecture.py public/assets/shared/architecture public/assets/shared/surfaces src/game/three/creative-studio-architecture.ts src/game/three/creative-studio-architecture.test.ts src/game/three/scene-asset-catalog.ts src/game/three/office-renderer.ts src/game/three/office-lighting.ts src/game/three/office-lighting.test.ts src/game/three/office-finishes.ts
git commit -m "feat(ui2): add reusable creative studio architecture and PBR finishes"
```

### Task 4: Shared Furniture, Variants and Seat Metadata

**Files:**
- Create: `scripts/assets/build-shared-studio-furniture.py`
- Create: `public/assets/shared/furniture/README.md`
- Create: `public/assets/shared/furniture/build-report.json`
- Create: `public/assets/shared/furniture/*.glb`
- Create: `src/game/three/studio-furniture.ts`
- Create: `src/game/three/studio-furniture.test.ts`
- Modify: `src/game/three/scene-asset-catalog.ts`
- Modify: `src/game/three/seating.ts`
- Modify: `src/game/three/seating.test.ts`
- Modify: `src/game/three/seat-picking.ts`

**Interfaces:**
- Consumes: catalog variants, existing `Seat`, `seatAt()`, and procedural room-furniture fallbacks.
- Produces: `buildStudioFurnitureFallback(type, variant)`, catalog entries for reusable furniture, and catalog-driven `assetSeats(object)`.

- [ ] **Step 1: Write failing furniture and seat tests**

Cover workstations, office chairs, colored side chairs, round/production tables, curved sofa modules, armchairs, stools, credenzas, shelves, mobile board, and rugs. Assert that rotated seat anchors face their associated table and remain separate from visual offsets.

- [ ] **Step 2: Run tests and verify catalog gaps**

Run: `npx tsx --test src/game/three/studio-furniture.test.ts src/game/three/seating.test.ts src/game/three/scene-asset-catalog.test.ts`

Expected: FAIL for missing furniture assets and seat resolver.

- [ ] **Step 3: Author shared furniture geometry**

Build one reusable geometry per silhouette. Assign explicit material slots such as `upholstery`, `painted-metal`, and `oak` so catalog variants can safely map off-white, teal, coral, mustard, and neutral materials without name guessing. Preserve the approved miniature realism and rounded edge treatment.

- [ ] **Step 4: Move seat transforms into the catalog**

Implement `assetSeats(object)` by transforming catalog-local anchors through object direction and visual offset. Keep legacy `chair` and executive lounge fallbacks for old maps. Update seat picking to use the same transforms.

- [ ] **Step 5: Rebuild, validate and run tests**

```bash
blender --background --factory-startup --python-exit-code 1 --python scripts/assets/build-shared-studio-furniture.py
npx tsx --test src/game/three/studio-furniture.test.ts src/game/three/seating.test.ts src/game/three/seat-picking.test.ts src/game/three/scene-asset-catalog.test.ts
```

Expected: all assets satisfy footprint, bounds, triangle and file-size assertions; tests PASS.

- [ ] **Step 6: Commit shared furniture**

```bash
git add scripts/assets/build-shared-studio-furniture.py public/assets/shared/furniture src/game/three/studio-furniture.ts src/game/three/studio-furniture.test.ts src/game/three/scene-asset-catalog.ts src/game/three/seating.ts src/game/three/seating.test.ts src/game/three/seat-picking.ts
git commit -m "feat(ui2): add reusable studio furniture and catalog seats"
```

### Task 5: Creative-Studio Hero Kits and Detailed Dressing

**Files:**
- Create: `scripts/assets/build-creative-studio-kits.py`
- Create: `public/assets/environments/creative-studio/README.md`
- Create: `public/assets/environments/creative-studio/build-report.json`
- Create: `public/assets/environments/creative-studio/{photo,production,ideation,pantry}/*.glb`
- Create: `src/game/three/creative-studio-kits.ts`
- Create: `src/game/three/creative-studio-kits.test.ts`
- Modify: `src/game/three/scene-asset-catalog.ts`

**Interfaces:**
- Consumes: catalog contract and studio layout object variants.
- Produces: `attachCreativeStudioKit(host, object)` and registered photo, production, ideation, and pantry kit IDs.

- [ ] **Step 1: Write failing kit inventory tests**

Assert required IDs: `photo-cyclorama`, `photo-softbox`, `photo-camera-tripod`, `photo-reflector`, `photo-equipment-shelf`, `production-table-dressed`, `round-ideation-dressed`, `mobile-idea-board`, `sample-display`, `pantry-counter-dressed`, and `art-wall-dressed`.

- [ ] **Step 2: Run tests and verify missing entries fail**

Run: `npx tsx --test src/game/three/creative-studio-kits.test.ts src/game/three/scene-asset-catalog.test.ts`

Expected: FAIL on every unregistered kit.

- [ ] **Step 3: Author the photo-bay assets**

Model the coral floor-to-wall cyclorama with a continuous sweep, black camera tripod, camera body and lens, two softboxes with emissive diffuser material, reflector, backdrop support, stool, and open equipment shelf. Keep lights noninteractive; publish collision only for floor-standing equipment.

- [ ] **Step 4: Author production, ideation, pantry and art-wall dressing**

Model grouped noninteractive prints, magazines, swatches, cutting mat, tablets, pens, sample boxes, books, cups, bottles, fruit, coffee equipment, framed art, and pinned notes. Use slight deterministic rotations and height offsets to avoid a stamped appearance. Keep text/logo content generic and original.

- [ ] **Step 5: Validate asset budgets and fallback behavior**

Run the Blender generator, parse every GLB into the generated report, and run catalog/kit tests. Verify no alpha-card plants, invalid meshes, missing normals, transparent opaque materials, or out-of-footprint geometry.

- [ ] **Step 6: Commit the creative kits**

```bash
git add scripts/assets/build-creative-studio-kits.py public/assets/environments/creative-studio src/game/three/creative-studio-kits.ts src/game/three/creative-studio-kits.test.ts src/game/three/scene-asset-catalog.ts
git commit -m "feat(ui2): add detailed creative studio production kits"
```

### Task 6: Renderer Integration and Reference Composition

**Files:**
- Create: `src/game/three/creative-studio-renderer.ts`
- Create: `src/game/three/creative-studio-renderer.test.ts`
- Modify: `src/game/three/office-renderer.ts`
- Modify: `src/game/three/bridge.ts`
- Modify: `src/game/three/render-scale.ts`
- Modify: `src/game/three/frame-benchmark.ts`
- Modify: `src/game/three/frame-benchmark.test.ts`
- Modify: `src/game/three/office-look-thumbnail.ts`

**Interfaces:**
- Consumes: creative layout, architecture builder, catalog loader, furniture fallback, kit adapter, existing renderer controls and benchmark.
- Produces: `renderCreativeStudioObject(host, object): boolean`, agency overview framing, and scene-budget reporting.

- [ ] **Step 1: Write failing integration tests**

Create a 42×26 agency snapshot and assert architecture is added once, all studio types resolve to a fallback plus catalog ID, repeated asset URLs load once, sofa/stool groups retain seats, and the overview distance contains outer bounds.

- [ ] **Step 2: Run renderer tests and verify the old generic path fails**

Run: `npx tsx --test src/game/three/creative-studio-renderer.test.ts src/game/three/bridge.test.ts src/game/three/frame-benchmark.test.ts`

Expected: FAIL because agency still uses generic office rendering.

- [ ] **Step 3: Add a focused creative-studio adapter**

```ts
export function renderCreativeStudioObject(host: T.Group, object: MapObject): boolean {
  const id = studioAssetFor(object.type, object.variant);
  if (!id) return false;
  host.add(buildStudioFurnitureFallback(object.type, object.variant));
  void attachSceneAsset(host, id, { variant: object.variant });
  return true;
}
```

Call this only when `map.environment === "agency"`. Keep general office, executive, publishing, and legacy paths unchanged.

- [ ] **Step 4: Integrate architecture, camera, seats and batching**

Add `addCreativeStudioArchitecture()` before furniture. Apply catalog visual offsets after tile-center placement. Retain seat metadata before batching. Batch static opaque furniture and coplanar glass after all late-loading hosts are marked dynamic.

- [ ] **Step 5: Extend frame benchmark with scene budgets**

Report triangles, draw calls, loaded scene bytes, median FPS, and p95 frame time. Add pure threshold evaluation so unit tests can verify pass/fail independently of browser timing.

- [ ] **Step 6: Update the agency thumbnail composition**

Use the same environment builder and overview framing for the selection thumbnail; do not maintain a separate hand-authored miniature.

- [ ] **Step 7: Run renderer and full Three.js unit tests**

Run: `npx tsx --test "src/game/three/*.test.ts" src/game/ambient-zones.test.ts src/server/channel-motion-layout.test.ts`

Expected: PASS.

- [ ] **Step 8: Commit renderer integration**

```bash
git add src/game/three/creative-studio-renderer.ts src/game/three/creative-studio-renderer.test.ts src/game/three/office-renderer.ts src/game/three/bridge.ts src/game/three/render-scale.ts src/game/three/frame-benchmark.ts src/game/three/frame-benchmark.test.ts src/game/three/office-look-thumbnail.ts
git commit -m "feat(ui2): render creative studio from reusable scene assets"
```

### Task 7: Exact-Snapshot Agency Upgrade

**Files:**
- Create: `src/lib/fixtures/official-agency-v2.json`
- Create: `src/lib/official-environment-upgrade.ts`
- Create: `src/lib/official-environment-upgrade.test.ts`
- Modify: `src/app/api/channels/[id]/route.ts`
- Create: `src/app/api/channels/channel-map-upgrade.test.ts`
- Modify: `src/lib/office-environment-template.ts`
- Modify: `src/lib/office-environment-template.test.ts`

**Interfaces:**
- Consumes: canonical old agency fixture, `buildOfficeEnvironment("agency")`, `sameJsonSnapshot`, selected channel `mapData` and `updatedAt`.
- Produces: `upgradeOfficialEnvironmentMap(map): { map; upgraded: boolean; fromVersion?: number }` and optimistic persistence in channel GET.

- [ ] **Step 1: Freeze the prior official agency snapshot fixture**

Generate the fixture from commit `5d836178` before changing the agency builder and verify its SHA-256 in the test so future formatting or property-order changes do not silently broaden migration eligibility.

- [ ] **Step 2: Write failing exact-match and edited-map protection tests**

```ts
const upgraded = upgradeOfficialEnvironmentMap(structuredClone(agencyV2));
assert.equal(upgraded.upgraded, true);
assert.deepEqual(upgraded.map, buildOfficeEnvironment("agency"));

const edited = structuredClone(agencyV2);
edited.layers.find(l => l.name === "Objects").objects.pop();
assert.equal(upgradeOfficialEnvironmentMap(edited).upgraded, false);
assert.deepEqual(upgradeOfficialEnvironmentMap(edited).map, edited);
```

- [ ] **Step 3: Run tests and verify missing upgrader failure**

Run: `npx tsx --test src/lib/official-environment-upgrade.test.ts src/lib/office-environment-template.test.ts`

Expected: FAIL because the upgrader does not exist.

- [ ] **Step 4: Implement pure snapshot comparison and upgrade**

Normalize database JSON strings/objects only at the input boundary. Compare every object, layer, array position, dimension, spawn and environment property. Return the original object reference when no upgrade applies and a fresh agency v3 map only for the exact fixture.

- [ ] **Step 5: Persist lazily with optimistic concurrency**

In channel GET, after authorization and selection, compute the upgrade. Update only with `WHERE channel.id = selected.id AND channel.updatedAt = selected.updatedAt`. If the update affects zero rows, refetch and return the concurrently saved map. Never update other channel columns.

- [ ] **Step 6: Version template tags without mutating old records**

Change the official agency tag to `deskrpg-office-v3:agency`; retain v2 lookup only as migration evidence. New selections create or reuse the v3 template. Other environment tags remain unchanged.

- [ ] **Step 7: Run API, upgrade and template tests**

Run: `npx tsx --test src/lib/official-environment-upgrade.test.ts src/lib/office-environment-template.test.ts src/app/api/channels/channel-map-upgrade.test.ts`

Expected: PASS for PostgreSQL-shaped JSON, SQLite string JSON, exact upgrade, edited protection, and lost-race refetch.

- [ ] **Step 8: Commit migration behavior**

```bash
git add src/lib/fixtures/official-agency-v2.json src/lib/official-environment-upgrade.ts src/lib/official-environment-upgrade.test.ts src/app/api/channels/[id]/route.ts src/app/api/channels/channel-map-upgrade.test.ts src/lib/office-environment-template.ts src/lib/office-environment-template.test.ts
git commit -m "feat(ui2): safely upgrade official agency maps to creative studio"
```

### Task 8: Packaging, Full Verification and Staging Delivery

**Files:**
- Modify: `Dockerfile`
- Modify: `package.json`
- Modify: `deploy/pre-deploy-checklist.md`
- Modify: `docs/design/three-asset-quality-checklist.md`
- Modify: `docs/superpowers/plans/2026-09-14-creative-studio-agency-replacement.md` (check completed boxes only)

**Interfaces:**
- Consumes: all catalog, layout, renderer, migration, Blender assets and build reports.
- Produces: package-safe runtime, staging deployment, captured benchmark and visual verification evidence.

- [x] **Step 1: Write packaging boundary tests before changing manifests**

Add assertions to the existing runtime/package boundary tests that every server-imported layout module is included by Docker and npm, every catalog URL exists under `public`, and build reports cover every generated GLB.

- [x] **Step 2: Run boundary tests and observe missing package entries**

Run: `npx tsx --test src/lib/client-bundle-boundary.test.ts src/game/three/scene-asset-catalog.test.ts`

Expected: FAIL for newly server-imported studio modules until package boundaries are updated.

- [x] **Step 3: Update Docker/npm runtime boundaries and quality checklist**

Prefer copying the required shared Three.js runtime directory boundary rather than maintaining another fragile per-file list. Ensure all public assets ship through the existing `public` copy. Add the exact texture, reflection, shadow, bounds, triangle, byte, draw-call, and screenshot checks to the reusable quality checklist.

- [ ] **Step 4: Run complete local verification once**

```bash
npm run test
npm run typecheck
npm run lint
npm run build
npm pack --dry-run
npm run tc pre-deploy
```

Expected: all checks PASS; `npm pack --dry-run` lists the catalog, studio runtime modules, and generated public assets. If the known local production-env check is unavailable, record the exact missing prerequisite and continue only with the staging-specific deploy check already authorized by project instructions.

- [ ] **Step 5: Commit packaging and documentation**

```bash
git add Dockerfile package.json deploy/pre-deploy-checklist.md docs/design/three-asset-quality-checklist.md
git commit -m "chore(ui2): package and document creative studio assets"
```

- [ ] **Step 6: Push master and deploy staging**

Follow `.codex/skills/deskrpg-release/SKILL.md` for staging scope. Push verified `master`, run `npm run deploy:test`, and confirm app/database containers are healthy plus `/` returns HTTP 200 after redirects.

- [ ] **Step 7: Trigger exact agency migration and verify preservation**

Before opening an official v2 agency channel, record its channel ID, user/NPC/profile counts, chat-room/message counts, gateway configuration hash, and `map_data` backup. Open it once, then verify only `map_data` and `updated_at` changed and that the new map is 42×26/version 3.

- [ ] **Step 8: Verify visually in Comet/Chrome**

At the supplied reference angle capture the whole map, then inspect photo bay, production table, main lounge, meeting room, pantry, window/brick seams, glass corners, plant leaves, reflections and shadow softness. Exercise orbit, pan, zoom, walking, fixed-seat return, temporary seating, refresh persistence, and at least two simultaneous NPC walkers.

- [ ] **Step 9: Measure the 30-second performance sample**

Record median FPS, p95 frame time, renderer triangles, draw calls, and loaded scene bytes during an orbit-and-walk sample. If any global target fails, profile the largest asset/draw-call contributor, correct it, rerun focused tests and the sample, and record the final measured values.

- [ ] **Step 10: Final regression and delivery report**

Confirm executive, publishing, trading, and tech maps still load with their prior dimensions, seats, room policies, and assets. Report commit IDs, staging URL, automated checks, measured performance, migration counts, visual limitations, and any intentionally deferred polish. Do not create a production tag or release.
