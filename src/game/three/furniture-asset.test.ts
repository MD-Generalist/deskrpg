import test from "node:test";
import assert from "node:assert/strict";
import * as T from "three";
import { attachFurnitureAsset, executiveAssetUrl } from "./furniture-asset";
import { disposeTree } from "./dispose-tree";
import { batchStaticFurniture } from "./static-batching";

test("late furniture source remains cached after map unload and never attaches", async () => {
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
  assert.equal(freed, false);
  disposeTree(loaded);
  assert.equal(freed, true);
});

test("legacy executive names resolve through the versioned catalog", () => {
  assert.equal(executiveAssetUrl("desk"), "/assets/furniture/executive/desk-v1.glb");
  assert.equal(
    executiveAssetUrl("executive-desk"),
    "/assets/furniture/executive/executive-desk-v1.glb",
  );
});

test("legacy furniture attachments share cached sources and own separate clones", async () => {
  let loadCalls = 0;
  const source = new T.Group().add(new T.Mesh(new T.BoxGeometry(), new T.MeshStandardMaterial()));
  const load = async () => {
    loadCalls += 1;
    return source;
  };
  const first = new T.Group();
  const second = new T.Group();

  assert.equal(await attachFurnitureAsset(first, "chair", load), true);
  assert.equal(await attachFurnitureAsset(second, "chair", load), true);
  assert.equal(loadCalls, 1);
  assert.notEqual(first.children[0], second.children[0]);
  disposeTree(first);
  disposeTree(second);
  disposeTree(source);
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
  assert.equal(host.children.length, 1);
  assert.notEqual(host.children[0], loaded);
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

test("batching retains asynchronous surface material identity for late textures", () => {
  const world = new T.Group();
  const material = new T.MeshStandardMaterial();
  material.userData.dynamicSurface = true;
  const host = new T.Group();
  world.add(host);
  for (let i = 0; i < 3; i++) {
    const mesh = new T.Mesh(new T.BoxGeometry(), material);
    mesh.position.x = i;
    host.add(mesh);
  }
  batchStaticFurniture(world, true, { vertexColors: true });
  const texture = new T.Texture();
  material.map = texture;
  world.traverse((object) => {
    if (object instanceof T.Mesh) assert.equal(object.material, material);
  });
  disposeTree(world);
});
