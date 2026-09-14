# Creative Studio Agency Replacement Design

## Goal

Replace the built-in `agency` environment with a high-fidelity creative studio that closely reproduces the supplied 1748×900 reference image. Keep the `agency` identifier so existing selection and channel flows continue to work. Preserve users, NPC profiles, chat, gateway connections, and movement behavior while replacing the official map layout and presentation.

The result must retain the executive-office quality baseline: authored PBR materials, controlled reflections, soft shadows, ACES tone mapping, detailed hero furniture, reusable asset registration, deterministic collision and seating data, and runtime fallback behavior.

## Reference and Success Criteria

The reference is a wide, warm, open studio viewed from the front-right in an isometric cutaway. Its identity comes from the relationship among eight zones rather than any single prop:

- a coral cyclorama and photography equipment at the left;
- four-person workstations along the rear-left;
- an idea table and mobile board near the left-center;
- a curved social lounge at the rear-center;
- a large dressed production table at the center-front;
- a glass meeting room at the rear-right;
- a coral-backed pantry and bar at the mid-right;
- a small informal lounge at the front-right;
- a central double-door entrance and continuous pale oak floor.

Acceptance requires the same spatial hierarchy, approximate relative scale, major sightlines, warm material palette, furniture density, and camera composition. Pixel-identical reproduction is not required because the runtime is navigable and uses animated characters. A reference-angle screenshot must make every major zone immediately recognizable in the same relative position.

## Map Geometry

The replacement map is 42 columns by 26 rows using the existing 32-pixel logical tile contract. World-space furniture may use sub-tile visual offsets, but collision, destinations, and persistence continue to use tile coordinates.

The coordinate origin is the rear-left of the map:

| Zone | Bounds | Contents |
| --- | --- | --- |
| Photo bay | x 1–9, z 2–10 | Coral cyclorama, camera, two softboxes, reflector, equipment shelf |
| Workstations | x 11–23, z 2–8 | Four-person desk island, monitors, mobile drawers, rear credenzas |
| Ideation | x 10–19, z 9–16 | Round review table, eight colored chairs, mobile idea board |
| Main lounge | x 22–31, z 7–14 | Curved sofa, round table, teal and coral armchairs |
| Production | x 16–29, z 16–23 | Large dressed worktable, eight chairs, prints, swatches and devices |
| Meeting room | x 32–41, z 2–10 | Glass enclosure, six-person table, display and board |
| Pantry | x 32–41, z 11–18 | Coral feature wall, counter, coffee equipment, bar and three stools |
| Small lounge | x 32–41, z 19–25 | Sofa, beanbag, armchair, low table and reference shelf |
| Entrance | x 21–25, z 25 | Centered double glass door and clear arrival area |

At least two logical tiles of primary circulation clearance must connect the entrance, production table, workstations, pantry, meeting room, and photo bay. Low shelves and credenzas divide open zones without introducing full-height central walls. Only the meeting room and photo-bay edge use tall partitions.

## Architecture and Surface System

Create reusable, registry-backed architectural modules instead of a monolithic room model:

- pale oak plank floor with base-color, normal, and roughness maps;
- warm red brick wall modules with corner and window-adjacent variants;
- white plaster wall modules;
- black powder-coated steel grid windows;
- black-framed clear glass partitions, corners, single doors, and double doors;
- pale timber plinth and cutaway edge modules;
- wall rails, picture ledges, and recessed cabinet runs.

Modules use meters, Y-up, +Z front, ground-level origins, explicit footprints, and consistent snap points. Glass receives reflections but does not cast opaque shadows. Brick and oak use stable UV scale across adjacent modules so seams do not reveal module boundaries.

The default camera frames the map from the front-right at the same overall angle as the reference. Orbit, pan, and zoom remain enabled. The full-map camera preset must include furniture height and the outer cutaway edge.

## Asset Catalog

Extend the current shared-scene registry into a typed catalog with these fields:

