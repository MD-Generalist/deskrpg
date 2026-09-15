import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import * as T from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import {
  addCreativeStudioArchitecture,
  creativeStudioSurface,
  isCreativeStudioMap,
  creativeStudioOverview,
} from "./creative-studio-architecture";
import { SCENE_ASSETS, sceneAsset } from "./scene-asset-catalog";
import { disposeTree } from "./dispose-tree";

test("studio capability requires agency v3 and exact dimensions; legacy maps stay legacy", () => {
  const map = { environment: "agency", environmentVersion: 3, cols: 42, rows: 26 };
  assert.equal(isCreativeStudioMap(map), true);
  for (const changed of [
    { environmentVersion: 2 },
    { environmentVersion: undefined },
    { cols: 30 },
    { environment: "executive" },
  ])
    assert.equal(isCreativeStudioMap({ ...map, ...changed }), false);
});

test("authored architecture files declare measured budgets and glass shadow policy", async () => {
  const report = JSON.parse(
    await readFile("public/assets/shared/architecture/build-report.json", "utf8"),
  );
  for (const name of [
    "oak-floor",
    "brick-panel",
    "plaster-panel",
    "grid-window",
    "glass-partition",
    "glass-corner",
    "glass-door",
    "double-entrance",
    "cutaway-plinth",
  ]) {
    const id = `shared-${name}` as keyof typeof SCENE_ASSETS;
    const asset = sceneAsset(id);
    assert.equal(asset.category, "architecture");
    assert.ok(report[name].triangles <= asset.budget.maxTriangles);
    assert.equal((await readFile(`public${asset.url}`)).length, report[name].bytes);
    if (/glass|window|entrance/.test(name)) assert.equal(asset.shadows.cast, false);
  }
});

test("PBR channels use sRGB only for color and retain scalar fallback on missing maps", async () => {
  const host = new T.Group();
  const material = creativeStudioSurface(host, "oak", {
    repeat: [14, 13],
    load: async () => new T.Texture(),
  });
  await host.children[0].userData.assetReady;
  assert.equal(material.map?.colorSpace, T.SRGBColorSpace);
  assert.equal(material.normalMap?.colorSpace, T.NoColorSpace);
  assert.equal(material.roughnessMap?.colorSpace, T.NoColorSpace);
  assert.deepEqual(material.map?.repeat.toArray(), [14, 13]);
  assert.ok(material.normalScale.x > 0 && material.normalScale.x < 0.5);
  const failed = new T.Group();
  const scalar = creativeStudioSurface(failed, "brick", {
    load: async () => {
      throw Error("offline");
    },
  });
  await failed.children[0].userData.assetReady;
  assert.equal(failed.children[0].userData.assetStatus, "failed");
  assert.equal(scalar.map, null);
  assert.ok(scalar.roughness > 0.5);
  material.dispose();
  scalar.dispose();
  disposeTree(host);
  disposeTree(failed);
});

test("late surface loads are disposed without reattaching to disposed material", async () => {
  const host = new T.Group();
  const callbacks: ((t: T.Texture) => void)[] = [];
  const mat = creativeStudioSurface(host, "oak", {
    load: () => new Promise((resolve) => callbacks.push(resolve)),
  });
  mat.dispose();
  let freed = 0;
  for (const resolve of callbacks) {
    const t = new T.Texture();
    t.addEventListener("dispose", () => freed++);
    resolve(t);
  }
  await host.children[0].userData.assetReady;
  assert.equal(freed, 3);
  assert.equal(mat.map, null);
});

