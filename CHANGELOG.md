# Changelog

All notable changes to this project will be documented in this file.

This project follows a Keep a Changelog style workflow.
GitHub Releases will be written later at actual release time.

## [Unreleased]

## [2026.920.1] - 2026-09-20

### Added

- Connect a Hermes host locally or over SSH from the wizard: administrators get both by default, register SSH hosts with a DeskRPG-only key or with the server's own `~/.ssh/config` and agent.
- Install Hermes on a host without python3 — the setup launcher fetches a user-local Python with uv, and names the sudo-only packages (git, C++ compiler, curl) with the exact command when it cannot continue.
- Show gateway state on the discovery card: running, stopped (connecting starts it) or blocked by separately running profile gateways.

### Changed

- Host discovery lists one gateway and its profiles instead of one candidate per profile.
- Screens carry less instruction text: blocked reasons sit behind a `?` button, the hire wizard moves with Back/Next, office join codes and group invites open in a dialog, and share/diagnostics moved into header buttons.
- Korean UI says "오피스" everywhere (was a mix of 채널 and 사무실).
- New 3D miniature logo rendered from the same three.js model as the sidebar headquarters, with a simplified favicon that reads at 16px.
- Web screens use the Dante Labs brand v2 tokens (cream surfaces, navy text, 8px radius cap, navy-tinted shadows); the office green stays as the single product accent.
- One page frame for every workspace screen — the same padding and max width instead of per-page values.

## [2026.9.19] - 2026-09-15

### Added

- Enter meetings by walking into the meeting space in each office map; legacy maps receive an attached meeting area.
- Keep meetings on the original map and characters, with wall fading, speaker camera motion and manual camera rotation.
- Improve Hermes gateway setup diagnostics and first-account guidance.

### Fixed

- Keep board and seat interactions distinct while walking into meetings.
- Return channel owners from gateway setup to the kanban board.
- Avoid a synchronous effect update when checking clipboard availability.

## [2026.9.17] - 2026-09-14

### Fixed

- Align Docker with Node 22 and pin SQLite to 12.8.0 so native dependencies install consistently.
- Include the final CI action updates alongside the Hermes morning commute homepage release.

## [2026.9.16] - 2026-09-14

### Added

- DeskRPG for Hermes morning commute homepage: a Three.js city district, six animated office characters, and smooth pointer-driven camera movement.
- Responsive public and login layouts, reduced-motion support, and WebGL context recovery.

### Changed

- The public launch screen can be enabled at runtime with `COMING_SOON=true`, using the same release image as self-hosted offices.
- Homepage metadata and translations now describe the Hermes 3D office.
- Pin Next.js build and output tracing to the project root to avoid parent-workspace dependency resolution errors.

## [2026.9.15] - 2026-09-15

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
