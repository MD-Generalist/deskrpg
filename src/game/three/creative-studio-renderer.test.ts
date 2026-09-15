import test from "node:test";
import assert from "node:assert/strict";
import * as T from "three";
import {
  addCreativeStudioScene,
  renderCreativeStudioObject,
  studioObjectDirection,
  finalizeStudioScene,
  studioDecorations,
} from "./creative-studio-renderer";
import { buildOfficeEnvironment } from "./office-environments";
import { tiledSnapshot } from "./tiled-preview";
import { furnitureSeats } from "./seating";
import { disposeTree } from "./dispose-tree";
import { creativeStudioOverview } from "./creative-studio-architecture";
const source = () => {
  const g = new T.Group();
  g.add(new T.Mesh(new T.BoxGeometry(0.1, 0.1, 0.1), new T.MeshStandardMaterial()));
  return g;
};
test("studio adapter builds architecture once, resolves all objects and retains 57 seats after late batching", async () => {
  const map = tiledSnapshot(buildOfficeEnvironment("agency")),
    root = new T.Group(),
    calls = new Map<string, number>();
  const load = async (url: string) => {
    calls.set(url, (calls.get(url) ?? 0) + 1);
    return source();
  };
  const scene = addCreativeStudioScene(root, map, {
    load,
    loadTexture: async () => new T.Texture(),
  });
  assert.ok(scene);
  assert.equal(addCreativeStudioScene(root, map, { load }), scene);
  assert.equal(root.children.length, 1);
  await scene.userData.assetReady;
  assert.equal(scene.userData.assetStatus, "ready");
  assert.equal(scene.children.filter((o) => o.name === "creative-studio-architecture").length, 1);
  assert.ok([...calls.values()].every((n) => n === 1));
  let seats = 0;
  scene.traverse((o) => {
    seats += o.userData.seats?.length ?? (o.userData.seat ? 1 : 0);
    assert.ok(!o.userData.dynamicAsset);
  });
  assert.equal(seats, 57);
  for (const object of map.objects) {
    const host = new T.Group();
    assert.equal(
      renderCreativeStudioObject(host, object, map.objects, { load }),
      true,
      object.type,
    );
    await host.userData.assetReady;
    disposeTree(host);
  }
  assert.equal(furnitureSeats(map.objects).length, 57);
  disposeTree(root);
});
test("legacy/custom agency gate does not compose a studio scene", () => {
  const map = tiledSnapshot(buildOfficeEnvironment("agency"));
  for (const other of [
    { ...map, environmentVersion: 2 },
    { ...map, cols: 30 },
    { ...map, environment: "executive" },
  ]) {
    const root = new T.Group();
    assert.equal(addCreativeStudioScene(root, other), null);
    assert.equal(root.children.length, 0);
  }
});
test("protected v4 studio keeps its original open floor without v5 director architecture", async () => {
  const map = { ...tiledSnapshot(buildOfficeEnvironment("agency")), environmentVersion: 4 };
  const scene = addCreativeStudioScene(new T.Group(), map, {
    load: async () => source(),
    loadTexture: async () => new T.Texture(),
  })!;
  await scene.userData.assetReady;
  assert.equal(scene.getObjectByName("director-open-door"), undefined);
  assert.equal(
    scene.children.some(
      (object) =>
        object.name === "decoration:executive-rug" ||
        (object.name === "decoration:shared-woven-rug" && object.position.x < 10),
    ),
    false,
  );
  disposeTree(scene);
});
test("workstation monitors face their adjacent chairs with no navigation edits", () => {
  const map = tiledSnapshot(buildOfficeEnvironment("agency")),
    before = JSON.stringify(map);
  for (const computer of map.objects.filter((o) => o.type === "computer"))
    assert.equal(studioObjectDirection(computer, map.objects), computer.row === 3 ? "up" : "down");
  assert.equal(JSON.stringify(map), before);
});
test("final batching preserves seat proxies and shares equivalent cloned textures only within the scene", () => {
  const root = new T.Group(),
    texture = new T.Texture();
  for (let i = 0; i < 2; i++) {
    const g = new T.Group();
    g.position.x = i;
    g.userData.seat = { x: i, z: 0, anchorX: i + 0.5, anchorZ: 0.5 };
    g.userData.dynamicAsset = true;
    g.userData.assetStatus = "ready";
    g.add(new T.Mesh(new T.BoxGeometry(), new T.MeshStandardMaterial({ map: texture.clone() })));
    root.add(g);
  }
  finalizeStudioScene(root);
  let visible = 0,
    proxies = 0;
  root.traverse((o) => {
    if (o instanceof T.Mesh) {
      visible += Number(o.visible);
      proxies += Number(!!o.userData.seatPickProxy);
    }
  });
  assert.equal(visible, 1);
  assert.equal(proxies, 2);
  disposeTree(root);
  texture.dispose();
});
test("studio dressing adds shared rugs and plants without new navigation objects", () => {
  const decorations = studioDecorations(tiledSnapshot(buildOfficeEnvironment("agency")).objects);
  assert.ok(
    decorations.filter((d) => d.id === "shared-ficus" || d.id === "shared-olive").length >= 10,
  );
  assert.ok(decorations.some((d) => d.id === "shared-round-rug"));
  assert.ok(decorations.some((d) => d.id === "shared-woven-rug"));
});
test("monstera placements keep a distinct broad-leaf fallback without requesting the ficus asset", async () => {
  const host = new T.Group();
  let loadCalls = 0;
  assert.equal(
    renderCreativeStudioObject(
      host,
      { id: "monstera", type: "plant", variant: "monstera", col: 29, row: 14 },
      [],
      {
        load: async () => {
          loadCalls += 1;
          return source();
        },
      },
    ),
    true,
  );
  assert.equal(await host.userData.assetReady, true);
  assert.equal(loadCalls, 0);
  const bounds = new T.Box3().setFromObject(host);
  assert.ok(bounds.max.x - bounds.min.x > 0.7, "broad leaves differ from the narrow tree fallback");
  disposeTree(host);
});
test("reference camera fills the wide viewport while retaining all shell corners", () => {
  const preset = creativeStudioOverview(42, 26, 1748 / 900),
    camera = new T.PerspectiveCamera(38, 1748 / 900, 0.1, 1000);
  camera.position.copy(preset.position);
  camera.lookAt(preset.target);
  camera.updateMatrixWorld();
  const points = [];
  for (const x of [-0.2, 42.2])
    for (const y of [-0.5, 4.2])
      for (const z of [-0.2, 26.2]) points.push(new T.Vector3(x, y, z).project(camera));
  assert.ok(points.every((p) => Math.abs(p.x) < 0.95 && Math.abs(p.y) < 0.95));
  assert.ok(Math.max(...points.map((p) => p.x)) - Math.min(...points.map((p) => p.x)) > 1.5);
});

