import test from "node:test";
import assert from "node:assert/strict";
import * as T from "three";
import { batchStaticFurniture } from "./static-batching";
import { pickFurnitureSeat } from "./seat-picking";
import { disposeTree } from "./office-renderer";

function fixture() {
  const root = new T.Group();
  const owners = [0, 3].map((x) => {
    const group = new T.Group();
    group.position.x = x;
    group.userData.seat = { x, z: 0 };
    group.add(new T.Mesh(new T.BoxGeometry(1, 1, 1), new T.MeshStandardMaterial()));
    root.add(group);
    return group;
  });
  batchStaticFurniture(root, true, { batchSeats: true, vertexColors: true });
  root.updateMatrixWorld(true);
  return { root, owners, ray: new T.Raycaster(new T.Vector3(0, 0, 5), new T.Vector3(0, 0, -1)) };
}
test("batched visible seat and its exact invisible proxy remain selectable", () => {
  const { root, owners, ray } = fixture();
  assert.equal(pickFurnitureSeat(ray, root.children)?.owner, owners[0]);
  disposeTree(root);
});
test("an opaque desk or wall blocks a seat behind it", () => {
  const { root, ray } = fixture();
  const wall = new T.Mesh(new T.BoxGeometry(2, 2, 0.2), new T.MeshStandardMaterial());
  wall.position.z = 2;
  root.add(wall);
  root.updateMatrixWorld(true);
  assert.equal(pickFurnitureSeat(ray, root.children), null);
  wall.position.x = 2;
  root.updateMatrixWorld(true);
  assert.ok(
    pickFurnitureSeat(ray, root.children),
    "moving the occluder out of the ray restores picking",
  );
  disposeTree(root);
});
test("transparent room glazing does not block the visible seat", () => {
  const { root, owners, ray } = fixture();
  const glass = new T.Mesh(
    new T.BoxGeometry(2, 2, 0.04),
    new T.MeshPhysicalMaterial({ transparent: true, opacity: 0.18 }),
  );
  glass.position.z = 2;
  root.add(glass);
  root.updateMatrixWorld(true);
  assert.equal(pickFurnitureSeat(ray, root.children)?.owner, owners[0]);
  disposeTree(root);
});
test("hidden seat owners are not pickable even when their proxies remain in the tree", () => {
  const { root, owners, ray } = fixture();
  owners[0].visible = false;
  assert.equal(pickFurnitureSeat(ray, root.children), null);
  disposeTree(root);
});
