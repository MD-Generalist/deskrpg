import { expect, test, type Page } from "@playwright/test";
import type { Camera, Object3D, Scene, WebGLRenderer } from "three";

type Probe = {
  renderer: WebGLRenderer;
  scene: Scene;
  camera: Camera;
  frames: number;
};
declare global {
  interface Window {
    __homepageProbe?: Probe;
    __THREE_DEVTOOLS__: EventTarget;
  }
}

const loginURL = process.env.HOMEPAGE_LOGIN_BASE_URL ?? "http://127.0.0.1:3111";
const errors = new WeakMap<Page, string[]>();

test.beforeEach(async ({ page }, info) => {
  // Existing game config discovers all e2e specs; only this dedicated project runs these.
  test.skip(info.project.name !== "homepage", "Use playwright.homepage.config.ts");
  const found: string[] = [];
  errors.set(page, found);
  page.on("pageerror", (error) => found.push(error.message));
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    // The initial signed-out probe is intentionally 401; preserve all other errors.
    if (message.location().url.endsWith("/api/characters") && message.text().includes("401"))
      return;
    found.push(`${message.location().url}: ${message.text()}`);
  });
  await page.route("**/api/characters", (route) =>
    route.request().method() === "GET"
      ? route.fulfill({ status: 401, json: {} })
      : route.fallback(),
  );
  await page.route("**/api/auth/status", (route) =>
    route.request().method() === "GET"
      ? route.fulfill({ json: { hasUsers: true } })
      : route.fallback(),
  );
  await page.addInitScript(() => {
    window.__THREE_DEVTOOLS__ = new EventTarget();
    window.__THREE_DEVTOOLS__.addEventListener("observe", (event) => {
      const renderer = (event as CustomEvent<WebGLRenderer>).detail;
      if (!("isWebGLRenderer" in renderer) || !renderer.isWebGLRenderer) return;
      const render = renderer.render.bind(renderer);
      renderer.render = (scene, camera) => {
        // PMREM uses transient scenes. Count only actual homepage renders.
        if (scene.getObjectByName("commute-vehicles")) {
          const previous = window.__homepageProbe;
          window.__homepageProbe = {
            renderer,
            scene: scene as Scene,
            camera,
            frames: previous?.renderer === renderer ? previous.frames + 1 : 1,
          };
        }
        render(scene, camera);
      };
    });
  });
});

test.afterEach(async ({ page }) => {
  if (!errors.has(page)) return;
  expect(errors.get(page), "Unexpected browser console/page errors").toEqual([]);
});

async function openScene(page: Page, url = "/auth", status = "ready") {
  await page.goto(url);
  await expect(page.locator(".commute-canvas")).toHaveAttribute("data-ready", "true");
  await expect
    .poll(async () => (await snapshot(page)).actors.map((actor) => actor.status))
    .toEqual(Array(6).fill(status));
}

async function snapshot(page: Page) {
  return page.evaluate(() => {
    const probe = window.__homepageProbe!;
    const pose = (root: Object3D) => {
      const result: number[] = [];
      root.traverse((object) =>
        result.push(...object.position.toArray(), ...object.quaternion.toArray()),
      );
      return result;
    };
    const actors: {
      uuid: string;
      id: string;
      status: string;
      x: number;
      pose: number[];
      bones: number;
    }[] = [];
    probe.scene.traverse((object) => {
      if (!object.userData.assetStatus) return;
      let bones = 0;
      object.traverse((child) => {
        if ("isBone" in child && child.isBone) bones++;
      });
      actors.push({
        uuid: object.uuid,
        id: object.userData.actorId,
        status: object.userData.assetStatus,
        x: object.position.x,
        pose: pose(object),
        bones,
      });
    });
    const vehicles = probe.scene.getObjectByName("commute-vehicles")!.children.map((object) => ({
      id: object.name.replace("commute-vehicle:", ""),
      x: object.position.x,
      z: object.position.z,
      visible: object.visible,
      wheel: object.getObjectByName("wheel")!.rotation.z,
    }));
    return {
      frames: probe.frames,
      actors,
      vehicles,
      camera: pose(probe.camera),
      memory: { ...probe.renderer.info.memory },
      render: { ...probe.renderer.info.render },
    };
  });
}