test("flat paper and swatch details do not spend shadow passes while furniture retains contact shadows", () => {
  const root = new T.Group();
  const paper = new T.Mesh(new T.BoxGeometry(0.2, 0.005, 0.3), new T.MeshStandardMaterial());
  paper.material.name = "printed-paper";
  paper.castShadow = true;
  const furniture = new T.Mesh(new T.BoxGeometry(), new T.MeshStandardMaterial());
  furniture.material.name = "oak";
  furniture.castShadow = true;
  root.add(paper, furniture);
  finalizeStudioScene(root);
  assert.equal(paper.castShadow, false);
  assert.equal(furniture.castShadow, true);
  disposeTree(root);
});

test("late batching shares byte-identical PBR images across independent GLB sources", () => {
  const root = new T.Group();
  for (let i = 0; i < 2; i++) {
    const texture = new T.DataTexture(new Uint8Array([128, 64, 32, 255]), 1, 1);
    const material = new T.MeshStandardMaterial({ map: texture });
    const mesh = new T.Mesh(new T.BoxGeometry(), material);
    mesh.position.x = i;
    root.add(mesh);
  }
  finalizeStudioScene(root);
  assert.equal(root.children.filter((o) => o instanceof T.Mesh && o.visible).length, 1);
});

test("edited studio returns collision-bearing generic objects to the renderer without duplicating owned content", async () => {
  const map = tiledSnapshot(buildOfficeEnvironment("agency"));
  const bookshelf = { id: "custom-bookshelf", type: "bookshelf" as const, col: 4, row: 15 };
  map.objects.push(bookshelf);
  const scene = addCreativeStudioScene(new T.Group(), map, {
    load: async () => source(),
    loadTexture: async () => new T.Texture(),
  })!;
  assert.deepEqual(scene.userData.unhandledObjects, [bookshelf]);
  await scene.userData.assetReady;
  assert.equal(scene.children.filter((o) => o.userData.mapObjectId === bookshelf.id).length, 0);
  assert.ok(
    scene.children.some(
      (o) => o.userData.mapObjectId === map.objects.find((o) => o.type === "studio_worktable")?.id,
    ),
  );
  disposeTree(scene);
});
