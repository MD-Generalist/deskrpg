/** Offline studio kit gallery: actual assets, independently composed for Task 5 verification. Run from repo root. */
const fs = require("node:fs/promises"),
  http = require("node:http"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const root = process.cwd(),
  out = path.resolve(process.argv[2] || "/tmp/deskrpg-task5-visual");
const { chromium } = require(path.join(root, "node_modules/playwright"));
const esbuild = require(path.join(root, "node_modules/esbuild"));
const entry =
  "import * as T from \"three\";\nimport {OfficeRenderer} from './src/game/three/office-renderer';\nimport {buildOfficeEnvironment} from './src/game/three/office-environments';\nimport {tiledSnapshot} from './src/game/three/tiled-preview';\nimport {getObjectDimensions} from './src/lib/object-types';\nimport {buildStudioFurnitureFallback,studioFurnitureAsset} from './src/game/three/studio-furniture';\nimport {attachSceneAsset} from './src/game/three/scene-asset-catalog';\nimport {resolveSeat} from './src/game/three/seating';\nimport {creativeStudioKitFor,creativeStudioKitOwnsBody,creativeStudioDecorations,attachCreativeStudioKit} from './src/game/three/creative-studio-kits';\nconst map=tiledSnapshot(buildOfficeEnvironment('agency')), objects=map.objects;map.objects=[];\nconst r:any=new OfficeRenderer(document.querySelector('#view')!,document.querySelector('#labels')!);\nr.attach({map:()=>map,mapKey:()=> 'task5-kit-review',actors:()=>[],setPresentation:()=>{},editor:()=>({placement:false,spawn:false,owner:false,tiled:true}),walkable:()=>true,pointer:()=>{}} as any);\nr.overview(42,26);Object.assign(window,{reviewRenderer:r});\nasync function ready(){\n for(let i=0;i<300;i++){const shell=r.world.getObjectByName('creative-studio-architecture');if(shell){await shell.userData.assetReady;break;}await new Promise(resolve=>setTimeout(resolve,100));}\n const loads=[];\n for(const object of objects){\n  const asset=studioFurnitureAsset(object),kitId=creativeStudioKitFor(object);if(!asset&&!kitId)continue;\n  const size=getObjectDimensions(object.type,object.direction),host=new T.Group();\n  let x=object.col+size.width/2,z=object.row+size.height/2,direction=object.direction??'down';\n  if(object.type==='chair'){const seat=resolveSeat(object,objects);x=seat.x;z=seat.z;direction=seat.direction;}\n  host.position.set(x,0,z);host.rotation.y={down:0,right:Math.PI/2,up:Math.PI,left:-Math.PI/2}[direction];r.world.add(host);\n  if(asset&&(!kitId||!creativeStudioKitOwnsBody(kitId))){const body=new T.Group();body.add(buildStudioFurnitureFallback(object.type,object.variant)!);host.add(body);loads.push(attachSceneAsset(body,asset.id,{variant:asset.variant}));}\n  if(kitId)loads.push(attachCreativeStudioKit(host,object));\n }\n for(const d of creativeStudioDecorations()){const host=new T.Group();host.position.set(...d.position);host.rotation.y=d.rotationY;r.world.add(host);loads.push(attachCreativeStudioKit(host,d.object));}\n const results=await Promise.all(loads);Object.assign(window,{reviewReady:true,reviewLoads:results});\n}\nready();";
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
    await page.goto(base);
    await page.waitForFunction(() => window.reviewReady === true, null, { timeout: 60000 });
    const loads = await page.evaluate(() => window.reviewLoads);
    assert.ok(loads.length > 60 && loads.every(Boolean), "all furniture GLBs load successfully");
    report.assetsLoaded = loads.length;
    for (const [name, x, z, distance] of [
      ["overview", 21, 13, 0],
      ["photo", 5.5, 4.5, 11],
      ["production", 23, 19.5, 8],
      ["ideation", 14.5, 12.5, 8],
      ["pantry", 39, 11.5, 7],
      ["art-wall", 26, 1, 9],
    ]) {
      if (distance)
        await page.evaluate(
          ([x, z, distance]) => window.reviewRenderer.showRoom(x, z, distance),
          [x, z, distance],
        );
      if (name === "art-wall")
        await page.evaluate(() => {
          window.reviewRenderer.controls.target.y = 1.5;
          window.reviewRenderer.controls.update();
        });
      await page.waitForTimeout(250);
      await page.screenshot({ path: path.join(out, name + ".png") });
      report.metrics[name] = await page.evaluate(() => window.reviewRenderer.readMetrics());
    }
    assert.deepEqual(errors, []);
    await fs.writeFile(path.join(out, "report.json"), JSON.stringify(report, null, 2) + "\n");
    console.log(JSON.stringify(report));
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
