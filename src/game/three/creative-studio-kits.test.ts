import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import * as T from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { SCENE_ASSETS, sceneAsset } from "./scene-asset-catalog";
import {
  CREATIVE_STUDIO_KIT_IDS,
  creativeStudioKitFor,
  buildCreativeStudioKitFallback,
  attachCreativeStudioKit,
  creativeStudioDecorations,
} from "./creative-studio-kits";
import { tiledSnapshot } from "./tiled-preview";
import { buildOfficeEnvironment } from "./office-environments";
import { disposeTree } from "./dispose-tree";

const required = [
  "photo-cyclorama",
  "photo-softbox",
  "photo-camera-tripod",
  "photo-reflector",
  "photo-equipment-shelf",
  "production-table-dressed",
  "round-ideation-dressed",
  "mobile-idea-board",
  "sample-display",
  "pantry-counter-dressed",
  "art-wall-dressed",
] as const;
test("studio hero inventory contains real bounded PBR geometry with normals and opaque materials", async () => {
  const report = JSON.parse(
    await readFile("public/assets/environments/creative-studio/build-report.json", "utf8"),
  );
  for (const id of required) assert.ok(CREATIVE_STUDIO_KIT_IDS.includes(id));
  for (const id of CREATIVE_STUDIO_KIT_IDS) {
    const def = sceneAsset(id);
    assert.equal(def.category, "kit");
    assert.equal(def.license, "repository-original");
    const bytes = await readFile("public" + def.url);
    const json = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString());
    assert.equal(bytes.length, report[id].bytes);
    assert.ok(bytes.length <= def.budget.maxBytes);
    let triangles = 0;
    for (const mesh of json.meshes)
      for (const p of mesh.primitives) {
        assert.ok(p.attributes.NORMAL !== undefined, id);
        triangles += json.accessors[p.indices].count / 3;
      }
    assert.equal(triangles, report[id].triangles);
    assert.ok(triangles <= def.budget.maxTriangles);
    for (const name of Object.values(def.materialSlots ?? {}))
      assert.ok(
        json.materials.some((m: { name: string }) => m.name === name),
        `${id}: ${name}`,
      );
    for (const material of json.materials) {
      assert.equal(material.alphaMode ?? "OPAQUE", "OPAQUE", id);
      assert.equal(material.pbrMetallicRoughness.baseColorFactor?.[3] ?? 1, 1);
    }
    assert.ok(
      json.materials.some(
        (m: {
          normalTexture?: unknown;
          pbrMetallicRoughness: { baseColorTexture?: unknown; metallicRoughnessTexture?: unknown };
        }) =>
          m.normalTexture &&
          m.pbrMetallicRoughness.baseColorTexture &&
          m.pbrMetallicRoughness.metallicRoughnessTexture,
      ),
      id,
    );
    const loader = new GLTFLoader();
    loader.register(() => ({ name: "EXT_texture_webp", loadTexture: async () => new T.Texture() }));
    const gltf = await loader.parseAsync(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      "",
    );
    const box = new T.Box3().setFromObject(gltf.scene);
    for (let axis = 0; axis < 3; axis++) {
      assert.ok(box.min.getComponent(axis) >= def.bounds.min[axis] - 0.001, `${id} min ${axis}`);
      assert.ok(box.max.getComponent(axis) <= def.bounds.max[axis] + 0.001, `${id} max ${axis}`);
    }
    assert.ok(
      box.min.x >= -def.footprint[0] / 2 - 0.001 && box.max.x <= def.footprint[0] / 2 + 0.001,
      id,
    );
    assert.ok(
      box.min.z >= -def.footprint[1] / 2 - 0.001 && box.max.z <= def.footprint[1] / 2 + 0.001,
      id,
    );
    if (id === "photo-cyclorama") {
      const ray = new T.Raycaster(new T.Vector3(1, 1, 1), new T.Vector3(0, -1, 0));
      const floor = ray.intersectObject(gltf.scene, true)[0];
      assert.ok(
        floor && floor.point.y > 0.035,
        "coral floor must sit above the 35mm architectural oak slab",
      );
    }
    if (id === "photo-softbox")
      assert.ok(
        json.materials.some((m: { emissiveFactor?: number[] }) =>
          m.emissiveFactor?.some((v) => v > 0),
        ),
      );
    disposeTree(gltf.scene);
  }
});
test("every approved dressing object resolves without mutating layout or collision records", () => {
  const map = tiledSnapshot(buildOfficeEnvironment("agency")),
    before = JSON.stringify(map);
  const types = [
    "photo_cyclorama",
    "photo_camera",
    "photo_light",
    "studio_worktable",
    "studio_round_table",
    "mobile_board",
    "studio_counter",
    "computer",
  ];
  for (const object of map.objects.filter(
    (o) => types.includes(o.type) && o.variant !== "director-monitor",
  ))
    assert.ok(creativeStudioKitFor(object), object.type);
  assert.equal(
    creativeStudioKitFor({ type: "studio_shelf", variant: "equipment" }),
    "photo-equipment-shelf",
  );
  assert.equal(
    creativeStudioKitFor({ type: "studio_shelf", variant: "sample-rack" }),
    "sample-display",
  );
  assert.equal(creativeStudioKitFor({ type: "desk" }), undefined);
  assert.equal(JSON.stringify(map), before);
  const decorations = creativeStudioDecorations();
  assert.ok(decorations.some((d) => creativeStudioKitFor(d.object) === "art-wall-dressed"));
  assert.ok(decorations.some((d) => creativeStudioKitFor(d.object) === "photo-reflector"));
  for (const d of decorations) assert.ok(d.position.every(Number.isFinite));
});
test("all kit fallbacks are meaningful bounded silhouettes and failed loads keep them attached", async () => {
  for (const id of CREATIVE_STUDIO_KIT_IDS) {
    const def = SCENE_ASSETS[id];
    const group = buildCreativeStudioKitFallback(id);
    const box = new T.Box3().setFromObject(group);
    assert.ok(!box.isEmpty());
    for (let axis = 0; axis < 3; axis++) {
      assert.ok(box.min.getComponent(axis) >= def.bounds.min[axis] - 0.001, `${id} min`);
      assert.ok(box.max.getComponent(axis) <= def.bounds.max[axis] + 0.001, `${id} max`);
    }
    disposeTree(group);
  }
  const host = new T.Group(),
    furniture = new T.Mesh(new T.BoxGeometry(), new T.MeshStandardMaterial());
  host.add(furniture);
  host.userData.seats = [{ anchorX: 1.5, anchorZ: 2.5 }];
  const previous = console.warn;
  console.warn = () => {};
  try {
    assert.equal(
      await attachCreativeStudioKit(
        host,
        { type: "studio_worktable", variant: "dressed" },
        {
          load: async () => {
            throw new Error("offline");
          },
        },
      ),
      false,
    );
  } finally {
    console.warn = previous;
  }
  assert.ok(host.children.includes(furniture));
  assert.equal(host.userData.seats.length, 1);
  assert.ok(host.getObjectByName("kit:production-table-dressed")?.children.length);
  disposeTree(host);
});
test("successful dressing attachment preserves furniture ownership and replaces only its own fallback", async () => {
  const host = new T.Group(),
    furniture = new T.Group();
  host.add(furniture);
  let loads = 0;
  const load = async () => {
    loads++;
    const model = new T.Group();
    model.add(new T.Mesh(new T.BoxGeometry(0.1, 0.1, 0.1), new T.MeshStandardMaterial()));
    return model;
  };
  assert.equal(
    await attachCreativeStudioKit(
      host,
      { type: "studio_round_table", variant: "idea-table" },
      { load },
    ),
    true,
  );
  assert.ok(host.children.includes(furniture));
  assert.equal(loads, 1);
  assert.equal(host.getObjectByName("kit:round-ideation-dressed")?.children.length, 1);
  assert.equal(await attachCreativeStudioKit(host, { type: "unknown" }, { load }), false);
  assert.equal(loads, 1);
  disposeTree(host);
});

