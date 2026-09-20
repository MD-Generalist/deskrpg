/**
 * 출근길 화면의 구름 그림을 다시 만든다 — `npx tsx scripts/sky/render-clouds.ts`.
 * 모델은 `src/game/three/sky-clouds.ts`. 결과 PNG 는 커밋한다(빌드는 이 스크립트를 돌리지 않는다).
 */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { chromium } from "@playwright/test";
import { build } from "esbuild";
import sharp from "sharp";

const ROOT = path.resolve(__dirname, "../..");
const RENDER = { width: 1600, height: 640 };
const OUT = { width: 640, height: 256 };

async function main() {
  const work = await mkdtemp(path.join(tmpdir(), "deskrpg-clouds-"));
  try {
    const bundle = path.join(work, "entry.js");
    await build({
      entryPoints: [path.join(ROOT, "scripts/sky/entry.ts")],
      outfile: bundle,
      bundle: true,
      format: "iife",
      platform: "browser",
      target: "es2022",
      logLevel: "silent",
    });
    await writeFile(path.join(work, "index.html"), "<!doctype html><title>clouds</title>");
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage();
      await page.goto(`file://${path.join(work, "index.html")}`);
      await page.addScriptTag({ path: bundle });
      for (const variant of [0, 1, 2] as const) {
        const dataUrl = await page.evaluate(
          ([v, w, h]) => window.renderCloud(v as 0 | 1 | 2, w as number, h as number),
          [variant, RENDER.width, RENDER.height] as const,
        );
        const file = `public/assets/brand/cloud-${variant + 1}.png`;
        // 살짝 흐리게 줄인다 — 구체 경계가 남으면 도형을 붙인 것처럼 보인다.
        await sharp(Buffer.from(dataUrl.split(",")[1], "base64"))
          .blur(3)
          .resize(OUT.width, OUT.height, { fit: "inside" })
          .png()
          .toFile(path.join(ROOT, file));
        process.stdout.write(`${file}\n`);
      }
    } finally {
      await browser.close();
    }
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

void main();
