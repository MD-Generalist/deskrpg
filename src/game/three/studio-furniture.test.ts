import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import * as T from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { buildStudioFurnitureFallback, studioFurnitureAsset } from "./studio-furniture";
import { sceneAsset, SCENE_ASSETS, attachSceneAsset } from "./scene-asset-catalog";
import { assetSeats, furnitureSeats, commonAreaSeats, seatAt } from "./seating";
import { buildOfficeEnvironment } from "./office-environments";
import { tiledSnapshot } from "./tiled-preview";
import { deriveChannelMotionLayout } from "../../lib/channel-motion-layout";
import { getObjectDimensions, type MapObject } from "../../lib/object-types";
import { findPath, clearSegment } from "../navigation";
import { disposeTree } from "./dispose-tree";
import { attachFurnitureSeats, pickFurnitureSeat } from "./seat-picking";

const inventory = [
  "workstation",
  "office-chair",
  "side-chair",
  "round-table",
  "production-table",
  "curved-sofa",
  "sofa",
  "armchair",
  "stool",
  "credenza",
  "low-shelf",
  "mobile-board",
  "round-rug",
  "woven-rug",
  "counter",
  "conference-table",
  "coffee-table",
] as const;

test("reusable studio furniture assets have actual PBR slots, GLBs and measured budgets", async () => {
  const report = JSON.parse(
    await readFile("public/assets/shared/furniture/build-report.json", "utf8"),
  );
  for (const name of inventory) {
    const id = `shared-${name}` as keyof typeof SCENE_ASSETS;
    const asset = sceneAsset(id);
    assert.equal(asset.category, "furniture");
    assert.ok(asset.url.startsWith("/assets/shared/furniture/"));
    assert.ok(report[name].triangles <= asset.budget.maxTriangles);
    const bytes = await readFile(`public${asset.url}`);
    assert.equal(bytes.length, report[name].bytes);
    const gltf = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString());
    const principal = gltf.materials.filter((m: { name: string }) =>
      ["oak", "upholstery", "Cream linen"].includes(m.name),
    );
    assert.ok(principal.length);
    for (const material of principal) {
      assert.ok(material.normalTexture);
      assert.ok(material.pbrMetallicRoughness.baseColorTexture);
      assert.ok(material.pbrMetallicRoughness.metallicRoughnessTexture);
    }
    assert.ok(asset.materialSlots?.oak || asset.materialSlots?.upholstery);
  }
});

test("all studio layout furniture variants resolve to bounded nonempty fallbacks; legacy stays opt-in", () => {
  const map = tiledSnapshot(buildOfficeEnvironment("agency"));
  for (const object of map.objects) {
    const selected = studioFurnitureAsset(object);
    if (!selected) continue;
    const fallback = buildStudioFurnitureFallback(object.type, object.variant);
    assert.ok(fallback, object.type);
    const box = new T.Box3().setFromObject(fallback);
    const asset = sceneAsset(selected.id);
    for (let axis = 0; axis < 3; axis++) {
      assert.ok(
        box.min.getComponent(axis) >= asset.bounds.min[axis] - 0.001,
        `${object.type} fallback minimum`,
      );
      assert.ok(
        box.max.getComponent(axis) <= asset.bounds.max[axis] + 0.001,
        `${object.type} fallback maximum`,
      );
    }
    assert.ok(fallback.children.length);
    disposeTree(fallback);
  }
  assert.equal(studioFurnitureAsset({ type: "chair" }), undefined);
  assert.equal(
    studioFurnitureAsset({ type: "office_armchair", variant: "executive-lounge" }),
    undefined,
  );
  assert.equal(buildStudioFurnitureFallback("photo_camera", "tripod"), null);
});

test("studio supplies 13 sofa/stool seats, 57 distinct anchors and expanded shared destinations", () => {
  const objects = tiledSnapshot(buildOfficeEnvironment("agency")).objects;
  const seats = furnitureSeats(objects);
  assert.equal(seats.length, 57);
  assert.equal(new Set(seats.map((s) => `${s.anchorX},${s.anchorZ}`)).size, 57);
  assert.equal(
    objects.filter((o) => ["studio_sofa", "studio_stool"].includes(o.type)).flatMap(assetSeats)
      .length,
    13,
  );
  assert.equal(commonAreaSeats(objects).length, 42);
  for (const seat of seats) {
    assert.ok(Number.isInteger(seat.anchorX! - 0.5));
    assert.ok(Number.isInteger(seat.anchorZ! - 0.5));
    assert.equal(seatAt(seats, seat.anchorX!, seat.anchorZ!, false), seat);
  }
});

test("sofa and stool catalog anchors rotate on integer tiles independently of visual poses", () => {
  for (const type of ["studio_sofa", "studio_stool"])
    for (const direction of ["down", "right", "up", "left"] as const) {
      const object: MapObject = {
        id: type,
        type,
        col: 10,
        row: 11,
        direction,
        variant: type === "studio_sofa" ? "curved-off-white" : "oak",
      };
      const seats = assetSeats(object),
        size = getObjectDimensions(type, direction);
      const cx = object.col + size.width / 2,
        cz = object.row + size.height / 2;
      const forward = { down: [0, 1], right: [1, 0], up: [0, -1], left: [-1, 0] }[direction];
      assert.equal(seats.length, type === "studio_sofa" ? 3 : 1);
      for (const seat of seats) {
        assert.equal(seat.direction, direction);
        assert.ok(Number.isInteger(seat.anchorX! - 0.5));
        assert.ok(Number.isInteger(seat.anchorZ! - 0.5));
        if (type === "studio_sofa") {
          assert.equal(
            Math.round(
              ((seat.anchorX! - cx) * forward[0] + (seat.anchorZ! - cz) * forward[1]) * 100,
            ),
            100,
          );
          assert.ok((seat.x - cx) * forward[0] + (seat.z - cz) * forward[1] < 0.5);
          assert.equal(seat.elevation, 0.055);
        } else assert.equal(seat.elevation, 0.24);
      }
    }
});

