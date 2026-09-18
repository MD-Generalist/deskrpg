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
const POSTER = "home-screenshot.png";
const RETIRED_GIFS = [
  "deskrpg-login-to-office.gif",
  "deskrpg-npc-task-loop.gif",
  "deskrpg-meeting-room.gif",
  "deskrpg-map-editor.gif",
] as const;

const englishImages = GIFS.map(
  (file) => `<img src="public/readme/${file}" alt="story" width="100%" />`,
).join("\n");
const koreanImages = GIFS.map(
  (file) => `<img src="public/readme/${file}" alt="스토리" width="100%" />`,
).join("\n");

const validEnglish = `<img src="public/readme/${POSTER}" alt="DeskRPG home screen" width="100%" />
${englishImages}
Morning Commute
Call Them Over to Report
Live Small Talk
Agent Meeting
- Website: [https://deskrpg.com](https://deskrpg.com) (live)
`;

const validKorean = `<img src="public/readme/${POSTER}" alt="DeskRPG 홈 화면" width="100%" />
${koreanImages}
아침 출근길
호출하면 걸어와서 보고
실시간 스몰토크
에이전트 회의
- 웹사이트: [https://deskrpg.com](https://deskrpg.com) (운영 중)
`;

const validProbe: VideoProbe = {
  width: 960,
  height: 540,
  fps: 12,
  duration: 9,
  loop: "forever",
};

function validMediaProbe(file: string): VideoProbe {
  return path.basename(file) === POSTER ? { ...validProbe, width: 1280, height: 720 } : validProbe;
}

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
    fs.writeFile(path.join(media, POSTER), "stub"),
    ...GIFS.map((file) => fs.writeFile(path.join(media, file), "stub")),
  ]);
  return root;
}

test("requires the four approved captions and forbids any Map Editor mention", async (t) => {
  const root = await makeReadmeFixture({
    english: validEnglish,
    korean: validKorean,
  });
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await assert.doesNotReject(() => verifyReadmes(root, validMediaProbe));
});

test("rejects a missing committed GIF", async (t) => {
  const root = await makeReadmeFixture();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.rm(path.join(root, "public/readme/deskrpg-small-talk.gif"));
  await assert.rejects(() => verifyReadmes(root, validMediaProbe), /missing GIF/i);
});

test("rejects mismatched English and Korean GIF paths", async (t) => {
  const root = await makeReadmeFixture({
    korean: validKorean.replace("deskrpg-ai-meeting.gif", "deskrpg-home-commute.gif"),
  });
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await assert.rejects(() => verifyReadmes(root, validMediaProbe), /ordered GIF paths/i);
});

test("rejects a planned website status", async (t) => {
  const root = await makeReadmeFixture({
    english: validEnglish.replace(
      "- Website: [https://deskrpg.com](https://deskrpg.com) (live)",
      "- Website: planned",
    ),
  });
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await assert.rejects(() => verifyReadmes(root, validMediaProbe), /live website/i);
});

test("requires deskrpg.com to be a clickable live link in both READMEs", async (t) => {
  const root = await makeReadmeFixture({
    english: validEnglish.replace(
      "[https://deskrpg.com](https://deskrpg.com)",
      "`https://deskrpg.com`",
    ),
  });
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await assert.rejects(() => verifyReadmes(root, validMediaProbe), /clickable live website/i);
});

test("rejects any Map Editor mention", async (t) => {
  const root = await makeReadmeFixture({
    english: `${validEnglish}\nBuild or upload your own office maps with the browser-based map editor.`,
  });
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await assert.rejects(() => verifyReadmes(root, validMediaProbe), /must not mention/i);
});

test("rejects the Korean map upload claim", async (t) => {
  const root = await makeReadmeFixture({
    korean: `${validKorean}\n브라우저 맵 에디터로 오피스 맵을 직접 만들거나 올립니다.`,
  });
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await assert.rejects(() => verifyReadmes(root, validMediaProbe), /must not mention/i);
});

test("requires both READMEs to use the approved matching hero poster", async (t) => {
  const root = await makeReadmeFixture({
    korean: validKorean.replace(POSTER, "alternate-poster.png"),
  });
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await assert.rejects(() => verifyReadmes(root, validMediaProbe), /hero poster/i);
});

test("rejects a missing hero poster", async (t) => {
  const root = await makeReadmeFixture();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.rm(path.join(root, "public/readme", POSTER));
  await assert.rejects(() => verifyReadmes(root, validMediaProbe), /missing hero poster/i);
});

test("rejects a hero poster that is not 1280x720", async (t) => {
  const root = await makeReadmeFixture();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await assert.rejects(() => verifyReadmes(root, () => validProbe), /hero poster.*1280x720/i);
});

test("rejects every retired README GIF even when it is unreferenced", async (t) => {
  for (const retiredGif of RETIRED_GIFS) {
    await t.test(retiredGif, async (t) => {
      const root = await makeReadmeFixture();
      t.after(() => fs.rm(root, { recursive: true, force: true }));
      await fs.writeFile(path.join(root, "public/readme", retiredGif), "retired");
      await assert.rejects(() => verifyReadmes(root, validMediaProbe), /retired GIF/i);
    });
  }
});

test("probes the poster and every GIF and applies their media contracts", async (t) => {
  const root = await makeReadmeFixture();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const probed: string[] = [];
  await verifyReadmes(root, (file) => {
    probed.push(path.basename(file));
    return validMediaProbe(file);
  });
  assert.deepEqual(probed, [POSTER, ...GIFS]);
  await assert.rejects(
    () =>
      verifyReadmes(root, (file) =>
        path.basename(file) === "deskrpg-small-talk.gif"
          ? { ...validProbe, width: 100 }
          : validMediaProbe(file),
      ),
    /expected 960x540/,
  );
});
