// Deterministic, manually stepped visual fixture; not a performance benchmark.
const fs = require("node:fs/promises"),
  path = require("node:path"),
  http = require("node:http"),
  assert = require("node:assert/strict");
const { chromium } = require("playwright"),
  esbuild = require("esbuild");
const out = process.argv[2] || "/tmp/deskrpg-tech-review";
(async () => {
  await fs.mkdir(out, { recursive: true });
  const bundle = await esbuild.build({
    stdin: {
      contents: `
 import {OfficeRenderer} from './src/game/three/office-renderer';
 import {buildOfficeEnvironment} from './src/game/three/office-environments';
 import {tiledSnapshot} from './src/game/three/tiled-preview';
 import {furnitureSeats} from './src/game/three/seating';
 const map=tiledSnapshot(buildOfficeEnvironment('tech'));
 const r:any=new OfficeRenderer(document.getElementById('view')!,document.getElementById('labels')!);
 Object.assign(window,{r,map,seats:furnitureSeats(map.objects)});
 r.attach({map:()=>map,mapKey:()=> 'tech-review',actors:()=>[],setPresentation:()=>{},editor:()=>({enabled:false}),walkable:()=>true,pointer:()=>{},save:async()=>false,edit:()=>{}} as any);
 r.overview(map.cols,map.rows);r.buildMap(map);r.lastMap='tech-review';
 `,
      resolveDir: process.cwd(),
      loader: "ts",
    },
    bundle: true,
    write: false,
    format: "iife",
    platform: "browser",
    define: {
      "process.env.NODE_ENV": '"production"',
      "process.env.NEXT_PUBLIC_README_CAPTURE": '"0"',
    },
  });
  const server = http.createServer(async (req, res) => {
    if (req.url === "/") {
      res.end(
        '<style>body{margin:0}#view{width:100vw;height:100vh}#labels{position:absolute;inset:0;pointer-events:none}</style><div id="view"></div><div id="labels"></div><script src="/entry.js"></script>',
      );
      return;
    }
    if (req.url === "/entry.js") {
      res.setHeader("content-type", "application/javascript");
      res.end(bundle.outputFiles[0].contents);
      return;
    }
    const file = path.resolve("public", "." + new URL(req.url, "http://localhost").pathname);
    if (!file.startsWith(path.resolve("public") + path.sep)) {
      res.writeHead(403).end();
      return;
    }
    try {
      res.end(await fs.readFile(file));
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const browser = await chromium.launch({
    headless: true,
    args: ["--enable-webgl", "--ignore-gpu-blocklist"],
  });
  try {
    const page = await browser.newPage({ viewport: { width: 1748, height: 900 } }),
      errors = [];
    page.on("pageerror", (e) => {
      errors.push(e.message);
      console.log(e.stack);
    });
    await page.addInitScript(() => {
      Object.defineProperty(document, "hidden", { get: () => false });
      window.requestAnimationFrame = () => 0;
      window.cancelAnimationFrame = () => {};
    });
    await page.goto("http://127.0.0.1:" + server.address().port, {
      waitUntil: "commit",
      timeout: 120000,
    });
    console.log("page loaded");
    await page
      .waitForFunction(() => window.r && window.r.readMetrics().assetsReady, null, {
        polling: 500,
        timeout: 120000,
      })
      .catch(async (e) => {
        console.log(
          await page.evaluate(() => {
            const states = [];
            window.r?.world.traverse((o) => {
              if (o.userData.assetStatus)
                states.push([o.name, o.userData.assetStatus, o.userData.sceneAssetUrl]);
            });
            return { metrics: window.r?.readMetrics(), states };
          }),
        );
        throw e;
      });
    await page.evaluate(() => window.r.tick(performance.now()));
    await fs.writeFile(
      path.join(out, "tech-overview.png"),
      Buffer.from(
        (
          await page.evaluate(() => {
            window.r.renderer.render(window.r.scene, window.r.camera);
            return window.r.renderer.domElement.toDataURL("image/png");
          })
        ).split(",")[1],
        "base64",
      ),
    );
    const report = await page.evaluate(() => ({
      metrics: window.r.readMetrics(),
      seats: window.seats.length,
    }));
    await page.evaluate(() => {
      window.r.showRoom(7, 4, 18);
      window.r.tick(performance.now());
    });
    await fs.writeFile(
      path.join(out, "tech-detail.png"),
      Buffer.from(
        (
          await page.evaluate(() => {
            window.r.renderer.render(window.r.scene, window.r.camera);
            return window.r.renderer.domElement.toDataURL("image/png");
          })
        ).split(",")[1],
        "base64",
      ),
    );
    assert.deepEqual(errors, []);
    assert.equal(report.metrics.failedAssets, 0);
    assert.equal(report.seats, 40);
    await fs.writeFile(
      path.join(out, "report.json"),
      JSON.stringify({ ...report, errors, manualFrames: true }, null, 2),
    );
    console.log(report);
  } finally {
    await browser.close();
    server.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
