import test from "node:test";
import assert from "node:assert/strict";
import * as T from "three";
import { TECH_STARTUP_ASSETS, renderTechStartupObject } from "./tech-startup-assets";
import type { MapObject } from "../../lib/object-types";
import { disposeTree } from "./dispose-tree";
import { pickFurnitureSeat } from "./seat-picking";
import { batchStaticFurniture } from "./static-batching";

const object = (
  variant: keyof typeof TECH_STARTUP_ASSETS,
  direction: MapObject["direction"] = "down",
): MapObject => ({
  id: variant,
  type: TECH_STARTUP_ASSETS[variant].type,
  variant,
  direction,
  col: 4,
  row: 6,
});

test("tech catalog dimensions contain finite real geometry without spill into adjacent tiles", () => {
  for (const variant of Object.keys(TECH_STARTUP_ASSETS) as (keyof typeof TECH_STARTUP_ASSETS)[]) {
    const host = new T.Group();
    assert.equal(renderTechStartupObject(host, object(variant)), true);
    const bounds = new T.Box3().setFromObject(host.children[0], true);
    const definition = TECH_STARTUP_ASSETS[variant];
    assert.ok(bounds.min.y >= -0.001, variant);
    assert.ok(bounds.max.y <= definition.height + 0.001, `${variant} height ${bounds.max.y}`);
    assert.ok(bounds.min.x >= -definition.footprint[0] / 2 - 0.001, variant);
    assert.ok(bounds.max.x <= definition.footprint[0] / 2 + 0.001, variant);
    assert.ok(bounds.min.z >= -definition.footprint[1] / 2 - 0.001, variant);
    assert.ok(
      bounds.max.z <= definition.footprint[1] / 2 + 0.001,
      `${variant} depth ${bounds.max.z}`,
    );
    host.traverse((o) => {
      if (o instanceof T.Mesh)
        for (const n of o.geometry.attributes.position.array) assert.ok(Number.isFinite(n));
    });
    disposeTree(host);
  }
});

test("workstation divider is behind its seated user for each orientation", () => {
  for (const direction of ["down", "right", "up", "left"] as const) {
    const host = new T.Group();
    renderTechStartupObject(host, object("tech-workstation", direction));
    host.updateMatrixWorld(true);
    const divider = host.getObjectByName("workstation-rear-divider")!;
    const position = divider.getWorldPosition(new T.Vector3()).sub(host.position);
    const forward = { down: [0, 1], right: [1, 0], up: [0, -1], left: [-1, 0] }[direction];
    assert.ok(position.x * forward[0] + position.z * forward[1] < -0.4);
    disposeTree(host);
  }
});

test("beanbag picking preserves seat ownership through static batching and rotation", () => {
  for (const direction of ["down", "right", "up", "left"] as const) {
    const scene = new T.Group(),
      host = new T.Group();
    scene.add(host);
    renderTechStartupObject(host, object("tech-beanbag", direction));
    const seat = { ...host.userData.seat };
    assert.equal(seat.direction, direction);
    batchStaticFurniture(scene, true, { vertexColors: true, batchSeats: true });
    scene.updateMatrixWorld(true);
    const picked = pickFurnitureSeat(
      new T.Raycaster(new T.Vector3(seat.x, 3, seat.z), new T.Vector3(0, -1, 0)),
      [scene],
    );
    assert.ok(picked, direction);
    assert.deepEqual(picked.seat, seat);
    disposeTree(scene);
  }
});

test("unsupported or mismatched tech variants do not consume or mutate generic furniture", () => {
  const host = new T.Group();
  host.position.set(7, 8, 9);
  for (const value of [
    { ...object("tech-server-rack"), variant: "other" },
    { ...object("tech-server-rack"), type: "desk" },
  ])
    assert.equal(renderTechStartupObject(host, value), false);
  assert.equal(host.children.length, 0);
  assert.deepEqual(host.position.toArray(), [7, 8, 9]);
});

test("authored tech GLBs include PBR detail and match their measured build report", async () => {
  const { readFile } = await import("node:fs/promises");
  const { createHash } = await import("node:crypto");
  const base = "public/assets/shared/tech/";
  const report = JSON.parse(await readFile(base + "build-report.json", "utf8"));
  for (const [id, definition] of Object.entries(TECH_STARTUP_ASSETS)) {
    const entry = report[id];
    const bytes = await readFile(base + entry.file);
    assert.equal(bytes.length, entry.bytes);
    assert.equal(createHash("sha256").update(bytes).digest("hex"), entry.sha256);
    assert.ok(entry.triangles <= 12000);
    assert.ok(entry.meshes <= 12);
    const gltf = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString());
    assert.ok(
      gltf.materials.some(
        (m: {
          normalTexture?: unknown;
          pbrMetallicRoughness?: { baseColorTexture?: unknown; metallicRoughnessTexture?: unknown };
        }) =>
          m.normalTexture &&
          m.pbrMetallicRoughness?.baseColorTexture &&
          m.pbrMetallicRoughness?.metallicRoughnessTexture,
      ),
      id,
    );
    assert.ok(entry.bounds.max[1] <= definition.height + 0.001);
  }
});

test("runtime scene catalog resolves every authored tech asset to its measured GLB", async () => {
  const { readFile } = await import("node:fs/promises");
  const { SCENE_ASSETS, sceneAsset } = await import("./scene-asset-catalog");
  const report: Record<
    string,
    { file: string; bytes: number; triangles: number; bounds: { min: number[]; max: number[] } }
  > = JSON.parse(await readFile("public/assets/shared/tech/build-report.json", "utf8"));
  for (const id of Object.keys(TECH_STARTUP_ASSETS) as (keyof typeof TECH_STARTUP_ASSETS)[]) {
    assert.ok(Object.hasOwn(SCENE_ASSETS, id), id);
    const registered = sceneAsset(id);
    const measured = report[id];
    assert.equal(registered.url, `/assets/shared/tech/${measured.file}`, id);
    assert.deepEqual(registered.footprint, TECH_STARTUP_ASSETS[id].footprint, id);
    assert.equal(registered.bounds?.units, "meters", id);
    assert.deepEqual(registered.bounds?.min, measured.bounds.min, id);
    assert.deepEqual(registered.bounds?.max, measured.bounds.max, id);
    assert.equal(registered.maxHeight, measured.bounds.max[1], id);
    assert.ok(measured.bytes <= registered.budget.maxBytes, `${id} byte budget`);
    assert.ok(measured.triangles <= registered.budget.maxTriangles, `${id} triangle budget`);
    assert.equal((await readFile(`public${registered.url}`)).length, measured.bytes, id);
  }
});
