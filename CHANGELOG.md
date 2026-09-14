# Changelog

All notable changes to this project will be documented in this file.

This project follows a Keep a Changelog style workflow.
GitHub Releases will be written later at actual release time.

## [Unreleased]

## [%s] - 2026-09-15

### Added

- 3D office client: three.js renderer on top of the existing Phaser simulation (movement, seating and collisions unchanged), 50 stylized office looks as GLB characters, five curated environments, 3D meeting room.
- Hermes gateway setup wizard (`/gateways`): discover a local or SSH-reachable Hermes install, pre-check the DeskRPG plugin and services, register profiles. Off by default (`DESKRPG_HOST_SETUP_ENABLED=1`, `system_admin` only).
- Chat rooms (`room:*`): office room with mention-only replies, invite-based group rooms, six-stage response receipts and per-session request queue.
- Hostinger deployment recipe: `deploy/hostinger/docker-compose.yml` (single file, bundled Hermes gateway, Traefik labels) and a Deploy on Hostinger button.

### Changed

- OpenClaw runtime retired; DeskRPG now binds NPCs to Hermes Agent profiles only.
- README rewritten for the 3D, Hermes-only office.

### Removed

- Development plans under `docs/superpowers/` are no longer tracked.


### Added

- Channel owners can now delete meeting minutes from the minutes detail view.
- The meeting room sidebar can now be resized with a drag handle.
- The meeting start form now supports a collapsed settings panel.
- The meeting topic field now uses a multi-line textarea.

### Changed

- Meeting room metadata now reflects the active channel name.
- Meeting room start controls were simplified to show only the essential inputs by default.
- README screenshots and animated GIFs were refreshed and normalized to the same aspect ratio.

### Fixed

- Fixed duplicated NPC meeting messages during streamed discussions.
- Fixed streamed NPC responses disappearing when a turn completed.
- Fixed `SPEAK:` prefixes leaking into meeting room streaming and final messages.
- Fixed meeting room poll status rendering `[object Object]` for raised hands.
- Fixed meeting minutes parsing when SQLite returned JSON fields as strings.
- Fixed the active meeting chat panel so the input stays visible while messages scroll.

### Known Issues

- Some README GIF assets are larger than ideal and may need further optimization.

## Release Process

1. Keep new work under `Unreleased` while development is in progress.
2. At release time, move `Unreleased` items into a versioned section such as `## [0.1.1] - 2026-04-01`.
3. Create the git tag and publish the matching GitHub Release from that versioned section.
4. Start a fresh `Unreleased` section for the next cycle.