for (const viewport of [
  { width: 1440, height: 1000 },
  { width: 2048, height: 807 },
  { width: 390, height: 844 },
]) {
  for (const mode of ["public", "login"] as const) {
    test(`${mode} HTML and layout ${viewport.width}×${viewport.height}`, async ({ page }, info) => {
      await page.setViewportSize(viewport);
      await openScene(page, mode === "login" ? `${loginURL}/auth` : "/auth");
      await expect(page.locator("h1")).toContainText("DeskRPG");
      await expect(page.locator("select")).toBeVisible();
      await page.locator("select").selectOption("en");
      await expect(page.locator("select")).toHaveAttribute("aria-label", "Language");
      await page.locator("select").selectOption("ko");
      if (mode === "public") {
        await expect(page.locator(".commute-github")).toHaveAttribute(
          "href",
          "https://github.com/dandacompany/deskrpg",
        );
        await expect(page.locator("form")).toHaveCount(0);
      } else {
        await page.locator('input[type="text"]').first().fill("homepage-qa-only");
        await page.locator('input[type="password"]').fill("not-a-real-credential");
        await expect(page.locator('button[type="submit"]')).toBeEnabled();
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await page.screenshot({
        path: info.outputPath(`${mode}-${viewport.width}.png`),
        fullPage: true,
      });
    });
  }
}

test("60 seconds: six vehicles, both lanes, stops/restarts and moving GLB poses", async ({
  page,
}, info) => {
  await openScene(page);
  const samples = [await snapshot(page)];
  for (let i = 0; i < 120; i++) {
    await page.waitForTimeout(500);
    samples.push(await snapshot(page));
  }
  await info.attach("traffic-and-walking-samples.json", {
    body: JSON.stringify(samples),
    contentType: "application/json",
  });
  expect(samples[0].vehicles.map((vehicle) => vehicle.id).sort()).toEqual([
    "bus-east",
    "sedan-east",
    "sedan-west",
    "suv-west",
    "taxi-east",
    "van-west",
  ]);
  const lengths: Record<string, number> = { bus: 6, sedan: 3.1, suv: 3.5, taxi: 3.1, van: 4 };
  for (const vehicle of samples[0].vehicles) {
    const track = samples.map((sample) =>
      sample.vehicles.find((entry) => entry.id === vehicle.id)!,
    );
    expect(track.some((entry) => entry.visible)).toBe(true);
    expect(
      Math.max(...track.map((entry) => entry.x)) - Math.min(...track.map((entry) => entry.x)),
    ).toBeGreaterThan(10);
    const direction = vehicle.id.endsWith("east") ? 1 : -1;
    expect(
      track.some((entry, index) => {
        if (!index) return false;
        const travel = direction * (entry.x - track[index - 1].x);
        return travel > 0.1 && travel < 3; // Exclude road-end wrap teleports.
      }),
    ).toBe(true);
  }
  let stopped = false,
    restarted = false;
  for (let i = 1; i < samples.length; i++) {
    for (const vehicle of samples[i].vehicles) {
      const previous = samples[i - 1].vehicles.find((entry) => entry.id === vehicle.id)!;
      if (vehicle.visible && previous.visible && Math.abs(vehicle.x - previous.x) < 1e-7) {
        expect(vehicle.wheel).toBe(previous.wheel);
        stopped = true;
        if (
          samples
            .slice(i + 1)
            .some(
              (sample) =>
                Math.abs(
                  sample.vehicles.find((entry) => entry.id === vehicle.id)!.wheel - vehicle.wheel,
                ) > 0.1,
            )
        )
          restarted = true;
      }
    }
    for (const z of [4.4, 7.2]) {
      const lane = samples[i].vehicles
        .filter((vehicle) => vehicle.z === z && vehicle.visible)
        .sort((a, b) => a.x - b.x);
      for (let j = 1; j < lane.length; j++) {
        const gap =
          lane[j].x -
          lane[j - 1].x -
          (lengths[lane[j].id.split("-")[0]] + lengths[lane[j - 1].id.split("-")[0]]) / 2;
        expect(gap).toBeGreaterThanOrEqual(0.799);
      }
    }
  }
  expect(stopped).toBe(true);
  expect(restarted).toBe(true);
  for (let i = 0; i < 6; i++) {
    expect(samples[0].actors[i].bones).toBeGreaterThan(0);
    expect(samples[1].actors[i].pose).not.toEqual(samples[0].actors[i].pose);
    const distance = Math.abs(samples[1].actors[i].x - samples[0].actors[i].x);
    expect(distance).toBeGreaterThan(0.2);
    expect(distance).toBeLessThan(1.5);
  }
});

test("pointer parallax, reduced motion and breakpoint resource stability", async ({ page }) => {
  await openScene(page);
  const initial = await snapshot(page);
  await page.mouse.move(1400, 200);
  await page.waitForTimeout(800);
  expect((await snapshot(page)).camera).not.toEqual(initial.camera);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.waitForTimeout(500);
  const paused = await snapshot(page);
  await page.mouse.move(30, 900);
  await page.waitForTimeout(800);
  expect(await snapshot(page)).toEqual(paused);
  for (let i = 0; i < 3; i++) {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(300);
    expect((await snapshot(page)).actors).toEqual(paused.actors);
    expect((await snapshot(page)).vehicles).toEqual(paused.vehicles);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.waitForTimeout(300);
    const current = await snapshot(page);
    expect(current.actors).toEqual(paused.actors);
    expect(current.memory.geometries).toBeLessThanOrEqual(paused.memory.geometries + 2);
    expect(current.memory.textures).toBeLessThanOrEqual(paused.memory.textures + 2);
  }
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await expect.poll(async () => (await snapshot(page)).frames).toBeGreaterThan(paused.frames + 5);
});

test("offscreen intersection pauses and resumes without catch-up", async ({ page }) => {
  await openScene(page);
  await page.locator(".commute-canvas").evaluate((element) => {
    (element as HTMLElement).style.transform = "translateY(300vh)";
  });
  await page.waitForTimeout(300);
  const paused = await snapshot(page);
  await page.waitForTimeout(1800);
  expect(await snapshot(page)).toEqual(paused);
  const resumed = await page.evaluate(() => {
    const probe = window.__homepageProbe!;
    const renderer = probe.renderer;
    const originalRender = renderer.render;
    const samples: { frames: number; actors: { uuid: string; x: number }[] }[] = [];
    return new Promise<typeof samples>((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        renderer.render = originalRender;
        reject(new Error("Homepage did not render six frames after returning onscreen"));
      }, 15_000);
      renderer.render = (scene, camera) => {
        originalRender.call(renderer, scene, camera);
        if (scene !== probe.scene) return;
        const actors: { uuid: string; x: number }[] = [];
        scene.traverse((object) => {
          if (object.userData.assetStatus) actors.push({ uuid: object.uuid, x: object.position.x });
        });
        samples.push({ frames: window.__homepageProbe!.frames, actors });
        if (samples.length === 6) {
          renderer.render = originalRender;
          window.clearTimeout(timeout);
          resolve(samples);
        }
      };
      // Install the observer and restore visibility in one browser task. Sampling
      // after a Playwright poll instead would include arbitrary CDP round-trip time.
      document.querySelector<HTMLElement>(".commute-canvas")!.style.transform = "";
    });
  });
  expect(resumed.map((sample) => sample.frames)).toEqual(
    Array.from({ length: 6 }, (_, index) => paused.frames + index + 1),
  );
  expect(resumed[0].actors).toEqual(paused.actors.map(({ uuid, x }) => ({ uuid, x })));
  for (let index = 0; index < resumed[0].actors.length; index++) {
    // Five subsequent ticks can advance at most 5 × 0.05s × 1.7 world units/s.
    // Measure across the 36-unit path seam without counting a wrap as catch-up.
    const travel = Math.abs(
      ((resumed[5].actors[index].x - resumed[0].actors[index].x + 54) % 36) - 18,
    );
    expect(travel).toBeGreaterThan(0);
    expect(travel).toBeLessThanOrEqual(0.425 + 1e-9);
  }
});