test("decorative extras stay within existing solid floor cells", () => {
  const map = tiledSnapshot(buildOfficeEnvironment("agency")),
    blocked = new Set(map.blocked);
  for (const placement of creativeStudioDecorations()) {
    const id = creativeStudioKitFor(placement.object)!;
    const def = sceneAsset(id),
      host = new T.Group();
    const cube = new T.Mesh(
      new T.BoxGeometry(
        def.bounds.max[0] - def.bounds.min[0],
        0.1,
        def.bounds.max[2] - def.bounds.min[2],
      ),
    );
    host.add(cube);
    if (id === "art-wall-dressed")
      assert.ok(
        placement.position[2] + def.bounds.min[2] >
          0.14 + sceneAsset("shared-brick-panel").bounds.max[2],
        "gallery backing clears the rear brick face",
      );
    const [x, y, z] = placement.position;
    host.position.set(x, y, z);
    host.rotation.y = placement.rotationY;
    const bounds = new T.Box3().setFromObject(host);
    for (let x = Math.floor(bounds.min.x); x <= Math.floor(bounds.max.x); x++)
      for (let z = Math.floor(bounds.min.z); z <= Math.floor(bounds.max.z); z++)
        assert.ok(blocked.has(`${x},${z}`), `${id} adds unblocked floor geometry at ${x},${z}`);
    disposeTree(host);
  }
  const fallback = buildCreativeStudioKitFallback("photo-cyclorama");
  fallback.updateMatrixWorld(true);
  const hit = new T.Raycaster(new T.Vector3(1, 1, 1), new T.Vector3(0, -1, 0)).intersectObject(
    fallback,
    true,
  )[0];
  assert.ok(hit && hit.point.y > 0.035);
  disposeTree(fallback);
});
