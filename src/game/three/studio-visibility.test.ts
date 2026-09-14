import test from "node:test";
import assert from "node:assert/strict";
import * as T from "three";
import { studioLabelOccluded, applyStudioReflection } from "./studio-visibility";
test("labels disappear behind solid walls, remain through glazing and ignore invisible seat proxies", () => {
  const root = new T.Group(),
    wall = new T.Mesh(new T.BoxGeometry(2, 2, 0.2), new T.MeshStandardMaterial());
  wall.position.z = 2;
  root.add(wall);
  root.updateMatrixWorld(true);
  const origin = new T.Vector3(0, 0, 5),
    target = new T.Vector3();
  assert.equal(studioLabelOccluded(origin, target, root), true);
  wall.material.transparent = true;
  assert.equal(studioLabelOccluded(origin, target, root), false);
  wall.material.transparent = false;
  wall.visible = false;
  wall.userData.seatPickProxy = true;
  assert.equal(studioLabelOccluded(origin, target, root), false);
});
test("actual studio reflection binds only polished oak and glass", () => {
  const root = new T.Group(),
    floor = new T.Mesh(new T.BoxGeometry(), new T.MeshStandardMaterial()),
    glass = new T.Mesh(new T.BoxGeometry(), new T.MeshStandardMaterial({ transparent: true })),
    wall = new T.Mesh(new T.BoxGeometry(), new T.MeshStandardMaterial());
  floor.name = "continuous-pale-oak-floor";
  root.add(floor, glass, wall);
  const texture = new T.Texture();
  applyStudioReflection(root, texture);
  assert.equal(floor.material.envMap, texture);
  assert.equal(glass.material.envMap, texture);
  assert.equal(wall.material.envMap, null);
});
