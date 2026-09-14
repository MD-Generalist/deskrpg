import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SCENES, validateProbe, type CaptureScene, type VideoProbe } from "./contracts";
import { probeMedia } from "./media";

const GIF_PATHS = SCENES.map((scene) => `public/readme/deskrpg-${scene}.gif`);
const ENGLISH_CAPTIONS = [
  "Morning Commute",
  "Walk Over and Report",
  "Live Small Talk",
  "Agent Meeting",
];
const KOREAN_CAPTIONS = ["아침 출근길", "걸어와서 보고하기", "실시간 스몰토크", "에이전트 회의"];
const CURRENT_MAP_EDITOR_CLAIMS = [
  /Build or upload your own office maps(?: with the browser-based map editor)?/i,
  /브라우저 맵 에디터로 오피스 맵을 직접 만들거나 올립니다/,
];

type ProbeMedia = (file: string) => VideoProbe;

function extractGifPaths(readme: string): string[] {
  return [...readme.matchAll(/public\/readme\/[^\s"')>]+\.gif/g)].map(([match]) => match);
}

function assertOrderedGifPaths(label: string, actual: string[]): void {
  if (
    actual.length !== GIF_PATHS.length ||
    actual.some((value, index) => value !== GIF_PATHS[index])
  )
    throw new Error(`${label} must use the approved ordered GIF paths`);
}

function assertCaptions(label: string, readme: string, captions: string[]): void {
  for (const caption of captions)
    if (!readme.includes(caption))
      throw new Error(`${label} is missing approved caption: ${caption}`);
}

export async function verifyReadmes(
  root: string,
  probeMediaOverride: ProbeMedia = probeMedia,
): Promise<void> {
  const [english, korean] = await Promise.all([
    fs.readFile(path.join(root, "README.md"), "utf8"),
    fs.readFile(path.join(root, "README.ko.md"), "utf8"),
  ]);

  const englishGifPaths = extractGifPaths(english);
  const koreanGifPaths = extractGifPaths(korean);
  assertOrderedGifPaths("README.md", englishGifPaths);
  assertOrderedGifPaths("README.ko.md", koreanGifPaths);
  if (englishGifPaths.some((value, index) => value !== koreanGifPaths[index]))
    throw new Error("README files must use matching ordered GIF paths");

  assertCaptions("README.md", english, ENGLISH_CAPTIONS);
  assertCaptions("README.ko.md", korean, KOREAN_CAPTIONS);

  if (!english.includes("Website: `https://deskrpg.com` (live)"))
    throw new Error("README.md must mark https://deskrpg.com as the live website");
  if (!korean.includes("웹사이트: `https://deskrpg.com` (운영 중)"))
    throw new Error("README.ko.md must mark https://deskrpg.com as the live website");
  if (CURRENT_MAP_EDITOR_CLAIMS.some((claim) => claim.test(english) || claim.test(korean)))
    throw new Error("Map Editor must not be presented as a current capability");
  if (!english.includes("Map Editor — Coming Later") || !korean.includes("맵 에디터 — 추후 제공"))
    throw new Error("Both README files must mark Map Editor as coming later");

  for (const [index, relativePath] of GIF_PATHS.entries()) {
    const file = path.join(root, relativePath);
    let bytes: number;
    try {
      bytes = (await fs.stat(file)).size;
    } catch {
      throw new Error(`Missing GIF: ${relativePath}`);
    }
    validateProbe(SCENES[index] as CaptureScene, probeMediaOverride(file), bytes);
  }
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  verifyReadmes(ROOT)
    .then(() => console.log("README media verification passed"))
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    });
}
