/** Reproducible authored GLBs from the reusable procedural source; no external downloads. */
const { chromium } = require("playwright");
const esbuild = require("esbuild");
const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
async function buildAuthoredAssets(config) {
  const output = path.resolve(config.output);
  await fs.mkdir(output, { recursive: true });
  const source = `
import * as T from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { ${config.builder} as buildTechStartupAsset, ${config.definitions} as TECH_STARTUP_ASSETS } from '${config.module}';
import { detailSurfaces } from './src/game/three/surface-detail';
import { batchStaticFurniture } from './src/game/three/static-batching';
window.buildTech = async () => {
 const result = {};
 for (const id of Object.keys(TECH_STARTUP_ASSETS)) {
  const root = buildTechStartupAsset(id);
  detailSurfaces(root, ${JSON.stringify(config.woodColors ?? ["#cdb58c"])}, ['#719078','#5e7d65','#426477','#738d83'], ['#262d33','#9ca5aa']);
  const processed = new Set();
  root.traverse(o => {
    if (!o.isMesh) return;
    for(const m of Array.isArray(o.material)?o.material:[o.material]) {
      if(processed.has(m))continue; processed.add(m);
      if(!m.bumpMap)continue;
      const tex=m.bumpMap, n=tex.image.width, h=tex.image.data, data=new Uint8Array(n*n*4);
      for(let y=0;y<n;y++)for(let x=0;x<n;x++) {
        const sample=(xx,yy)=>h[(((yy+n)%n)*n+(xx+n)%n)*4]/255;
        const normal=new T.Vector3((sample(x-1,y)-sample(x+1,y))*.45,(sample(x,y-1)-sample(x,y+1))*.45,1).normalize();
        const i=(y*n+x)*4;data[i]=(normal.x*.5+.5)*255;data[i+1]=(normal.y*.5+.5)*255;data[i+2]=(normal.z*.5+.5)*255;data[i+3]=255;
      }
      m.normalMap=new T.DataTexture(data,n,n);m.normalMap.wrapS=m.normalMap.wrapT=T.RepeatWrapping;
      m.normalMap.repeat.copy(tex.repeat);m.normalMap.needsUpdate=true;m.bumpMap=null;
    }
  });
  const converted = new Map();
  root.traverse(o=>{if(!o.isMesh)return;for(const m of Array.isArray(o.material)?o.material:[o.material])for(const channel of ['map','normalMap','roughnessMap']){
    const old=m[channel];if(!old?.isDataTexture)continue;
    if(!converted.has(old)) {const canvas=document.createElement('canvas');canvas.width=old.image.width;canvas.height=old.image.height;canvas.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(old.image.data),canvas.width,canvas.height),0,0);const tex=new T.CanvasTexture(canvas);tex.colorSpace=old.colorSpace;tex.wrapS=old.wrapS;tex.wrapT=old.wrapT;tex.repeat.copy(old.repeat);tex.flipY=false;converted.set(old,tex);}
    m[channel]=converted.get(old);
  }});
  batchStaticFurniture(root,true);
  let triangles=0,meshes=0;root.traverse(o=>{if(o.isMesh){meshes++;triangles+=(o.geometry.index?.count??o.geometry.attributes.position.count)/3;}});
  const bounds=new T.Box3().setFromObject(root,true);
  const buffer=await new GLTFExporter().parseAsync(root,{binary:true});
  const bytes=new Uint8Array(buffer);let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
  result[id]={base64:btoa(binary),triangles,meshes,bounds:{min:bounds.min.toArray(),max:bounds.max.toArray()}};
 }
 return result;
};`;
  const bundle = await esbuild.build({
    stdin: { contents: source, resolveDir: process.cwd(), loader: "ts" },
    bundle: true,
    write: false,
    format: "iife",
    platform: "browser",
  });
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    const assets = await page.evaluate(() => window.buildTech());
    const report = {};
    for (const [id, asset] of Object.entries(assets)) {
      const bytes = Buffer.from(asset.base64, "base64");
      if (asset.triangles > 30000) throw new Error(id + " exceeds 30k triangles");
      const filename = id + "-v1.glb";
      await fs.writeFile(path.join(output, filename), bytes);
      report[id] = {
        file: filename,
        bytes: bytes.length,
        triangles: asset.triangles,
        meshes: asset.meshes,
        bounds: asset.bounds,
        sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
        source: config.module.replace(/^\.\//, "") + ".ts",
        license: "Project-authored; same license as DeskRPG repository",
        textures: "Project-authored deterministic wood/fabric/metal albedo, normal, roughness",
        generator: config.generator,
      };
    }
    await fs.writeFile(
      path.join(output, "build-report.json"),
      JSON.stringify(report, null, 2) + "\n",
    );
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await browser.close();
  }
}
module.exports = { buildAuthoredAssets };
if (require.main === module)
  buildAuthoredAssets({
    output: "public/assets/shared/tech",
    module: "./src/game/three/tech-startup-assets",
    builder: "buildTechStartupAsset",
    definitions: "TECH_STARTUP_ASSETS",
    generator: "scripts/assets/build-tech-startup.cjs",
  }).catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