test("fallback shell fits 42x26 and contains entrance, feature wall and no opaque glazing shadows", async () => {
  const root = new T.Group();
  const shell = addCreativeStudioArchitecture(root, 42, 26, {
    load: async () => {
      throw Error("offline");
    },
    loadTexture: async () => {
      throw Error("offline");
    },
  });
  await shell.userData.assetReady;
  const bounds = new T.Box3().setFromObject(shell);
  assert.ok(bounds.min.x >= -0.21 && bounds.max.x <= 42.21);
  assert.ok(bounds.min.z >= -0.21 && bounds.max.z <= 26.21);
  assert.ok(bounds.max.y >= 3.5 && bounds.max.y <= 4.2);
  const entrance = shell.getObjectByName("centered-double-entrance")!;
  assert.equal(entrance.position.x, 23.5);
  assert.equal(entrance.scale.x * 4, 5);
  assert.ok(shell.getObjectByName("pantry-coral-feature-wall"));
  const directorDoor = shell.getObjectByName("director-open-door");
  assert.ok(directorDoor, "director suite has a dedicated inward-opening glass door");
  assert.equal(directorDoor.position.x, 9.82);
  assert.equal(directorDoor.position.z, 12.97);
  shell.traverse((o) => {
    if (o instanceof T.Mesh && o.material.transparent) assert.equal(o.castShadow, false);
  });
  disposeTree(root);
  assert.throws(() => addCreativeStudioArchitecture(root, 30, 22), /42.*26/);
});

test("reference overview includes full shell height and edge at wide and portrait aspects", () => {
  for (const aspect of [0.6, 1, 1.94, 2.5]) {
    const preset = creativeStudioOverview(42, 26, aspect);
    const camera = new T.PerspectiveCamera(38, aspect, 0.1, 1000);
    camera.position.copy(preset.position);
    camera.lookAt(preset.target);
    camera.updateMatrixWorld();
    assert.ok(camera.position.x > 21 && camera.position.z > 13);
    for (const x of [-0.2, 42.2])
      for (const y of [-0.5, 4.2])
        for (const z of [-0.2, 26.2]) {
          const p = new T.Vector3(x, y, z).project(camera);
          assert.ok(Math.abs(p.x) < 0.95 && Math.abs(p.y) < 0.95, `${aspect}: ${p.toArray()}`);
        }
  }
});

test("loaded architecture batches opaque modules and only coplanar glass below 35 draw calls", async () => {
  const load = async (url: string) => {
    const bytes = await readFile(`public${url}`);
    const loader = new GLTFLoader();
    loader.register(() => ({ name: "EXT_texture_webp", loadTexture: async () => new T.Texture() }));
    return (
      await loader.parseAsync(
        bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
        "",
      )
    ).scene;
  };
  const root = new T.Group();
  const shell = addCreativeStudioArchitecture(root, 42, 26, {
    load,
    loadTexture: async () => new T.Texture(),
  });
  await shell.userData.assetReady;
  let calls = 0;
  shell.traverse((o) => {
    if (o instanceof T.Mesh) {
      calls += Array.isArray(o.material) ? o.material.length : 1;
      if (o.material.transparent) assert.equal(o.castShadow, false);
    }
  });
  assert.ok(calls < 35, `architecture draw calls: ${calls}`);
  assert.equal(shell.userData.assetStatus, "ready");
  let brickVertices = 0;
  shell.traverse((o) => {
    if (!(o instanceof T.Mesh) || Array.isArray(o.material) || o.material.name !== "brick") return;
    const pos = o.geometry.getAttribute("position"),
      uv = o.geometry.getAttribute("uv"),
      normal = o.geometry.getAttribute("normal");
    for (let i = 0; i < pos.count; i++) {
      if (Math.abs(normal.getZ(i)) < Math.max(Math.abs(normal.getX(i)), Math.abs(normal.getY(i))))
        continue;
      brickVertices++;
      assert.ok(
        Math.abs(uv.getX(i) - pos.getX(i) / 2) < 0.001,
        "brick UVs retain world density across compressed sill panels",
      );
      assert.ok(Math.abs(uv.getY(i) - pos.getY(i) / 2) < 0.001);
    }
  });
  assert.ok(brickVertices > 0);
  disposeTree(root);
});

