# README Cinematic GIFs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a reproducible, local-only capture pipeline that produces four polished 16:9 README GIFs for DeskRPG and updates the English and Korean README copy.

**Architecture:** A localhost mock Hermes server and isolated SQLite runtime drive the real DeskRPG APIs, socket flows, movement, chat, meeting UI, and Three.js renderer. Playwright records deterministic browser sessions and writes trim markers; a typed FFmpeg wrapper trims the raw recordings, encodes MP4 masters and palette-optimized GIFs, creates a poster/contact sheet, and validates every committed asset.

**Tech Stack:** TypeScript, Node.js `node:http`, `better-sqlite3`, Playwright, Next.js/Socket.IO, Three.js/OrbitControls, FFmpeg/FFprobe, Markdown.

**Spec:** `docs/superpowers/specs/2026-09-14-readme-cinematic-gifs-design.md`

## Global Constraints

- Capture viewport is exactly 1280×720 at 30 fps.
- README GIFs are exactly 960×540 at 12 fps, loop forever, last 8–10 seconds, and are no larger than 10 MB each.
- Committed GIF names are `deskrpg-home-commute.gif`, `deskrpg-walk-report.gif`, `deskrpg-small-talk.gif`, and `deskrpg-ai-meeting.gif` under `public/readme/`.
- Capture uses only loopback services, a task-specific runtime directory, deterministic fixtures, and no production credentials or conversations.
- Visible behavior must use real DeskRPG UI, movement, chat, socket, meeting, and rendering paths; do not replace visible DOM with mocks.
- Keep an updated 16:9 static homepage poster at `public/readme/home-screenshot.png`.
- Update `README.md` and `README.ko.md` together; Map Editor is `Coming Later`, not a current capability.
- Do not change package versions, publish npm, create a GitHub Release, or deploy production.
- Store raw recordings, MP4 masters, logs, timing files, and contact sheets under ignored `.artifacts/readme-capture/`.

## File Map

- `scripts/readme-capture/contracts.ts` — shared scene names, media constraints, artifact paths, and probe validation.
- `scripts/readme-capture/contracts.test.ts` — pure contract tests for scene coverage and media limits.
- `scripts/readme-capture/mock-hermes.ts` — localhost Hermes-compatible capabilities, session, chat-stream, run, and run-events endpoints.
- `scripts/readme-capture/mock-hermes.test.ts` — protocol and deterministic SSE timing tests.
- `scripts/readme-capture/fixture.ts` — prepares an isolated user, character, office channel, gateway profiles, NPCs, pending report, and meeting state through real local APIs.
- `scripts/readme-capture/fixture.test.ts` — fixture request order, loopback, and idempotency tests.
- `scripts/readme-capture/session.ts` — starts/stops the mock gateway and DeskRPG process, owns ports/runtime paths, and writes a fixture manifest.
- `scripts/readme-capture/session.test.ts` — process lifecycle and safe-path tests with injected spawn/fetch functions.
- `scripts/readme-capture/capture-helpers.ts` — login, channel entry, trim markers, smooth pointer paths, orbit drag, zoom, and scene assertions.
- `scripts/readme-capture/capture.spec.ts` — four Playwright recording scenarios.
- `playwright.readme-capture.config.ts` — 1280×720, 30 fps raw WebM capture settings and serial execution.
- `scripts/readme-capture/media.ts` — FFmpeg/FFprobe command construction, trim, MP4/GIF/poster/contact-sheet output, and validation report.
- `scripts/readme-capture/media.test.ts` — command and metadata validation tests without encoding large media.
- `scripts/readme-capture/verify-readme.ts` — checks asset existence, dimensions, durations, sizes, captions, and English/Korean availability claims.
- `scripts/readme-capture/verify-readme.test.ts` — README verification tests using temporary fixtures.
- `package.json` — `capture:readme`, `capture:readme:record`, `capture:readme:media`, and `capture:readme:verify` scripts.
- `README.md`, `README.ko.md` — hero, four-scene grid, live website status, current capabilities, and Map Editor availability.
- `public/readme/*.gif`, `public/readme/home-screenshot.png` — final committed media; remove the four superseded GIFs after replacement passes.

---

