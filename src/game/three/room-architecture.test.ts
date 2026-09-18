import type { TiledMap } from "../../lib/tiled-map";
import test from "node:test";
import assert from "node:assert/strict";
import * as T from "three";
import { addRoomPartition, addRoomTJunction } from "./room-architecture";
import { PUBLISHING_ROOMS } from "./publishing-room-layout";
import { batchStaticFurniture } from "./static-batching";
import publishingV2 from "../../lib/fixtures/official-publishing-v2.json";
import { tiledSnapshot } from "./tiled-preview";

test("full-height glass partitions remain visible after static batching", () => {
  const world = new T.Group();
  for (const vertical of [false, true]) {
    const parent = new T.Group();
    world.add(parent);
    addRoomPartition(parent, vertical);
  }
  batchStaticFurniture(world);
  const panes: T.Mesh[] = [];
  world.traverseVisible((object) => {
    if (
      object instanceof T.Mesh &&
      object.material instanceof T.MeshStandardMaterial &&
      object.material.transparent
    )
      panes.push(object);
  });
  assert.equal(panes.length, 2);
  for (const pane of panes) {
    const bounds = new T.Box3().setFromObject(pane);
    assert.ok(bounds.min.y < 0.1, "glass reaches the floor rail");
    assert.ok(bounds.max.y > 1.75, "glass reaches the top rail");
    assert.ok((pane.material as T.MeshStandardMaterial).opacity <= 0.15);
  }
});

test("legacy publishing v2 rooms keep two-tile doors and a continuous two-tile corridor", () => {
  const snapshot = tiledSnapshot(publishingV2 as TiledMap);
  const blocked = new Set(snapshot.blocked);
  for (const room of PUBLISHING_ROOMS) {
    for (let x: number = room.x; x < room.x + room.width; x++) {
      const door = x === room.door || x === room.door + 1;
      assert.equal(blocked.has(`${x},8`), !door, `${room.id}: boundary at ${x},8`);
    }
    for (const x of [room.door, room.door + 1])
      for (const z of [7, 8, 9, 10])
        assert.equal(blocked.has(`${x},${z}`), false, `${room.id}: clear doorway approach`);
  }
  for (const x of [9, 20])
    for (let z = 1; z <= 8; z++) assert.ok(blocked.has(`${x},${z}`), "room separator collision");
  for (let x = 1; x <= 28; x++)
    for (const z of [9, 10]) assert.equal(blocked.has(`${x},${z}`), false, "two-tile corridor");
});

test("T junction joins both corridor rails and has no divider stub beyond their axis", () => {
  const joint = new T.Group();
  addRoomTJunction(joint);
  const bounds = new T.Box3().setFromObject(joint);
  assert.ok(Math.abs(bounds.min.x + 0.5) < 0.001);
  assert.ok(Math.abs(bounds.max.x - 0.5) < 0.001);
  assert.ok(Math.abs(bounds.min.z + 0.5) < 0.001);
  assert.ok(bounds.max.z <= 0.076, "only the shared post extends beyond the corridor axis");
  const center = new T.Raycaster(new T.Vector3(0, 0.9, 1), new T.Vector3(0, 0, -1));
  assert.ok(
    center.intersectObject(joint, true).length > 0,
    "shared junction post closes the corner",
  );
});
