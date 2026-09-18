/** Repeatable, offline headless visual/soft-shadow regression probe. Run from repo root. */
const fs = require("node:fs/promises"),
  http = require("node:http"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const root = process.cwd(),
  out = path.resolve(process.argv[2] || "/tmp/deskrpg-task3-visual");
const { chromium } = require(path.join(root, "node_modules/playwright"));
const esbuild = require(path.join(root, "node_modules/esbuild"));
const sharp = require(path.join(root, "node_modules/sharp"));
const entry =
  "import * as T from \"three\";\nimport { OfficeRenderer } from './src/game/three/office-renderer';\nimport { buildOfficeEnvironment } from './src/game/three/office-environments';\nimport { tiledSnapshot } from './src/game/three/tiled-preview';\nconst map = tiledSnapshot(buildOfficeEnvironment('agency'));\nconst params = new URLSearchParams(location.search);\nif (!params.has('furnished')) map.objects = [];\nconst r:any = new OfficeRenderer(document.querySelector('#view')!, document.querySelector('#labels')!);\nr.attach({map:()=>map,mapKey:()=> 'review-task3', actors:()=>[],setPresentation:()=>{},editor:()=>({placement:false,spawn:false,owner:false,tiled:true}),walkable:()=>true,pointer:()=>{}} as any);\nr.overview(42,26);\nObject.assign(window,{reviewRenderer:r, reviewMap:map});\nasync function done(){\n for(let i=0;i<300;i++){\n  const shell = r.world.getObjectByName('creative-studio-architecture');\n  if(shell){await shell.userData.assetReady; (window as any).reviewReady = true; return;}\n  await new Promise(res=>setTimeout(res,100));\n }\n}\ndone();\n\nObject.assign(window,{setupShadowProbe:()=>{\n  r.world.clear();\n  const floor = new T.Mesh(new T.PlaneGeometry(42,26),new T.MeshStandardMaterial({color:'#dddddd',roughness:1}));\n  floor.rotation.x=-Math.PI/2;floor.position.set(21,0,13);floor.receiveShadow=true;r.world.add(floor);\n  const caster=new T.Mesh(new T.BoxGeometry(2,3,2),new T.MeshStandardMaterial({color:'#666666',roughness:1}));\n  caster.position.set(21,1.5,13);caster.castShadow=true;r.world.add(caster);\n  r.controls.target.set(21,0,13);r.camera.position.set(21,16,13.001);r.controls.update();\n  r.sun.shadow.needsUpdate=true;\n}, shadowProbeSample:(radius:number)=>{\n  r.sun.shadow.radius=radius;r.renderer.render(r.scene,r.camera);\n  const ctx=r.renderer.getContext();const width=r.renderer.domElement.width,height=r.renderer.domElement.height;\n  const pixels=new Uint8Array(width*height*4);ctx.readPixels(0,0,width,height,ctx.RGBA,ctx.UNSIGNED_BYTE,pixels);\n  const scan=[];\n  for(let x=22;x<=25;x+=.005){\n    const p=new T.Vector3(x,0.005,15.4).project(r.camera);\n    const px=Math.round((p.x+1)*width/2),py=Math.round((p.y+1)*height/2);\n    const idx=(py*width+px)*4;scan.push({x,px,py,luma:(pixels[idx]+pixels[idx+1]+pixels[idx+2])/3});\n  }\n  return {radius,shadowMapType:r.renderer.shadowMap.type,scan};\n}});\n";
(async () => {
  await fs.mkdir(out, { recursive: true });
  const bundle = await esbuild.build({
    stdin: { contents: entry, loader: "ts", resolveDir: root },
    bundle: true,
    write: false,
    format: "iife",
    platform: "browser",
    define: { "process.env.NODE_ENV": '"production"' },
  });
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    if (url.pathname === "/") {
      res.setHeader("Content-Type", "text/html");
      res.end(
        '<style>body{margin:0}#view{width:100vw;height:100vh}#labels{position:absolute;inset:0;pointer-events:none}</style><div id="view"></div><div id="labels"></div><script src="/entry.js"></script>',
      );
      return;
    }
    if (url.pathname === "/entry.js") {
      res.setHeader("Content-Type", "text/javascript");
      res.end(bundle.outputFiles[0].contents);
      return;
    }
    const target = path.resolve(root, "public", "." + url.pathname);
    if (!target.startsWith(path.join(root, "public") + path.sep)) {
      res.writeHead(403);
      res.end();
      return;
    }
    try {
      const data = await fs.readFile(target);
      res.setHeader(
        "Content-Type",
        { ".glb": "model/gltf-binary", ".webp": "image/webp", ".png": "image/png" }[
          path.extname(target)
        ] || "application/octet-stream",
      );
      res.end(data);
    } catch {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const browser = await chromium.launch({
    headless: true,
    args: ["--enable-webgl", "--ignore-gpu-blocklist"],
  });
  try {
    const page = await browser.newPage({
      viewport: { width: 1748, height: 900 },
      deviceScaleFactor: 1,
    });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(m.text());
    });
    const base = "http://127.0.0.1:" + server.address().port;
    const report = { viewport: { width: 1748, height: 900 }, dpr: 1, errors, metrics: {} };
    for (const furnished of [false, true]) {
      await page.goto(base + (furnished ? "/?furnished" : "/"));
      await page.waitForFunction(() => window.reviewReady === true, null, { timeout: 60000 });
      await page.waitForTimeout(300);
      const label = furnished ? "furnished" : "shell";
      report.metrics[label] = await page.evaluate(() => window.reviewRenderer.readMetrics());
      await page.screenshot({ path: path.join(out, label + ".png") });
      if (furnished) {
        await page.evaluate(() => window.reviewRenderer.showRoom(36, 6, 17));
        await page.waitForTimeout(200);
        await page.screenshot({ path: path.join(out, "meeting.png") });
        continue;
      }
      await page.evaluate(() => window.reviewRenderer.showRoom(4, 4, 16));
      await page.waitForTimeout(200);
      await page.screenshot({ path: path.join(out, "rear-left.png") });
      for (const radius of [1, 3]) {
        await page.evaluate((radius) => (window.reviewRenderer.sun.shadow.radius = radius), radius);
        await page.waitForTimeout(150);
        await page.screenshot({ path: path.join(out, "radius" + radius + ".png") });
      }
      await page.evaluate(() => window.setupShadowProbe());
      await page.waitForTimeout(150);
      const samples = [];
      for (const radius of [1, 3]) {
        samples.push(await page.evaluate((radius) => window.shadowProbeSample(radius), radius));
        await page.screenshot({ path: path.join(out, "shadow-probe-radius" + radius + ".png") });
      }
      await fs.writeFile(path.join(out, "shadow-samples.json"), JSON.stringify(samples, null, 2));
      report.edgeSamples = samples.map((sample) => {
        const lo = Math.min(...sample.scan.map((s) => s.luma)),
          hi = Math.max(...sample.scan.map((s) => s.luma));
        const transition = new Set(
          sample.scan
            .filter((s) => s.luma > lo + (hi - lo) * 0.1 && s.luma < lo + (hi - lo) * 0.9)
            .map((s) => s.px),
        );
        return {
          radius: sample.radius,
          shadowMapType: sample.shadowMapType,
          shadowLuma: lo,
          litLuma: hi,
          transitionPixels: transition.size,
        };
      });
      const before = await sharp(path.join(out, "radius1.png")).removeAlpha().raw().toBuffer();
      const after = await sharp(path.join(out, "radius3.png")).removeAlpha().raw().toBuffer();
      report.changedColorChannels = after.reduce(
        (sum, value, i) => sum + (value !== before[i] ? 1 : 0),
        0,
      );
      report.totalColorChannels = after.length;
    }
    assert.deepEqual(errors, [], "no browser errors");
    assert.ok(report.changedColorChannels > 1000, "softness changes actual scene pixels");
    const [hard, soft] = report.edgeSamples;
    assert.equal(soft.shadowMapType, 1, "studio uses supported PCF kernel");
    assert.ok(
      soft.transitionPixels >= hard.transitionPixels * 1.5 &&
        soft.transitionPixels >= hard.transitionPixels + 3,
      "wider 10–90% shadow edge, not just a changed setting",
    );
    await fs.writeFile(path.join(out, "visual-report.json"), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
