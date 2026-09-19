/**
 * 브랜드 마크 그림을 다시 만든다 — `npx tsx scripts/brand-mark/render.ts`.
 *
 * 사이드바 본사와 같은 three.js 모델을 헤드리스 Chromium 에서 한 번 렌더해 PNG 로 굽는다.
 * 화면에서 매번 WebGL 을 켜지 않아도 되고, 16px 파비콘까지 같은 그림에서 나온다.
 * 결과물은 저장소에 커밋한다 — 빌드는 이 스크립트를 돌리지 않는다.
 */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { build } from "esbuild";
import { chromium } from "@playwright/test";
import sharp from "sharp";

import { packIco } from "./ico";
import { simpleMarkSvg } from "./simple-mark";

const ROOT = path.resolve(__dirname, "../..");
/** 굽는 것들. 투명 배경은 사이드바·워드마크용, 크림 배경은 앱 아이콘용이다. */
const OUTPUTS = [
  { file: "public/assets/brand/deskrpg-mark-3d-512.png", size: 512, background: undefined },
  { file: "public/icon-192.png", size: 192, background: "#f3eee2" },
  { file: "public/icon-512.png", size: 512, background: "#f3eee2" },
  { file: "public/apple-icon.png", size: 180, background: "#f3eee2" },
];
const RENDER_SIZE = 1024;
/** 탭 아이콘은 3D 가 뭉개져 단순형을 쓴다(2026-09-20 단테 결정). */
const FAVICON_SIZES = [16, 32, 48, 64];

async function main() {
  const work = await mkdtemp(path.join(tmpdir(), "deskrpg-brand-mark-"));
  try {
    const bundle = path.join(work, "entry.js");
    await build({
      entryPoints: [path.join(ROOT, "scripts/brand-mark/entry.ts")],
      outfile: bundle,
      bundle: true,
      format: "iife",
      platform: "browser",
      target: "es2022",
      logLevel: "silent",
    });
    await writeFile(path.join(work, "index.html"), "<!doctype html><title>mark</title>");
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage();
      await page.goto(`file://${path.join(work, "index.html")}`);
      await page.addScriptTag({ path: bundle });
      for (const { file, size, background } of OUTPUTS) {
        const dataUrl = await page.evaluate(
          ([renderSize, color]) =>
            window.renderBrandMark(renderSize as number, color as string | undefined),
          [RENDER_SIZE, background] as const,
        );
        const png = Buffer.from(dataUrl.split(",")[1], "base64");
        // 한 번 크게 렌더한 뒤 줄인다 — 작은 캔버스에서 바로 뽑으면 계단이 남는다.
        await sharp(png).resize(size, size, { fit: "contain" }).png().toFile(path.join(ROOT, file));
        process.stdout.write(`${file} (${size}px)\n`);
      }
    } finally {
      await browser.close();
    }
    const icons = await Promise.all(
      FAVICON_SIZES.map(async (size) => ({
        size,
        png: await sharp(Buffer.from(simpleMarkSvg(size)))
          .png()
          .toBuffer(),
      })),
    );
    await writeFile(path.join(ROOT, "public/favicon.ico"), packIco(icons));
    await writeFile(
      path.join(ROOT, "public/assets/brand/deskrpg-mark-simple.svg"),
      simpleMarkSvg(64),
    );
    process.stdout.write(`public/favicon.ico (${FAVICON_SIZES.join("·")}px, 단순형)\n`);
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

void main();
