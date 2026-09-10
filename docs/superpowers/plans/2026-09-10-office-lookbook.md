# Office Lookbook Implementation Plan

> **For agentic workers:** Use executing-plans for the coupled character path; isolate map implementation and final review where useful. Track completion below.

**Goal:** Ten complete office characters and five predefined office environments, working in the existing DeskRPG UI2 frontend.

**Architecture:** An immutable frontend catalog resolves officeLookId from existing appearance JSON. Procedural Three models share the same rig in gallery/world/meeting. Valid LPC fallback layers keep the current API and invisible simulation compatible.

**Tech Stack:** TypeScript, React, Three.js, existing Next/Phaser simulation, node:test.

**Spec:** docs/superpowers/specs/2026-09-10-office-lookbook.md

## Global constraints
- Worktree feat/ui2-frontend only; no backend/API/schema/socket contract changes.
- Preserve old appearance when editing only a name; unknown look identifiers never crash.
- Use ten distinct silhouettes; no per-part controls in player selection.
- Existing maps unchanged. Public MVP unchanged.

## Task 1: Catalog and rig
- [x] Add src/game/three/office-looks.ts: typed catalog, resolveOfficeLook(unknown), officeLookAppearance(id) with validated legacy fallback.
- [x] Add node tests: ten unique IDs, all generated appearances validate, JSON roundtrip, missing/unknown IDs, independent cloned layers.
- [x] Add wardrobe mesh builder and integrate optional catalog look into createActor; shared idle/walk/seat/talk rig, approximately 3.5 heads tall.
- [x] Verify geometry bounds, variants, finite animation transforms and disposal.

## Task 2: Gallery and presentation integration
- [x] Replace create-page AppearanceEditor/useCharacterAppearance with stable selected appearance; preserve loaded raw appearance until selection.
- [x] Add gallery category/search and original names, thumbnails rendered using one shared offscreen renderer; large selected preview with direction/walk controls.
- [x] Pass officeLookId through CharacterPreview, GameScene actors and meeting scene. Invalidate world model when look ID changes.
- [x] Check empty results, responsive layout, save error, edit-load failure and legacy handling.

## Task 3: Trading-company map
- [x] Add trading preset to office-presets and NewProjectModal.
- [x] Use existing known furniture types, leave clear meeting/leader/archive/pantry approaches and entrance.
- [x] Test dimensions, spawn, connectivity, IDs and immutability at minimum/default sizes.

## Task 4: Verification
- [x] Run targeted node tests, typecheck, ESLint, full tests and build.
- [x] Chrome: select distinct looks, rotate/walk, save and reopen character, verify map preset and 3D preview.
- [x] Review changes, fix confirmed issues, record results and commit scoped files.

## Approved extension: complete office environments
- [x] Five deterministic furnished layouts with connected walkable aisles.
- [x] Replace channel map-template grid with five-choice live 3D environment picker.
- [x] Register/reuse exact snapshots using existing template API; preserve other templates.
- [x] Hide primary editor and palette entry points, including Tab shortcut.
- [x] Automatic environment palette in preview and world; Chrome create/enter verification.
- [x] Final typecheck, lint, tests, build and review.

## Verification result
2026-09-10: full suite 1204 tests (1201 pass, 3 skip, zero failures); subsequent JSONB comparison regression suite 6/6 pass. TypeScript, scoped ESLint and production build pass. Chrome desktop/mobile: five environment choices and 3D previews; publishing channel created and reloaded with the saved office-eun character, no runtime console errors, primary editor controls absent. Remaining forty character looks are a later phase.
