import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { VideoProbe } from "./contracts";
import { verifyReadmes } from "./verify-readme";

const GIFS = [
  "deskrpg-home-commute.gif",
  "deskrpg-walk-report.gif",
  "deskrpg-small-talk.gif",
  "deskrpg-ai-meeting.gif",
] as const;

const englishImages = GIFS.map(
  (file) => `<img src="public/readme/${file}" alt="story" width="100%" />`,
).join("\n");
const koreanImages = GIFS.map(
  (file) => `<img src="public/readme/${file}" alt="스토리" width="100%" />`,
).join("\n");

const validEnglish = `${englishImages}
Morning Commute
Walk Over and Report
Live Small Talk
Agent Meeting
- Website: \`https://deskrpg.com\` (live)
### Map Editor — Coming Later
The browser map editor is being prepared for a later release. It is not part of the current public workflow.
`;

const validKorean = `${koreanImages}
아침 출근길
걸어와서 보고하기
실시간 스몰토크
에이전트 회의
- 웹사이트: \`https://deskrpg.com\` (운영 중)
### 맵 에디터 — 추후 제공
브라우저 맵 에디터는 이후 릴리스를 위해 준비 중이며, 현재 공개 워크플로에는 포함되지 않습니다.
`;

const validProbe: VideoProbe = {
  width: 960,
  height: 540,
  fps: 12,
  duration: 9,
  loop: "forever",
};

async function makeReadmeFixture({
  english = validEnglish,
  korean = validKorean,
}: {
  english?: string;
  korean?: string;
} = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "deskrpg-readme-"));
  const media = path.join(root, "public/readme");
  await fs.mkdir(media, { recursive: true });
  await Promise.all([
    fs.writeFile(path.join(root, "README.md"), english),
    fs.writeFile(path.join(root, "README.ko.md"), korean),
    ...GIFS.map((file) => fs.writeFile(path.join(media, file), "stub")),
  ]);
  return root;
}

test("requires the four approved captions and forbids current Map Editor claims", async (t) => {
  const root = await makeReadmeFixture({
    english: validEnglish,
    korean: validKorean,
  });
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await assert.doesNotReject(() => verifyReadmes(root, () => validProbe));
});

test("rejects a missing committed GIF", async (t) => {
  const root = await makeReadmeFixture();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.rm(path.join(root, "public/readme/deskrpg-small-talk.gif"));
  await assert.rejects(() => verifyReadmes(root, () => validProbe), /missing GIF/i);
});

test("rejects mismatched English and Korean GIF paths", async (t) => {
  const root = await makeReadmeFixture({
    korean: validKorean.replace("deskrpg-ai-meeting.gif", "deskrpg-home-commute.gif"),
  });
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await assert.rejects(() => verifyReadmes(root, () => validProbe), /ordered GIF paths/i);
});

test("rejects a planned website status", async (t) => {
  const root = await makeReadmeFixture({
    english: validEnglish.replace("- Website: `https://deskrpg.com` (live)", "- Website: planned"),
  });
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await assert.rejects(() => verifyReadmes(root, () => validProbe), /live website/i);
});

test("rejects current Map Editor capability wording", async (t) => {
  const root = await makeReadmeFixture({
    english: `${validEnglish}\nBuild or upload your own office maps with the browser-based map editor.`,
  });
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await assert.rejects(() => verifyReadmes(root, () => validProbe), /Map Editor.*current/i);
});

test("probes every GIF and applies the media contract", async (t) => {
  const root = await makeReadmeFixture();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const probed: string[] = [];
  await verifyReadmes(root, (file) => {
    probed.push(path.basename(file));
    return validProbe;
  });
  assert.deepEqual(probed, [...GIFS]);
  await assert.rejects(
    () => verifyReadmes(root, () => ({ ...validProbe, width: 100 })),
    /expected 960x540/,
  );
});