- stable `assetId` and versioned URL;
- category and semantic tags;
- world bounds and logical footprint;
- seat anchors and facing directions where applicable;
- destination tags for ambient behavior;
- allowed material variants;
- cast/receive shadow policy;
- static batching or instancing eligibility;
- LOD tier and triangle/file-size budget;
- fallback renderer identifier;
- source script and licensing metadata.

Assets are organized by ownership:

```text
public/assets/shared/
  architecture/
  furniture/
  decor/
  landscape/
  surfaces/
public/assets/environments/creative-studio/
  photo/
  production/
  ideation/
  pantry/
```

Shared assets include workstation desks, office chairs, colored side chairs, tables, curved sofa modules, armchairs, stools, credenzas, low shelves, mobile boards, frames, lamps, books, cups, stationery, planters, glass partitions, windows, brick, plaster, and oak surfaces.

Creative-studio assets include the cyclorama, backdrop roll, softbox, reflector, tripod camera, equipment shelf, production-table dressing, print and color-swatch kits, sample racks, art boards, pantry dressing, and photography props.

Use dressed kits for noninteractive prop clusters such as `production-table-dressed`, `pantry-counter-dressed`, and `photo-bay-kit`. Furniture with collision, seats, or interaction remains independently addressable.

## Existing Asset Reuse

Reuse assets only when their proportions and silhouette fit the creative-studio reference:

- reuse `ficus` and `olive` geometry with planter material variants;
- reuse verified sofa, armchair, coffee-table, rug, bookshelf, guest-chair, and office-chair production patterns;
- expose off-white, teal, coral, mustard, and neutral upholstery variants rather than duplicating geometry;
- reuse the existing GLTF lifecycle, late-load cancellation, disposal, static batching, and shadow ownership;
- reuse the executive surface-loading pattern for oak, brick, plaster, fabric, painted metal, and glass;
- do not reuse the executive desk or other strongly walnut-and-brass hero pieces.

Material overrides must be explicit catalog variants, not arbitrary per-map traversal that depends on Blender material names.

## Rendering Quality

Retain the current ACES Filmic tone mapping, sRGB output, PMREM room environment, and PCF soft shadows. Add an `agency` lighting profile tuned for warm daylight:

- broad daylight enters from rear and left window walls;
- a soft fill prevents faces and furniture fronts from crushing to black;
- practical pendant and photography lights provide local highlights without becoming the main shadow source;
- oak remains pale and neutral rather than saturated yellow;
- coral, teal, and mustard accents remain below clipping;
- floor roughness permits a wide, faint window reflection without becoming mirror-like;
- glass and metal reflect the environment while fabric, brick, and unfinished wood remain diffuse;
- furniture and plants cast soft shadows; glazing does not cast opaque shadows.

Texture targets are 512–1024 pixels for ordinary props and up to 2048 pixels for hero furniture or large architectural surfaces. Use base-color, normal, and roughness maps for principal surfaces. Metallic maps are used only where a model contains mixed metal and nonmetal regions.

Ordinary props should remain below 3,000 triangles, common furniture below 12,000, and hero assets below 30,000. Individual GLBs should normally remain below 2 MB. Larger exceptions require an entry in the generated build report. Repeated furniture uses cached GLTF resources plus cloning, instancing, or static batching as appropriate.

At the default full-map view, the steady-state target is no more than 1.2 million rendered triangles and 350 draw calls. Initial compressed transfer for agency-specific and newly shared scene assets must remain below 25 MB. On the staging reference desktop in Chrome or Comet, the target is a median of at least 55 FPS with a p95 frame time below 25 ms during a 30-second orbit-and-walk sample. These measurements are reported rather than silently waived if the reference machine or browser prevents a valid sample.

## Navigation, Seats, and Ambient Behavior

The map carries behavior metadata; the ambient scheduler contains no creative-studio coordinates.

Each zone defines `roaming`, `destinationTags`, and access policy. Workstations provide fixed profile seats. Production, ideation, pantry, and both lounges are ambient destinations. The meeting room is used for meeting or seat-targeted actions. The photo bay is excluded from random roaming and is entered only by a photo-related destination action.