test("all 57 anchors are body-clear, reversible and identical in persisted server projection", () => {
  const map = buildOfficeEnvironment("agency");
  const snapshot = tiledSnapshot(map);
  const blocked = new Set(snapshot.blocked);
  const walkable = (x: number, y: number) =>
    x >= 0 && x < 42 && y >= 0 && y < 26 && !blocked.has(`${x},${y}`);
  const seats = furnitureSeats(snapshot.objects);
  assert.equal(seats.length, 57);
  for (const seat of seats) {
    const x = seat.anchorX! - 0.5,
      y = seat.anchorZ! - 0.5;
    assert.ok(walkable(x, y));
    const route = findPath(23, 23, x, y, walkable, (a, b) => clearSegment(a, b, walkable));
    assert.ok(route, `${x},${y}`);
    for (let i = 1; i < route.length; i++) {
      assert.ok(clearSegment(route[i - 1], route[i], walkable));
      assert.ok(clearSegment(route[i], route[i - 1], walkable));
    }
  }
  const layout = deriveChannelMotionLayout({ mapData: map }, []);
  assert.ok(layout);
  assert.deepEqual(
    new Set(layout.seats.map((s) => `${s.x}:${s.y}`)),
    new Set(seats.map((s) => `${s.anchorX! * 32}:${s.anchorZ! * 32}`)),
  );
});

test("catalog seat picking uses each rotated cushion pose and returns its navigation anchor", () => {
  const root = new T.Group();
  const object: MapObject = {
    id: "sofa",
    type: "studio_sofa",
    col: 5,
    row: 5,
    direction: "right",
    variant: "curved-off-white",
  };
  const furniture = buildStudioFurnitureFallback(object.type, object.variant)!;
  const size = getObjectDimensions(object.type, object.direction);
  furniture.position.set(object.col + size.width / 2, 0, object.row + size.height / 2);
  furniture.rotation.y = Math.PI / 2;
  attachFurnitureSeats(furniture, object);
  root.add(furniture);
  root.updateMatrixWorld(true);
  const seats = assetSeats(object);
  for (const seat of seats) {
    const ray = new T.Raycaster(new T.Vector3(seat.x, 3, seat.z), new T.Vector3(0, -1, 0));
    const picked = pickFurnitureSeat(ray, [root]);
    assert.ok(picked);
    assert.equal(picked.seat?.anchorX, seat.anchorX);
    assert.equal(picked.seat?.anchorZ, seat.anchorZ);
  }
  disposeTree(root);
});

test("shared side-chair color variants replace only explicit upholstery slots", async () => {
  const asset = sceneAsset("shared-side-chair");
  const bytes = await readFile(`public${asset.url}`);
  const loader = new GLTFLoader();
  loader.register(() => ({ name: "EXT_texture_webp", loadTexture: async () => new T.Texture() }));
  const source = (
    await loader.parseAsync(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      "",
    )
  ).scene;
  for (const variant of ["off-white", "teal", "coral", "mustard", "neutral"]) {
    const host = new T.Group();
    assert.equal(
      await attachSceneAsset(host, "shared-side-chair", { variant, load: async () => source }),
      true,
    );
    let matched = 0;
    host.traverse((o) => {
      if (
        o instanceof T.Mesh &&
        o.material instanceof T.MeshStandardMaterial &&
        o.material.name === asset.materialSlots?.upholstery
      ) {
        matched++;
        assert.equal(
          o.material.color.getHexString(),
          asset.variants![variant].upholstery!.slice(1),
        );
      }
    });
    assert.ok(matched);
    disposeTree(host);
  }
  disposeTree(source);
});

test("server seat metadata dependency graph excludes Three and GLTFLoader runtime", async () => {
  const { resolve, dirname } = await import("node:path");
  const visited = new Set<string>();
  const pending = [
    resolve("src/game/three/seating.ts"),
    resolve("src/game/three/scene-asset-definitions.ts"),
  ];
  while (pending.length) {
    const file = pending.pop()!;
    if (visited.has(file)) continue;
    visited.add(file);
    const source = await readFile(file, "utf8");
    assert.ok(!source.includes("GLTFLoader"), file);
    for (const match of source.matchAll(/(?:import|export)[\s\S]*?from\s*["']([^"']+)["']/g)) {
      const specifier = match[1];
      assert.ok(!/^three(?:\/|$)/.test(specifier), `${file}: ${specifier}`);
      if (specifier.startsWith(".")) pending.push(resolve(dirname(file), specifier + ".ts"));
    }
  }
  assert.ok(visited.has(resolve("src/game/three/scene-asset-definitions.ts")));
});