test("real WebGL context loss and restoration", async ({ page }) => {
  await openScene(page);
  // Retain the extension: getExtension() returns null while its context is lost.
  const extension = await page.evaluateHandle(() =>
    window.__homepageProbe!.renderer.getContext().getExtension("WEBGL_lose_context"),
  );
  await extension.evaluate((value) => value!.loseContext());
  await expect(page.locator(".commute-canvas")).not.toHaveAttribute("data-ready", "true");
  const paused = await snapshot(page);
  await page.waitForTimeout(500);
  expect((await snapshot(page)).frames).toBe(paused.frames);
  await extension.evaluate((value) => value!.restoreContext());
  await expect(page.locator(".commute-canvas")).toHaveAttribute("data-ready", "true");
  await expect.poll(async () => (await snapshot(page)).frames).toBeGreaterThan(paused.frames + 5);
  expect((await snapshot(page)).actors.map((actor) => actor.uuid)).toEqual(
    paused.actors.map((actor) => actor.uuid),
  );
  await expect(page.locator(".commute-canvas canvas")).toHaveCount(1);
  await extension.dispose();
});

test("aborted GLBs keep translated and articulated fallback walkers", async ({ page }) => {
  await page.route("**/*.glb", (route) => route.abort("failed"));
  // Network errors for this explicit failure injection are expected, not renderer errors.
  page.on("console", (message) => {
    if (
      message.type() === "error" &&
      message.location().url.endsWith(".glb") &&
      message.text().includes("ERR_FAILED")
    ) {
      const list = errors.get(page)!;
      const index = list.indexOf(`${message.location().url}: ${message.text()}`);
      if (index >= 0) list.splice(index, 1);
    }
  });
  await openScene(page, "/auth", "error");
  const before = await snapshot(page);
  await page.waitForTimeout(700);
  const after = await snapshot(page);
  for (let i = 0; i < 6; i++) {
    expect(after.actors[i].x).not.toBe(before.actors[i].x);
    expect(after.actors[i].pose.slice(7)).not.toEqual(before.actors[i].pose.slice(7));
  }
});

