import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { SCENE_ASSETS } from "../game/three/scene-asset-definitions";
const root = path.resolve(import.meta.dirname, "../..");
const files = (directory: string): string[] =>
  readdirSync(path.join(root, directory), { withFileTypes: true }).flatMap((entry) => {
    const file = `${directory}/${entry.name}`;
    return entry.isDirectory() ? files(file) : [file];
  });
const manifest = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")) as {
  files: string[];
};
const docker = [
  ...readFileSync(path.join(root, "Dockerfile"), "utf8").matchAll(
    /COPY --from=builder (?:--\S+ )?\/app\/(\S+)/g,
  ),
].map((match) => match[1]);
const covered = (entries: string[], file: string) =>
  entries.some((entry) => file === entry || file.startsWith(`${entry}/`));
test("Docker and npm carry the complete shared Three runtime directory", () => {
  const modules = files("src/game/three").filter(
    (file) => /\.tsx?$/.test(file) && !/\.test\.tsx?$/.test(file),
  );
  assert.ok(modules.some((file) => file.endsWith("creative-studio-renderer.ts")));
  for (const file of modules) {
    assert.ok(covered(docker, file), `Docker omits ${file}`);
    assert.ok(covered(manifest.files, file), `npm omits ${file}`);
  }
});
test("all catalog GLBs, studio surfaces, thumbnail and build reports ship through public", () => {
  const runtime = [
    ...Object.values(SCENE_ASSETS).map((asset) => `public${asset.url}`),
    ...[
      "public/assets/shared/architecture",
      "public/assets/shared/furniture",
      "public/assets/shared/surfaces",
      "public/assets/environments/creative-studio",
    ].flatMap(files),
    "src/lib/fixtures/official-agency-v2.json",
    "src/lib/fixtures/official-agency-v3.json",
    "src/lib/fixtures/official-agency-v4.json",
  ];
  for (const file of new Set(runtime)) {
    assert.ok(existsSync(path.join(root, file)), file);
    assert.ok(covered(manifest.files, file), `npm omits ${file}`);
    // The fixture is traced into the Next API; public URLs need explicit copies.
    if (file.startsWith("public/")) assert.ok(covered(docker, file), `Docker omits ${file}`);
  }
  assert.ok(runtime.includes("public/assets/environments/creative-studio/agency-v5.webp"));
  assert.notDeepEqual(
    readFileSync(path.join(root, "public/assets/environments/creative-studio/agency-v5.webp")),
    readFileSync(path.join(root, "public/assets/environments/creative-studio/agency-v4.webp")),
    "v5 picker preview must show the director suite rather than reuse the open v4 floor",
  );
});
test("every generated studio GLB is catalogued and covered by its measured build report", () => {
  let count = 0;
  for (const directory of [
    "public/assets/shared/architecture",
    "public/assets/shared/furniture",
    "public/assets/environments/creative-studio",
  ]) {
    const report = JSON.parse(
      readFileSync(path.join(root, directory, "build-report.json"), "utf8"),
    ) as Record<
      string,
      { bytes: number; triangles: number; source: string; invalidMesh: boolean; license: string }
    >;
    const glbs = files(directory).filter((file) => file.endsWith(".glb"));
    assert.equal(Object.keys(report).length, glbs.length, directory);
    for (const file of glbs) {
      count++;
      const entry = report[path.basename(file).replace(/-v\d+\.glb$/, "")];
      const asset = Object.values(SCENE_ASSETS).find(
        (candidate) => `public${candidate.url}` === file,
      );
      assert.ok(asset, `uncatalogued ${file}`);
      assert.ok(entry, `unreported ${file}`);
      assert.equal(entry.bytes, statSync(path.join(root, file)).size, `stale report ${file}`);
      assert.equal(entry.invalidMesh, false, file);
      assert.equal(entry.license, "repository-original", file);
      assert.ok(existsSync(path.join(root, entry.source)), entry.source);
      assert.ok(asset.source.includes(entry.source), file);
      assert.ok(entry.triangles > 0 && entry.triangles <= asset.budget.maxTriangles, file);
    }
  }
  assert.equal(count, 40, "9 architectural + 17 furniture + 14 studio kits");
});
