import { test } from "node:test";
import assert from "node:assert/strict";
import { idleMotion } from "./idle-motion";
import { detailSurfaces } from "./surface-detail";
import { disposeTree } from "./office-renderer";
import * as T from "three";
test("idle gestures have pauses and stay bounded; walking suppresses them", () => {
  let rests = 0,
    gestures = 0;
  for (let t = 0; t < 60; t += 0.1) {
    const motion = idleMotion(t, 3, false, "idle");
    assert.ok(Math.abs(motion.yaw) <= 0.38 && motion.hand >= 0 && motion.hand <= 1);
    if (!motion.hand) rests++;
    else gestures++;
    assert.deepEqual(idleMotion(t, 3, true, "idle"), { yaw: 0, nod: 0, hand: 0, sway: 0 });
  }
  assert.ok(rests > gestures && gestures > 0);
  assert.notDeepEqual(idleMotion(1, 0, false, "idle"), idleMotion(1, 1, false, "idle"));
});
test("material detail shares textures inside a tree and disposes them once", () => {
  const root = new T.Group();
  const a = new T.MeshStandardMaterial({ color: "#abcdef" });
  const b = a.clone();
  root.add(new T.Mesh(new T.BoxGeometry(), a), new T.Mesh(new T.BoxGeometry(), b));
  detailSurfaces(root, ["#abcdef"], []);
  assert.ok(a.bumpMap);
  assert.equal(a.bumpMap, b.bumpMap);
  let disposals = 0;
  a.bumpMap.addEventListener("dispose", () => disposals++);
  disposeTree(root);
  assert.equal(disposals, 1);
  assert.equal(root.children.length, 0);
});
