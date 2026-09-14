# README Cinematic GIFs Design

## Goal

Replace the current README media with four reproducible 16:9 animated product stories that show
the current DeskRPG visual language and core Hermes collaboration flows. Update the English and
Korean README copy to match what is currently available. Map Editor must no longer be presented as
an available feature; it is a later release.

This work does not publish npm, create a public release, or deploy production.

## Deliverables

- Four committed README GIFs under `public/readme/`:
  - `deskrpg-home-commute.gif`
  - `deskrpg-walk-report.gif`
  - `deskrpg-small-talk.gif`
  - `deskrpg-ai-meeting.gif`
- One updated 16:9 static homepage poster for the README hero.
- Reproducible local capture tooling and deterministic demo fixtures.
- Updated `README.md` and `README.ko.md` with synchronized media, captions, website status, feature
  descriptions, and Map Editor availability.
- Local, ignored MP4 masters, raw browser recordings, logs, and visual review contact sheets.

## Media Specification

- Browser capture: 1280×720, 30 fps.
- README GIF: 960×540, 12 fps, infinite loop.
- Duration: 8–10 seconds per GIF.
- Size target: 5–8 MB each; hard maximum 10 MB.
- The first frame must communicate the scene without waiting for motion.
- No text overlays inside the media. English and Korean descriptions live in the README captions.
- GIF encoding uses an FFmpeg two-pass palette workflow with a scene-appropriate palette and
  dithering. MP4 masters use H.264, `yuv420p`, and `faststart` for broad compatibility.

## Capture Architecture

The capture system runs outside production behavior:

1. A capture setup command creates an isolated DeskRPG home and fresh SQLite database.
2. A deterministic seed step creates the capture user, six visually distinct office characters,
   one office channel, NPC placements, and the records needed by chat and meeting views.
3. A localhost-only mock Hermes gateway returns fixed, short Korean responses with deterministic
   streaming timing. It never loads production credentials or calls an external model.
4. DeskRPG starts locally against the isolated database and mock gateway.
5. A dedicated Playwright capture suite signs in by API, enters the seeded channel, performs the
   real UI interactions, and records one scene at a time.
6. A media build script trims the recordings, normalizes them, creates GIF palettes, writes the
   GIFs and poster, and emits an FFprobe report.

The capture suite should use the actual movement, chat, socket, meeting, and rendering paths. It may
use stable fixture setup APIs before recording, but must not fake the visible DOM. Camera movement
uses the existing homepage pointer parallax and office OrbitControls through browser pointer and
wheel input. A development-only camera hook is allowed only if browser input cannot make the shot
repeatable; it must be absent from production builds unless the explicit capture flag is enabled.

## Storyboards

### 1. Morning Commute

- Start on the complete `DeskRPG for Hermes` homepage composition.
- Use slow pointer parallax to reveal depth, then move attention toward the street and entrance.
- Hold long enough to see six vehicles across both directions, a stop/restart moment, walking
  characters, modeled trees, foliage motion, and morning light.
- Return close enough to the opening composition for a calm loop.

### 2. Walk & Report

- Start with a wide oblique view of the 3D office and visible map UI.
- Orbit gently and zoom toward the user and one working NPC.
- Trigger the real NPC call/report movement so the NPC leaves its place and walks to the user.
- End on the arrival/report state with both characters readable in frame.

### 3. Small Talk & Live Chat

- Start with the user and NPC already framed at conversational distance.
- Open the real map chat and send a short mention through the normal UI.
- Show the queued, thinking, streaming, and completed response states without long dead time.
- Keep both the character reaction and chat panel legible throughout the close shot.

### 4. AI Meeting

- Start with an oblique whole-table meeting view, then make a restrained orbit/zoom move.
- Show the participant configuration briefly and start a seeded two-NPC meeting.
- Display at least one visible speaker transition and two distinct NPC turns.
- End with the active meeting UI rather than waiting for a long summary step.

## README Changes

- Keep a 16:9 static homepage poster at the top so the repository has an immediate, lightweight
  hero image.
- Replace the current 16:10 GIF grid with the four new 16:9 GIFs in a two-by-two table.
- Use captions that describe outcomes rather than generic screen names:
  - Morning Commute / 아침 출근길
  - Walk Over and Report / 걸어와서 보고하기
  - Live Small Talk / 실시간 스몰토크
  - Agent Meeting / 에이전트 회의
- Change the website line from planned/preparing to live.
- Remove Map Editor from the list of currently available capabilities.
- Retain a short `Map Editor — Coming Later` product-note entry in both languages.
- Do not change package version strings or release links as part of this media task.
- Remove the four superseded GIF files after the new README links and checks pass. Git history keeps
  them recoverable.

## Safety and Failure Handling

- Bind the app and mock gateway to loopback only.
- Use a task-specific temporary runtime directory; never point capture scripts at `~/.deskrpg` or
  the production database.
- Do not read or export production cookies, API keys, Hermes profile keys, or user conversations.
- Stop capture when a required visual state or selector does not appear within its deadline.
- Preserve failed raw recordings, screenshots, and logs under an ignored artifact directory.
- Do not overwrite committed media until all four candidate GIFs pass technical validation.

## Verification

- Run the capture suite and assert each scenario reaches its required visible states.
- Use FFprobe to assert four GIFs are 960×540, 12 fps, 8–10 seconds, and at most 10 MB.
- Extract first, middle, and final frames from every GIF into a contact sheet for visual review.
- Inspect all four GIFs for camera smoothness, text legibility, loop quality, palette banding, and
  accidental personal data.
- Verify all README media paths exist and the English/Korean captions and availability claims agree.
- Run Markdown formatting or repository formatting checks that apply to the two README files.
- Run the focused capture-tool tests plus the normal typecheck/lint checks for changed TypeScript.

## Acceptance Criteria

- Four distinct 16:9 animations tell the homepage, report, chat, and meeting stories without manual
  intervention.
- A fresh local capture run can recreate the assets without live Hermes or production data.
- The movement shown in each GIF is real application behavior, not a composited mockup.
- The README no longer advertises Map Editor as currently available.
- The committed media stays within the agreed size ceiling and remains readable in GitHub's
  two-column README layout.
- No npm publish, GitHub Release, or production deployment occurs during this task.
