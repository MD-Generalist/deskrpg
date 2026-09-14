import test from "node:test";
import assert from "node:assert/strict";
import * as T from "three";
import { attachFurnitureAsset } from "./furniture-asset";
import { disposeTree } from "./dispose-tree";
import { batchStaticFurniture } from "./static-batching";

test("late furniture load is disposed after map unload and never attaches", async () => {
  const host = new T.Group();
  let finish!: (group: T.Group) => void;
  const ready = attachFurnitureAsset(
    host,
    "desk",
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  disposeTree(host);
  const loaded = new T.Group();
  const geometry = new T.BoxGeometry();
  let freed = false;
  geometry.addEventListener("dispose", () => {
    freed = true;
  });
  loaded.add(new T.Mesh(geometry, new T.MeshStandardMaterial()));
  finish(loaded);
  assert.equal(await ready, false);
  assert.equal(host.children.length, 0);
  assert.equal(freed, true);
});

test("batching leaves fallback ownership intact; success replaces it once", async () => {
  const world = new T.Group(),
    host = new T.Group();
  world.add(host);
  const fallback = new T.Mesh(new T.BoxGeometry(), new T.MeshStandardMaterial());
  host.add(fallback);
  let finish!: (group: T.Group) => void;
  const ready = attachFurnitureAsset(
    host,
    "chair",
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  batchStaticFurniture(world, true);
  assert.equal(fallback.parent, host);
  const loaded = new T.Group();
  finish(loaded);
  assert.equal(await ready, true);
  assert.deepEqual(host.children, [loaded]);
  assert.equal(host.userData.assetStatus, "ready");
  disposeTree(world);
});

test("asset failure retains usable fallback but is not reported ready", async () => {
  const host = new T.Group();
  const fallback = new T.Group();
  host.add(fallback);
  assert.equal(
    await attachFurnitureAsset(host, "bookcase", async () => {
      throw new Error("offline");
    }),
    false,
  );
  assert.equal(host.children[0], fallback);
  assert.equal(host.userData.assetStatus, "failed");
  disposeTree(host);
});