test("perimeter bays cover both ends exactly once and keep all window heads aligned", async () => {
  const api = await import("./creative-studio-architecture");
  assert.equal(typeof api.studioPerimeterBays, "function");
  for (const length of [42, 26]) {
    const bays = api.studioPerimeterBays(length);
    assert.equal(bays[0].start, 0);
    assert.equal(bays.at(-1)?.end, length);
    assert.equal(bays[0].kind, "pier");
    assert.equal(bays.at(-1)?.kind, "pier");
    for (let i = 0; i < bays.length; i++) {
      assert.ok(bays[i].end > bays[i].start);
      if (i) assert.equal(bays[i].start, bays[i - 1].end, "no hole or overlapped window end");
      assert.equal(bays[i].head, 3.6);
    }
  }
});

test("loaded shell closes high corner and meeting front while open door stays outside adjacent panels", async () => {
  const root = new T.Group();
  const shell = addCreativeStudioArchitecture(root, 42, 26, {
    load: async (url) => {
      const bytes = await readFile(`public${url}`);
      const loader = new GLTFLoader();
      loader.register(() => ({
        name: "EXT_texture_webp",
        loadTexture: async () => new T.Texture(),
      }));
      return (
        await loader.parseAsync(
          bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
          "",
        )
      ).scene;
    },
    loadTexture: async () => new T.Texture(),
  });
  await shell.userData.assetReady;
  shell.updateMatrixWorld(true);
  const hits = (origin: T.Vector3, direction: T.Vector3) =>
    new T.Raycaster(origin, direction, 0, 0.8)
      .intersectObject(shell, true)
      .filter((hit) => hit.object instanceof T.Mesh);
  assert.ok(hits(new T.Vector3(0.5, 2.5, 0.6), new T.Vector3(0, 0, -1)).length, "rear high corner");
  assert.ok(hits(new T.Vector3(0.6, 2.5, 0.5), new T.Vector3(-1, 0, 0)).length, "left high corner");
  for (const [origin, direction, transparent] of [
    [new T.Vector3(40.5, 3.5, 0.6), new T.Vector3(0, 0, -1), true],
    [new T.Vector3(41.5, 3.5, 0.6), new T.Vector3(0, 0, -1), false],
    [new T.Vector3(0.6, 3.5, 23.5), new T.Vector3(-1, 0, 0), true],
    [new T.Vector3(0.6, 3.5, 25.5), new T.Vector3(-1, 0, 0), false],
  ] as const) {
    const high = hits(origin, direction);
    assert.ok(high.length, "end bay reaches the common high head");
    for (const hit of high) {
      const mesh = hit.object as T.Mesh<T.BufferGeometry, T.Material>;
      assert.equal(
        mesh.material.transparent,
        transparent,
        "last window stays uncovered; final pier stays opaque",
      );
    }
  }
  for (const x of [33.5, 35.5, 37.5, 39.5, 41])
    assert.ok(hits(new T.Vector3(x, 2, 10), new T.Vector3(0, 0, 1)).length, `front glass ${x}`);
  assert.ok(
    hits(new T.Vector3(33, 2, 0.7), new T.Vector3(-1, 0, 0)).length,
    "meeting west joins rear wall",
  );
  const door = shell.getObjectByName("meeting-open-door")!;
  // Slot-based batching empties hosts, but their authored AABB transformed by the retained
  // placement still describes the loaded model (catalog bounds are separately parsed/tested).
  const definition = sceneAsset("shared-glass-door");
  const doorBounds = new T.Box3(
    new T.Vector3(...definition.bounds.min),
    new T.Vector3(...definition.bounds.max),
  ).applyMatrix4(door.matrixWorld);
  assert.ok(doorBounds.min.x > 32.55, "open leaf is separated from wall glazing and frames");
  assert.ok(doorBounds.max.x < 33, "leaf stays inside existing blocked west tiles");
  assert.ok(
    doorBounds.max.z <= 8 && doorBounds.max.z >= 7.9,
    "leaf hinges at row8 jamb and leaves doorway clear",
  );
  assert.ok(
    doorBounds.min.z >= 5.9 && doorBounds.min.z <= 6,
    "full leaf folds back along west wall",
  );
  for (const z of [8.3, 8.7, 9.3, 9.7])
    assert.equal(
      hits(new T.Vector3(32, 1, z), new T.Vector3(1, 0, 0)).length,
      0,
      `clear doorway ${z}`,
    );
  disposeTree(root);
});
