import fs from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { test as base, expect } from "@playwright/test";
import { SCENES } from "./contracts";
import {
  ROOT,
  readFixture,
  prepareScene,
  observeRecordingPage,
  markClip,
  orbit,
  zoom,
  trafficSnapshot,
  stageReport,
  wireEvents,
  rejoinOffice,
} from "./capture-helpers";

const test = base.extend({
  page: async ({ context }, providePage) => {
    const origin = performance.now();
    const page = await context.newPage();
    observeRecordingPage(page, origin);
    await providePage(page);
  },
});

test.afterEach(async ({ page }, info) => {
  await fs.writeFile(
    info.outputPath("events.json"),
    JSON.stringify(
      {
        wire: wireEvents.get(page),
        frontend: await page.evaluate(() => window.__readmeEvents).catch(() => []),
      },
      null,
      2,
    ),
  );
});

for (const scene of SCENES) {
  test(`${scene} fixture is recordable`, async ({ page, context }) => {
    const fixture = await readFixture();
    await prepareScene(page, scene, fixture);
    await expect(
      page.locator(scene === "home-commute" ? ".commute-canvas" : ".office-three-canvas"),
    ).toBeVisible();
    if (process.env.README_CAPTURE_DRY_RUN === "1") return;
    if (scene === "home-commute") {
      // Start close to the first red/green transition without changing the traffic simulation.
      await page.mouse.move(640, 360);
      await page.waitForTimeout(9500);
      const samples = [await trafficSnapshot(page)];
      await markClip(
        page,
        scene,
        async () => {
          const start = performance.now();
          for (let i = 0; i < 65; i++) {
            // Hold the camera, make one gentle round trip, then settle.
            // Static holds preserve GIF coherence while traffic continues naturally.
            const phase = Math.max(0, Math.min(1, (i * 100 - 1800) / 1000));
            const offset = Math.sin(Math.PI * phase);
            await page.mouse.move(640 + offset * 200, 360 - offset * 60);
            await page.waitForTimeout(Math.max(0, (i + 1) * 100 - (performance.now() - start)));
            samples.push(await trafficSnapshot(page));
          }
          for (const lane of [4.4, 7.2])
            expect(
              samples.some((sample) =>
                sample.vehicles.some(
                  (v, j) => v.z === lane && Math.abs(v.x - samples[0].vehicles[j].x) > 0.5,
                ),
              ),
            ).toBe(true);
          expect(
            samples.some(
              (sample, i) =>
                i > 0 &&
                sample.vehicles.some(
                  (v, j) =>
                    Math.abs(v.x - samples[i - 1].vehicles[j].x) < 1e-7 &&
                    samples
                      .slice(i + 1)
                      .some((later) => Math.abs(later.vehicles[j].wheel - v.wheel) > 0.1),
                ),
            ),
          ).toBe(true);
        },
        8000,
      );
    } else if (scene === "walk-report") {
      await markClip(page, scene, async () => {
        await orbit(page, 100, 1400);
        await zoom(page, -160, 5);
        stageReport("pending");
        await rejoinOffice(page);
        await expect
          .poll(() => wireEvents.get(page)?.some((e) => e.event === "npc:report-ready"))
          .toBe(true);
        const sophie = page.locator('.office-actor-label[aria-label="Sophie"]');
        await expect(sophie).toHaveAttribute("data-walking", "true", { timeout: 5000 });
        await expect(sophie).toHaveAttribute("data-walking", "false", { timeout: 6000 });
        expect(
          await page.evaluate(() =>
            window.__readmeEvents?.some((e) => e.event === "npc:call-to-player" && e.data.reportId),
          ),
        ).toBe(true);
        expect(
          await page.evaluate(() =>
            window.__readmeEvents?.some(
              (e) => e.event === "npc:movement-arrived" && e.data.reportId,
            ),
          ),
        ).toBe(true);
        await expect(
          page.locator(".office-actor-bubble").filter({ hasText: "보고드립니다." }),
        ).toBeVisible();
        await sophie.click();
        await expect(page.getByText(/시네마틱 캡처 준비를 마쳤습니다/).first()).toBeVisible({
          timeout: 1500,
        });
      });
    } else if (scene === "small-talk") {
      await page.getByRole("button", { name: "내 캐릭터 따라가기", exact: true }).click();
      await markClip(page, scene, async () => {
        const input = page.getByRole("textbox").last();
        await input.fill("@Soph");
        await page.getByRole("option", { name: "Sophie", exact: true }).click();
        await input.pressSequentially("좋은 아침이에요", { delay: 65 });
        await input.press("Enter");
        await expect
          .poll(() =>
            wireEvents
              .get(page)
              ?.filter((e) => e.event === "room:response-state")
              .map((e) => (e.data.response as { status: string }).status),
          )
          .toEqual(expect.arrayContaining(["queued", "thinking", "streaming", "complete"]));
        const phases = wireEvents
          .get(page)!
          .filter((event) => event.event === "room:response-state")
          .map((event) => (event.data.response as { status: string }).status);
        expect([...new Set(phases)]).toEqual(["queued", "thinking", "streaming", "complete"]);
        await expect(
          page.getByText("좋은 아침이에요. 오늘 일정부터 함께 확인할게요.").first(),
        ).toBeVisible();
      });
    } else {
      await page.getByRole("button", { name: "회의실", exact: true }).click();
      await page.getByRole("button", { name: /진행 설정/ }).click();
      for (const name of fixture.npcNames)
        await page
          .locator("label")
          .filter({ hasText: name })
          .locator('input[type="checkbox"]')
          .check();
      await page.getByPlaceholder("회의 주제를 입력하세요").fill("오늘의 우선순위를 정해요");
      await page.evaluate(() => {
        window.__readmeSpeakers = [];
        new MutationObserver(() => {
          for (const name of ["Sophie", "Noah"]) {
            if (
              document.body.innerText.includes(`${name} 발언 중...`) &&
              !window.__readmeSpeakers!.includes(name)
            )
              window.__readmeSpeakers!.push(name);
          }
        }).observe(document.body, { childList: true, subtree: true, characterData: true });
      });
      await markClip(page, scene, async () => {
        await page.getByRole("button", { name: "회의 시작", exact: true }).click();
        await expect
          .poll(() => page.evaluate(() => window.__readmeSpeakers))
          .toEqual(expect.arrayContaining(["Sophie", "Noah"]));
        await expect
          .poll(
            async () =>
              new Set(
                await page
                  .locator('[data-meeting-message="npc"]')
                  .evaluateAll((nodes) => nodes.map((n) => n.getAttribute("data-sender"))),
              ).size,
          )
          .toBe(2);
      });
    }
    const video = page.video();
    expect(video).not.toBeNull();
    await fs.writeFile(
      path.join(ROOT, ".artifacts/readme-capture/checkpoints", `${scene}-events.json`),
      JSON.stringify(
        {
          wire: wireEvents.get(page),
          frontend: await page.evaluate(() => window.__readmeEvents),
          speakers: await page.evaluate(() => window.__readmeSpeakers),
        },
        null,
        2,
      ),
    );
    await context.close();
    await fs.copyFile(
      await video!.path(),
      path.join(ROOT, ".artifacts/readme-capture/raw", `${scene}.webm`),
    );
  });
}
