import test from "node:test";
import assert from "node:assert/strict";
import * as T from "three";
import { createSeatHighlight } from "./seat-highlight";

test("batched invisible seat proxies produce a visible tint without mutating the chair", () => {
  const owner = new T.Group();
  owner.position.set(3, 0, 4);
  owner.userData.seat = { x: 3, z: 4 };
  const proxy = new T.Mesh(
    new T.BoxGeometry(1, 1, 1),
    new T.MeshStandardMaterial({ color: "#765432" }),
  );
  proxy.visible = false;
  proxy.userData.seatPickProxy = true;
  owner.add(proxy);
  owner.updateMatrixWorld(true);

  const highlight = createSeatHighlight(owner);
  const overlay = highlight.children[0] as T.Mesh;

  assert.equal(proxy.visible, false);
  assert.equal(highlight.children.length, 1);
  assert.equal(overlay.visible, true);
  assert.deepEqual(overlay.position.toArray(), [0, 0, 0]);
  assert.deepEqual(new T.Vector3().setFromMatrixPosition(overlay.matrix).toArray(), [3, 0, 4]);
});

test("non-seat decoration inside an owner is not tinted", () => {
  const owner = new T.Group();
  const decoration = new T.Mesh(new T.BoxGeometry(), new T.MeshStandardMaterial());
  owner.add(decoration);
  owner.updateMatrixWorld(true);

  assert.equal(createSeatHighlight(owner).children.length, 0);
});