test.describe("mobile touch emulation (not a physical device)", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  test("native touch scroll leaves camera unchanged", async ({ page }) => {
    await openScene(page, `${loginURL}/auth`);
    const before = await snapshot(page);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Input.synthesizeScrollGesture", {
      x: 350,
      y: 750,
      yDistance: -180,
      speed: 300,
      gestureSourceType: "touch",
    });
    await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(30);
    expect((await snapshot(page)).camera).toEqual(before.camera);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await cdp.detach();
  });
});

test("no WebGL still exposes public and login HTML", async ({ page }) => {
  await page.addInitScript(() => {
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (
      this: HTMLCanvasElement,
      ...args: Parameters<typeof getContext>
    ) {
      if (String(args[0]).startsWith("webgl")) return null;
      return getContext.apply(this, args);
    } as typeof getContext;
  });
  for (const url of ["/auth", `${loginURL}/auth`]) {
    await page.goto(url);
    await expect(page.locator("h1")).toContainText("DeskRPG");
    await page.locator("select").selectOption("en");
    await expect(page.locator("select")).toHaveAttribute("aria-label", "Language");
    await expect(page.locator(".commute-canvas canvas")).toHaveCount(0);
    if (url.startsWith(loginURL)) {
      await page.locator('input[type="text"]').first().fill("qa-only");
      await expect(page.locator('input[type="text"]').first()).toHaveValue("qa-only");
    } else await expect(page.locator(".commute-github")).toBeVisible();
  }
  // Three reports its known initialization failure before the component catches it.
  errors.set(
    page,
    errors
      .get(page)!
      .filter(
        (error) => error.includes("THREE.WebGLRenderer: Error creating WebGL context.") === false,
      ),
  );
});
