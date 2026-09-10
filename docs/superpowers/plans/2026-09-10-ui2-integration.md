# DeskRPG UI 2.0 frontend integration

Approved by user: replace the existing DeskRPG frontend with the miniature-office MVP visual/interaction system, retaining backend. Work only in this feature worktree. Preserve existing routes, auth, permissions, API/socket payloads, profiles, tasks, meetings, map editor and localization.

## Tasks
- [x] Baseline tests and isolated dependency install.
- [x] All-app frontend theme and application navigation; restyle existing auth, lobby, channels, characters, providers, gateways, admin and map editor without removing behaviors.
- [x] Replace active Phaser renderer with Three.js, adapt legacy map dimensions/layers/objects to actual channel coordinates. Do not silently replace channel maps with demo geometry or client-only random maps.
- [x] Keep player/npc socket membership, movement, bubble/activity, interaction, placement, spawn editing, report arrival/return and group gathering contracts.
- [x] Game HUD and real room/task/meeting panels use same miniature-office design; no simulated AI in integration.
- [ ] Test coordinate/map conversion and event bridge; all existing tests, typecheck/build, frontend-only diff audit. Browser QA uses Chrome extension only. Record actual limitations.

## Generic frontend assignment
Owned files: src/styles/*, src/app/globals.css, src/app/layout.tsx, src/app/page.tsx, auth/channels/characters/providers/gateways/admin/map-editor frontend page components and their supporting frontend-only components. Exclude src/app/game/**, src/game/**, src/components/PhaserGame.tsx and src/components/ThreeGame.tsx, package files and backend files. Avoid destructive replacement of existing controls. Add an accessible shared navigation component if needed; game route owns its HUD so avoid duplicate navigation there. Preserve i18n and permissions. Reference MVP style from /Users/dante/workspace/dante-code/projects/deskrpg-ui2-mvp/src/style.css (read only): paper/sage/wood visual, warm light surfaces, green accents, rounded 8–16px controls, compact header, useful left navigation. This is DeskRPG product UI, not a Dante Labs editorial landing page.

Map editor remains functionally complete with tile/asset authoring support; 3D viewport derives from the same persisted map. No backend API/schema changes or deployments.

## Implementation boundary

The first integration replaces the office and meeting presentation with Three.js inside the existing application. Phaser remains an invisible simulation host for existing movement, collision, socket membership and NPC/report/room interactions. `OfficeBridge` exposes snapshots and pointer/editor operations; the Three renderer has no socket subscription or message emission of its own. Event ownership is scoped so an old scene cannot wipe page/new-renderer listeners on teardown.

Known furniture objects and legacy tiles render as miniature 3D objects. Arbitrary custom Tiled artwork, including foreground sprites, remains an accurately placed textured surface; the code does not guess semantic geometry from pixel art. Existing appearance composition supplies skin/hair/clothing colours; the original outfit preview remains available because individual LPC accessories are not yet modeled in 3D.

Map editor retains existing tile/stamp/layer/undo/save functions and adds a read-only 3D preview. Three new optional project presets (garden office, courtyard studio, collaboration café) use existing Tiled object data and the existing project create endpoint. They never overwrite a current map automatically. Fully spatial 3D map authoring remains a subsequent phase.

## Validation on 2026-09-10

- TypeScript `npx tsc --noEmit --pretty false`: passed.
- Targeted ESLint on all new Three modules/components: passed.
- Full `npm test`: 1,177 tests, 1,174 passed, 3 skipped, 0 failures. Includes 12 new coordinate, exact-target, event ownership, preset reachability and GPU disposal checks.
- `npm run build`: passed. Existing Next workspace-root/tracing and middleware-convention warnings remain; no backend/config edits were made to silence them.
- `git diff --check`: passed.
- No changes in `src/server`, `src/db`, or `src/app/api`.
- Code review: fixed missing in-game Save, exact NPC targeting among neighbours, invisible legacy tile choices, repeated custom-map rasterization, and large-map overview limits.
- Chrome extension browser QA is blocked by the plugin runtime's missing `browser-service.mjs` module. No alternative browser automation was used. Actual multi-user/NPC/meeting/browser performance behavior is not claimed verified.

## Remaining rollout gates

- [ ] Chrome extension: actual login → character → channel → 3D office; movement/camera/keyboard and mobile viewport checks.
- [ ] Two-user and Hermes-backed checks: DM/group mentions, queued/streaming bubbles, call/return, report arrival, meetings/minutes, reconnect.
- [ ] Browser editor save/reload, custom tilesets/stamps/foreground, 3D preview and new preset creation.
- [ ] Review/merge and staging deployment after visual/interaction validation. Production is unchanged.

## Local preview

http://localhost:3102/auth — dev server runs in this worktree with `DB_TYPE=sqlite`, `SQLITE_PATH=/tmp/deskrpg-ui2-preview/data/deskrpg.db`, and `DESKRPG_HOME=/tmp/deskrpg-ui2-preview`. This is a separate empty test database; the original account/data and gateway connection are not copied. HTTP `/auth` returned 200. Dev log: `/tmp/deskrpg-ui2-dev.log`. This verifies route availability only, not browser rendering or live AI behavior.