### Task 1: Lock the capture and media contract

**Files:**
- Create: `scripts/readme-capture/contracts.ts`
- Create: `scripts/readme-capture/contracts.test.ts`
- Modify: `package.json`

**Interfaces:**
- Produces: `SCENES`, `MEDIA_SPEC`, `capturePaths(root, scene)`, `validateProbe(scene, probe, bytes)`.
- Consumes: no capture-specific code.

- [ ] **Step 1: Write the failing contract tests**

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { MEDIA_SPEC, SCENES, capturePaths, validateProbe } from "./contracts";

test("declares exactly the four approved README scenes", () => {
  assert.deepEqual(SCENES, ["home-commute", "walk-report", "small-talk", "ai-meeting"]);
});

test("builds committed and ignored paths separately", () => {
  const paths = capturePaths("/repo", "small-talk");
  assert.equal(paths.gif, "/repo/public/readme/deskrpg-small-talk.gif");
  assert.equal(paths.master, "/repo/.artifacts/readme-capture/masters/small-talk.mp4");
});

test("rejects media outside the approved dimensions, duration and size", () => {
  assert.throws(() =>
    validateProbe("ai-meeting", { width: 960, height: 500, fps: 12, duration: 9 }, 1_000),
  );
  assert.doesNotThrow(() =>
    validateProbe(
      "ai-meeting",
      { width: MEDIA_SPEC.gif.width, height: MEDIA_SPEC.gif.height, fps: 12, duration: 9 },
      8_000_000,
    ),
  );
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npx tsx --test scripts/readme-capture/contracts.test.ts`

Expected: FAIL because `./contracts` does not exist.

- [ ] **Step 3: Implement the typed contract**

```ts
import path from "node:path";

export const SCENES = ["home-commute", "walk-report", "small-talk", "ai-meeting"] as const;
export type CaptureScene = (typeof SCENES)[number];

export const MEDIA_SPEC = {
  recording: { width: 1280, height: 720, fps: 30 },
  gif: { width: 960, height: 540, fps: 12, minSeconds: 8, maxSeconds: 10, maxBytes: 10_000_000 },
} as const;

export type VideoProbe = { width: number; height: number; fps: number; duration: number };

export function capturePaths(root: string, scene: CaptureScene) {
  const artifact = path.join(root, ".artifacts/readme-capture");
  return {
    gif: path.join(root, "public/readme", `deskrpg-${scene}.gif`),
    master: path.join(artifact, "masters", `${scene}.mp4`),
    timing: path.join(artifact, "timings", `${scene}.json`),
  };
}

export function validateProbe(scene: CaptureScene, probe: VideoProbe, bytes: number): void {
  const expected = MEDIA_SPEC.gif;
  if (probe.width !== expected.width || probe.height !== expected.height)
    throw new Error(`${scene}: expected ${expected.width}x${expected.height}`);
  if (Math.abs(probe.fps - expected.fps) > 0.01) throw new Error(`${scene}: expected 12 fps`);
  if (probe.duration < expected.minSeconds || probe.duration > expected.maxSeconds)
    throw new Error(`${scene}: duration ${probe.duration} is outside 8-10 seconds`);
  if (bytes > expected.maxBytes) throw new Error(`${scene}: ${bytes} exceeds 10 MB`);
}
```

- [ ] **Step 4: Add the initial package scripts**

```json
{
  "capture:readme": "tsx scripts/readme-capture/session.ts",
  "capture:readme:record": "playwright test --config playwright.readme-capture.config.ts",
  "capture:readme:media": "tsx scripts/readme-capture/media.ts",
  "capture:readme:verify": "tsx scripts/readme-capture/verify-readme.ts"
}
```

- [ ] **Step 5: Run the focused test and typecheck**

Run: `npx tsx --test scripts/readme-capture/contracts.test.ts && npm run typecheck`

Expected: PASS.

- [ ] **Step 6: Commit the contract**

```bash
git add package.json scripts/readme-capture/contracts.ts scripts/readme-capture/contracts.test.ts
git commit -m "test(readme): define cinematic capture contract"
```

---

### Task 2: Build a deterministic localhost Hermes double

**Files:**
- Create: `scripts/readme-capture/mock-hermes.ts`
- Create: `scripts/readme-capture/mock-hermes.test.ts`

**Interfaces:**
- Produces: `startMockHermes({ host, port }): Promise<{ baseUrl: string; close(): Promise<void> }>`.
- Produces the real client endpoints `/p/:profile/v1/capabilities`, `/p/:profile/api/sessions`, `/p/:profile/api/sessions/:id/chat/stream`, `/p/:profile/v1/runs`, and `/p/:profile/v1/runs/:id/events`.
- Consumes: `HermesClient` wire shapes documented by `src/lib/hermes/hermes-client.ts`.

- [ ] **Step 1: Write failing protocol tests**

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { createSseParser } from "../../src/lib/hermes/sse";
import { startMockHermes } from "./mock-hermes";

test("serves profile capabilities and deterministic session chat SSE", async (t) => {
  const server = await startMockHermes({ host: "127.0.0.1", port: 0 });
  t.after(() => server.close());
  const headers = { Authorization: "Bearer readme-capture-sophie-token", "Content-Type": "application/json" };
  const caps = await fetch(`${server.baseUrl}/p/sophie/v1/capabilities`, { headers });
  assert.equal(caps.status, 200);
  const session = await fetch(`${server.baseUrl}/p/sophie/api/sessions`, {
    method: "POST", headers, body: JSON.stringify({ title: "readme" }),
  }).then((response) => response.json() as Promise<{ session: { id: string } }>);
  const stream = await fetch(`${server.baseUrl}/p/sophie/api/sessions/${session.session.id}/chat/stream`, {
    method: "POST", headers, body: JSON.stringify({ message: "좋은 아침이에요" }),
  }).then((response) => response.text());
  const parser = createSseParser();
  const events = parser.push(stream);
  assert.ok(events.some((event) => event.event === "assistant.delta"));
  assert.equal(events.at(-1)?.event, "run.completed");
});
```

- [ ] **Step 2: Run the protocol test and verify it fails**

Run: `npx tsx --test scripts/readme-capture/mock-hermes.test.ts`

Expected: FAIL because `startMockHermes` is undefined.

- [ ] **Step 3: Implement the server and paced SSE writer**

Use `node:http`, reject non-loopback hosts at startup, accept only the three fixed capture tokens
(`readme-capture-gateway-token`, `readme-capture-sophie-token`, and
`readme-capture-noah-token`), and route by method/path. Export this timing helper so its sequence is
testable:

```ts
export const CHAT_SCRIPT = ["좋은 ", "아침이에요. ", "오늘 일정부터 함께 확인할게요."];

async function writeSse(
  response: import("node:http").ServerResponse,
  eventName: "assistant" | "message",
  chunks: string[],
) {
  response.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
  for (const [index, delta] of chunks.entries()) {
    response.write(`event: ${eventName}.delta\ndata: ${JSON.stringify({ delta, seq: index + 1 })}\n\n`);
    await new Promise((resolve) => setTimeout(resolve, 350));
  }
  response.write(`event: ${eventName}.completed\ndata: ${JSON.stringify({ content: chunks.join("") })}\n\n`);
  response.end(`event: run.completed\ndata: {}\n\n`);
}
```

The runs endpoint alternates fixed meeting responses by profile:

```ts
const MEETING_LINES = {
  sophie: "SPEAK: 오전에는 릴리스 점검부터 진행하겠습니다.",
  noah: "SPEAK: 저는 사용자 피드백을 정리해 공유하겠습니다.",
} as const;
```

- [ ] **Step 4: Test authentication, session dialect, and run dialect**

Add cases asserting `401` without the fixed token, `assistant.delta` for session chat,
`message.delta` for run events, unique session/run IDs, and that repeated runs remain deterministic.

Run: `npx tsx --test scripts/readme-capture/mock-hermes.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit the mock gateway**

```bash
git add scripts/readme-capture/mock-hermes.ts scripts/readme-capture/mock-hermes.test.ts
git commit -m "test(readme): add deterministic Hermes capture server"
```

---

### Task 3: Create and manage the isolated capture runtime

**Files:**
- Create: `scripts/readme-capture/fixture.ts`
- Create: `scripts/readme-capture/fixture.test.ts`
- Create: `scripts/readme-capture/session.ts`
- Create: `scripts/readme-capture/session.test.ts`

**Interfaces:**
- Produces: `prepareFixture(api, gatewayBaseUrl, sqlitePath): Promise<CaptureFixture>`.
- Produces: `CaptureFixture = { loginId; password; characterName; channelId; npcNames; profileNames }`.
- Produces: `runCaptureSession(deps?): Promise<void>` which owns child processes and cleanup.
- Consumes: `startMockHermes`, real local DeskRPG REST endpoints, and `.artifacts/readme-capture/runtime`.

Define the fixture client as a small authenticated HTTP boundary rather than coupling fixture logic
to Playwright:

```ts
export type FixtureApi = {
  request<T>(method: "GET" | "POST" | "PUT", path: string, body?: unknown): Promise<T>;
};
```

- [ ] **Step 1: Write failing fixture tests around an injected API client**

```ts
test("creates a user, character, channel, gateway, profiles and NPCs in dependency order", async () => {
  const calls: string[] = [];
  // The local helper returns fixed IDs for each requested resource and appends its logical name.
  const api = recordingFixtureApi(calls);
  const fixture = await prepareFixture(api, "http://127.0.0.1:38642", "/repo/.artifacts/readme-capture/runtime/data/db.sqlite");
  assert.deepEqual(calls, ["register", "character", "gateway", "profile:sophie", "profile:noah", "group", "template", "channel", "roster", "report"]);
  assert.equal(fixture.npcNames.length, 2);
});

test("refuses non-loopback app and gateway URLs", async () => {
  await assert.rejects(() =>
    prepareFixture(recordingFixtureApi([]), "https://deskrpg.com", "/repo/.artifacts/readme-capture/runtime/data/db.sqlite"),
    /loopback/,
  );
});
```

- [ ] **Step 2: Run tests and verify they fail**

Run: `npx tsx --test scripts/readme-capture/fixture.test.ts scripts/readme-capture/session.test.ts`

Expected: FAIL because fixture/session modules do not exist.

In `fixture.test.ts`, define `recordingFixtureApi(calls): FixtureApi` next to the tests. Its
`request()` switch returns fixed user, character, channel, gateway, profile, and NPC IDs and records
the logical operation derived from method/path; any unlisted request throws. This keeps the unit
test independent of a running Next server.

- [ ] **Step 3: Implement API-driven fixture preparation**

Use fixed display values but accept generated IDs from the actual APIs:

```ts
export const CAPTURE_ACCOUNT = {
  loginId: "readme-capture",
  nickname: "Dante",
  password: "readme-capture-local-only",
} as const;

export type CaptureFixture = {
  loginId: string;
  password: string;
  characterName: string;
  channelId: string;
  npcNames: ["Sophie", "Noah"];
  profileNames: ["sophie", "noah"];
};
```

`prepareFixture` uses these exact real API operations in order:

| Operation | Request | Required body/result |
| --- | --- | --- |
| Register | `POST /api/auth/register` | `CAPTURE_ACCOUNT`; retain the response cookie and `user.id` |
| Character | `POST /api/characters` | `{ name: "Dante", appearance: OFFICE_LOOKS[0].appearance }`; retain `character.id` |
| Gateway | `POST /api/gateways` | `{ url: gatewayBaseUrl, token: "readme-capture-gateway-token", displayName: "README Capture" }`; retain `gateway.id` |
| Profiles | `POST /api/gateways/:id/profiles` twice | `{ profileName: "sophie"/"noah", token: the matching fixed profile token, displayName: "Sophie"/"Noah" }` |
| Group | `GET /api/groups` | choose the returned default group and retain `group.id` |
| Template | `GET /api/map-templates` | choose the built-in trading-company template and retain its ID |
| Channel | `POST /api/channels` | `{ name: "Dante Labs Office", description: "Hermes agents at work", isPublic: true, mapTemplateId, groupId, gatewayConfig: { gatewayId } }`; retain `channel.id` |
| Roster | `GET /api/npcs?channelId=:id&roster=1` | channel creation calls `hireGatewayProfilesIntoChannel`; retain the generated Sophie/Noah NPC IDs and placements |

Because profiles are registered before the bound channel is created, the real channel creation path hires and
places both NPCs; there is no `POST /api/npcs` route. After the API records exist, open only the
supplied isolated SQLite path and insert one completed `tasks` row plus one `npc_reports` row with
`status='pending'`, using the generated channel, character, NPC, and user IDs. Close the SQLite
handle immediately. Treat an existing fixed login as success so interrupted capture runs can resume.

- [ ] **Step 4: Implement lifecycle ownership with injected process functions**

```ts
export type SessionDeps = {
  spawn: typeof import("node:child_process").spawn;
  fetch: typeof globalThis.fetch;
  root: string;
};

export async function runCaptureSession(deps: Partial<SessionDeps> = {}): Promise<void> {
  // Resolve root, assert the runtime is below root/.artifacts/readme-capture,
  // start mock Hermes, start DeskRPG with DB_TYPE=sqlite and capture-only secrets,
  // wait for /api/auth/status, prepare fixtures, spawn capture:readme:record,
  // then capture:readme:media and capture:readme:verify.
  // In finally, terminate only the two child processes created by this invocation.
}
```

Set `DESKRPG_HOME`, `SQLITE_PATH`, `DB_TYPE=sqlite`, `JWT_SECRET`, `COMING_SOON=false`,
`NEXT_PUBLIC_COMING_SOON=false`, `PORT=3310`, and `INTERNAL_PORT=3311` explicitly for the child. Bind
the mock gateway to `127.0.0.1:38642`. Never inherit `DATABASE_URL`.

- [ ] **Step 5: Verify lifecycle failure cleanup and idempotency**

Tests must assert that a failed health check terminates owned children, an outside-artifacts runtime
path is rejected, a second fixture run returns the same channel, and production URLs are rejected.

Run: `npx tsx --test scripts/readme-capture/fixture.test.ts scripts/readme-capture/session.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit the isolated runtime**

```bash
git add scripts/readme-capture/fixture.ts scripts/readme-capture/fixture.test.ts scripts/readme-capture/session.ts scripts/readme-capture/session.test.ts
git commit -m "feat(readme): add isolated cinematic demo runtime"
```

---

### Task 4: Record the four real UI stories

**Files:**
- Create: `playwright.readme-capture.config.ts`
- Create: `scripts/readme-capture/capture-helpers.ts`
- Create: `scripts/readme-capture/capture.spec.ts`

**Interfaces:**
- Produces: one raw WebM and one `{ startMs, endMs }` timing JSON per `CaptureScene`.
- Produces: `readFixture(): Promise<CaptureFixture>`,
  `prepareScene(page, scene, fixture): Promise<void>`,
  `markClip(page, scene, action): Promise<void>`, `orbit(page, pixels, durationMs)`,
  `zoom(page, deltaY, steps)`, and `enterCaptureOffice(page, fixture)`.
- Consumes: fixture manifest from Task 3 and paths/contracts from Task 1.

- [ ] **Step 1: Add a failing dry-run test for the four scenario contracts**

Each Playwright test begins by reading the fixture manifest and checking its scene prerequisites.
Run with `README_CAPTURE_DRY_RUN=1` so it stops after readiness assertions:

```ts
for (const scene of SCENES) {
  test(`${scene} fixture is recordable`, async ({ page }) => {
    const fixture = await readFixture();
    await prepareScene(page, scene, fixture);
    await expect(page.locator(scene === "home-commute" ? ".commute-canvas" : ".office-three-canvas"))
      .toBeVisible();
  });
}
```

Run: `README_CAPTURE_DRY_RUN=1 npm run capture:readme:record`

Expected: FAIL because the config/helpers/spec do not exist.

- [ ] **Step 2: Configure one serial video per test**

```ts
export default defineConfig({
  testDir: "./scripts/readme-capture",
  testMatch: "capture.spec.ts",
  workers: 1,
  fullyParallel: false,
  timeout: 120_000,
  use: {
    baseURL: "http://127.0.0.1:3310",
    channel: "chrome",
    headless: true,
    viewport: { width: 1280, height: 720 },
    video: { mode: "on", size: { width: 1280, height: 720 } },
    locale: "ko-KR",
  },
  outputDir: ".artifacts/readme-capture/raw",
});
```

- [ ] **Step 3: Implement deterministic camera and trim helpers**

`markClip` records `performance.timeOrigin + performance.now()` at start and end. `orbit` performs a
right-button drag on `.office-three-canvas canvas`; `zoom` emits evenly spaced wheel input; homepage
parallax uses a 60-step pointer path across `.commute-canvas`. Every camera move uses linear time
steps rather than CSS/DOM replacement.

```ts
export async function orbit(page: Page, dx: number, durationMs: number) {
  const canvas = page.locator(".office-three-canvas canvas");
  const box = await canvas.boundingBox();
  if (!box) throw new Error("3D canvas has no bounds");
  const start = { x: box.x + box.width * 0.6, y: box.y + box.height * 0.45 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down({ button: "right" });
  await page.mouse.move(start.x + dx, start.y, { steps: Math.max(24, durationMs / 33) });
  await page.mouse.up({ button: "right" });
}
```

- [ ] **Step 4: Implement the four 8–10 second scenarios**

- `home-commute`: wait for all homepage GLBs and six vehicles; mark start; make a slow parallax arc;
  assert both lanes moved and at least one vehicle stopped/restarted; mark end at 9 seconds.
- `walk-report`: enter the office, click Overview, orbit/zoom, expose the seeded pending report,
  assert `npc:call-to-player` movement and arrival/report UI, then mark end at 9 seconds.
- `small-talk`: frame the user and Sophie, open map chat, submit `@Sophie 좋은 아침이에요`, assert
  queued → thinking → streaming → done in order, and mark end after the final bubble at 8–10 seconds.
- `ai-meeting`: open Meeting, configure Sophie/Noah, start topic `오늘의 우선순위를 정해요`, assert
  two different `data-sender` values and a visible speaker transition, and mark end at 8–10 seconds.

The scenario may wait before `markClip(start)`; all visible action after the marker must fit inside the
duration contract. Copy each Playwright-generated WebM to the scene's stable raw path after the test.

- [ ] **Step 5: Run dry-run then full recording**

Run: `README_CAPTURE_DRY_RUN=1 npm run capture:readme:record`

Expected: 4 passed with all scene readiness assertions.

Run: `npm run capture:readme:record`

Expected: 4 passed; four raw WebMs and four timing JSON files exist.

- [ ] **Step 6: Commit the recording harness**

```bash
git add playwright.readme-capture.config.ts scripts/readme-capture/capture-helpers.ts scripts/readme-capture/capture.spec.ts
git commit -m "feat(readme): record four cinematic product stories"
```

---

### Task 5: Encode and validate GIFs, masters, poster and contact sheet

**Files:**
- Create: `scripts/readme-capture/media.ts`
- Create: `scripts/readme-capture/media.test.ts`

**Interfaces:**
- Produces: `gifArgs(input, timing, palette, output)`, `probeMedia(path)`,
  `encodeScene(scene)`, and `buildContactSheet()`.
- Consumes: raw recordings/timing files from Task 4 and media contract from Task 1.

- [ ] **Step 1: Write failing command and probe tests**

```ts
test("uses trim, 12 fps, 960x540 and two-pass palette GIF encoding", () => {
  const args = gifArgs("raw.webm", { startSeconds: 12.25, durationSeconds: 9 }, "palette.png", "out.gif");
  assert.ok(args.join(" ").includes("trim=start=12.25:duration=9"));
  assert.ok(args.join(" ").includes("fps=12,scale=960:540"));
  assert.ok(args.join(" ").includes("paletteuse"));
});

test("rejects an 11 MB candidate before replacing committed media", () => {
  assert.throws(() => validateProbe("small-talk", { width: 960, height: 540, fps: 12, duration: 9 }, 11_000_000));
});
```

- [ ] **Step 2: Run and verify failure**

Run: `npx tsx --test scripts/readme-capture/media.test.ts`

Expected: FAIL because media functions do not exist.

- [ ] **Step 3: Implement safe FFmpeg execution**

Use `execFileSync("ffmpeg", args)` and `execFileSync("ffprobe", args)`; never interpolate paths into
a shell. For each scene:

1. Trim to the timing marker and normalize a 1280×720 H.264 MP4 master using
   `-c:v libx264 -crf 18 -preset slow -pix_fmt yuv420p -movflags +faststart`.
2. Generate a palette from `fps=12,scale=960:540:flags=lanczos` with
   `palettegen=max_colors=192:stats_mode=diff`.
3. Encode the candidate with `paletteuse=dither=sierra2_4a:diff_mode=rectangle -loop 0`.
4. Probe and validate every candidate under `.artifacts/readme-capture/candidates/`.
5. Extract the first home-commute frame as a 1280×720 PNG poster.
6. Extract first/middle/final frames from every GIF and tile them into a 3×4 contact sheet under
   `.artifacts/readme-capture/contact-sheet.png`.
7. Only after all four candidates and the poster pass validation, replace the committed media as one
   batch using same-filesystem temporary names followed by atomic renames.

- [ ] **Step 4: Add adaptive palette fallback without weakening dimensions**

If a candidate is over 10 MB, retry in this exact order: `max_colors=160`, then `128`, then `96`.
Keep 960×540, 12 fps, and 8–10 seconds fixed. Throw with the final measured size if all four palettes
exceed the limit; do not write an oversized committed GIF.

- [ ] **Step 5: Run unit tests and encode all scenes**

Run: `npx tsx --test scripts/readme-capture/media.test.ts && npm run capture:readme:media`

Expected: tests pass; four MP4 masters, four validated GIFs, poster, probe report, and contact sheet
exist.

- [ ] **Step 6: Visually inspect the contact sheet and animated candidates**

Open `.artifacts/readme-capture/contact-sheet.png`, then all four GIFs. Check smooth camera motion,
legible UI, distinct characters, no clipped panels, no personal data, no severe palette banding,
and a calm loop boundary. If a scene fails, adjust only its scenario/timing and rebuild it.

- [ ] **Step 7: Commit encoder code and new media**

```bash
git add scripts/readme-capture/media.ts scripts/readme-capture/media.test.ts \
  public/readme/deskrpg-home-commute.gif public/readme/deskrpg-walk-report.gif \
  public/readme/deskrpg-small-talk.gif public/readme/deskrpg-ai-meeting.gif \
  public/readme/home-screenshot.png
git commit -m "docs: add four cinematic DeskRPG animations"
```

---

### Task 6: Rewrite the README media story and retire superseded GIFs

**Files:**
- Create: `scripts/readme-capture/verify-readme.ts`
- Create: `scripts/readme-capture/verify-readme.test.ts`
- Modify: `README.md`
- Modify: `README.ko.md`
- Delete: `public/readme/deskrpg-login-to-office.gif`
- Delete: `public/readme/deskrpg-npc-task-loop.gif`
- Delete: `public/readme/deskrpg-meeting-room.gif`
- Delete: `public/readme/deskrpg-map-editor.gif`

**Interfaces:**
- Produces: `verifyReadmes(root, probeMediaOverride?): Promise<void>` and CLI exit status 0/1.
- Consumes: four committed GIFs and poster from Task 5.

- [ ] **Step 1: Write failing README verifier tests**

```ts
test("requires the four approved captions and forbids current Map Editor claims", async () => {
  const root = await makeReadmeFixture({
    english: "Morning Commute\nWalk Over and Report\nLive Small Talk\nAgent Meeting\nMap Editor — Coming Later",
    korean: "아침 출근길\n걸어와서 보고하기\n실시간 스몰토크\n에이전트 회의\n맵 에디터 — 추후 제공",
  });
  await assert.doesNotReject(() => verifyReadmes(root));
});
```

Add negative cases for a missing GIF, mismatched English/Korean image paths, `Website: planned`, and
the current-capability sentence `Build or upload your own office maps`.
Define `makeReadmeFixture({ english, korean })` in the test file with `mkdtemp`, write the two README
strings and four tiny stub files under `public/readme/`, and inject a probe function into
`verifyReadmes` so this unit test does not invoke FFprobe.

- [ ] **Step 2: Run and verify failure**

Run: `npx tsx --test scripts/readme-capture/verify-readme.test.ts`

Expected: FAIL because `verifyReadmes` does not exist.

- [ ] **Step 3: Implement the verifier**

Read both files, extract `public/readme/...` image paths, assert the same ordered four GIF paths,
assert the approved English/Korean captions, assert `https://deskrpg.com` is marked live, and reject
current Map Editor capability wording. Call `probeMedia` and `validateProbe` for every GIF.

- [ ] **Step 4: Update the English and Korean README files**

Use the 16:9 poster as the hero. Replace the screenshot table with the four approved GIFs and
outcome captions. Change the website status to live. Remove Map Editor from `What You Can Do` /
`무엇을 할 수 있나요`. Replace the `How DeskRPG Works` Map Editor section with:

```md
### Map Editor — Coming Later

The browser map editor is being prepared for a later release. It is not part of the current public workflow.
```

and:

```md
### 맵 에디터 — 추후 제공

브라우저 맵 에디터는 이후 릴리스를 위해 준비 중이며, 현재 공개 워크플로에는 포함되지 않습니다.
```

Do not change the version line or Hostinger tag URL.

- [ ] **Step 5: Verify before deleting old media**

Run: `npm run capture:readme:verify && npx prettier --check README.md README.ko.md`

Expected: PASS with all new paths present and media constraints satisfied.

- [ ] **Step 6: Remove the four superseded GIFs and re-run verification**

Remove only the four files listed in this task. They remain recoverable from Git history.

Run:

```bash
git rm public/readme/deskrpg-login-to-office.gif \
  public/readme/deskrpg-npc-task-loop.gif \
  public/readme/deskrpg-meeting-room.gif \
  public/readme/deskrpg-map-editor.gif
```

Run: `npm run capture:readme:verify && rg -n 'deskrpg-(login-to-office|npc-task-loop|meeting-room|map-editor)\.gif' README.md README.ko.md`

Expected: verifier passes and `rg` returns no matches.

- [ ] **Step 7: Commit README and cleanup**

```bash
git add README.md README.ko.md scripts/readme-capture/verify-readme.ts scripts/readme-capture/verify-readme.test.ts public/readme
git commit -m "docs: refresh README around the 3D Hermes office"
```

---

### Task 7: Run final reproducibility and repository verification

**Files:**
- Modify only files already named if verification reveals a defect.
- Preserve evidence under `.artifacts/readme-capture/final/`.

**Interfaces:**
- Consumes all previous task outputs.
- Produces a clean branch and final verification report; no publish or deployment side effects.

- [ ] **Step 1: Re-run the complete capture from a fresh runtime**

Run: `npm run capture:readme`

Expected: fresh isolated database, mock gateway, four passing scenarios, four regenerated GIFs,
poster/contact sheet, and verifier exit 0.

- [ ] **Step 2: Verify media metadata and GitHub-facing links**

Run: `npm run capture:readme:verify`

Expected report for each GIF: 960×540, 12 fps, 8–10 seconds, no file over 10 MB. All README image
paths resolve on disk and English/Korean paths match.

- [ ] **Step 3: Run code and formatting checks**

Run: `npx tsx --test scripts/readme-capture/*.test.ts && npm run typecheck && npm run lint && npm run format:check`

Expected: all commands exit 0.

- [ ] **Step 4: Review the final visual evidence**

Open `.artifacts/readme-capture/contact-sheet.png` and the four committed GIFs. Confirm the homepage
shows morning traffic/foliage, report shows actual walking/arrival, chat shows the full response
state sequence, meeting shows two distinct speakers, and no capture contains private data.

- [ ] **Step 5: Confirm scope and branch cleanliness**

Run:

```bash
git diff --check origin/master...HEAD
git status --short --branch
git log --oneline origin/master..HEAD
```

Expected: no whitespace errors, no uncommitted files, only README capture/design/plan commits, no
package version change, no release tag, and no deployment change.

- [ ] **Step 6: Commit any verification-only correction**

Only if Step 1–5 required a correction, stage the specific corrected files already named in their
owning task, inspect `git diff --cached`, and commit them with
`git commit -m "fix(readme): correct cinematic capture verification"`. Otherwise do not create an
empty commit.