Chair, sofa, and stool assets declare visual seat transforms and tile-space navigation anchors separately. This preserves natural furniture spacing and prevents seated legs from intersecting cushions or table bodies. Every seat anchor must be reachable from the entrance and have a reversible, body-clear route.

Photo equipment, shelves, counters, and dressed tables publish collision footprints with approach clearance. The main entrance and primary aisles remain free of ambient destinations so idle characters do not block circulation.

## Data Flow and Module Boundaries

The implementation separates four concerns:

1. `creative-studio-layout` defines zones and object placement data.
2. `scene-asset-catalog` defines reusable visual resources, footprints, seats, variants, quality metadata, and fallbacks.
3. environment architecture and furniture adapters turn layout records into Three.js scene objects.
4. existing Tiled projection, navigation, seating, and ambient modules consume persisted geometry and metadata.

The deterministic environment builder emits a Tiled map tagged `officeEnvironment=agency` and a new environment version. Both client preview and live game use the same projected object metadata. Renderer-only offsets never alter authoritative navigation coordinates.

## Replacement and Migration

Keep the environment ID `agency` and update its localized name to “크리에이티브 스튜디오” / “Creative studio.” Replace its built-in layout, finishes, lighting profile, thumbnail, and description.

Create a new template snapshot instead of mutating a shared template record in place. Automatically migrate only channels whose map:

- is tagged as the previous official `agency` version; and
- exactly matches the previous deterministic built-in snapshot.

Channels with any user-edited geometry or metadata are not overwritten. Migration preserves channel ID, membership, users, NPC/profile assignments, chat rooms and messages, gateway configuration, and other non-map fields. A pre-migration copy of each replaced `map_data` value is retained by the migration operation or deployment runbook for rollback.

## Loading and Failure Behavior

Registry validation runs before export and in tests. Missing catalog entries, invalid footprints, missing fallbacks, oversized resources, and bounds that exceed declared limits fail validation.

At runtime, each GLB starts with a lightweight procedural fallback. A successful load atomically replaces the fallback. A failed or cancelled load leaves the fallback visible and records `assetStatus=failed` without breaking navigation. Late loads after scene disposal are disposed and never attached. Missing material maps degrade to valid scalar material values.

## Testing and Verification

Automated checks cover:

- deterministic 42×26 agency map generation;
- unique object IDs, valid footprints, no solid overlaps, and a connected walkable floor;
- primary aisle width and entrance reachability;
- every seat anchor reachable with a reversible body-clear path;
- zone metadata and exclusion of meeting/photo zones from random roaming;
- asset registry completeness, URL existence, bounds, triangle counts, file sizes, material opacity, normals, and fallback IDs;
- GLTF cache, cloning, disposal, failure fallback, and batching behavior;
- material color-space, normal-map strength, roughness, glass and shadow policy;
- exact-snapshot migration and protection of edited maps;
- Docker and npm inclusion of every runtime catalog and asset file.

Visual verification uses the local build and staging site at minimum. Capture the default reference-angle view and closer views of the photo bay, production table, main lounge, meeting room, and pantry. Compare zone placement, furniture density, palette, reflections, shadow softness, texture seams, glass sorting, clipping, and seated poses against the supplied reference. Check orbit, pan, zoom, walking, temporary seating, and refresh persistence.

## Delivery Stages

1. Catalog and material foundation, layout contract, migration tests.
2. Architectural shell, oak/brick/glass surfaces, camera and lighting.
3. Shared furniture and seating variants.
4. Photo bay, production, ideation, and pantry kits.
5. Detailed dressing, batching, budgets, and visual correction.
6. Staging migration, browser verification, performance and regression checks.

Each stage must leave the map runnable with fallbacks. The previous official agency snapshot remains available to the migration test and rollback process, but it is no longer offered as a selectable environment.

## Non-goals

- No map editor or end-user studio customization is added.
- No AI context is generated from decorative props or ambient visits.
- No new character production is part of this map change.
- No physics simulation is added for loose props.
- No production release occurs until staging visual and interaction verification is accepted.
