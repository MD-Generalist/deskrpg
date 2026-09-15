import assert from "node:assert/strict";
import { test } from "node:test";
import * as T from "three";
import { MeetingWallOcclusion } from "./meeting-wall-occlusion";

test("only intervening walls fade; shared glass material is isolated and restored", () => {
  const glass = new T.MeshPhysicalMaterial({
    transparent: true,
    opacity: 0.4,
    depthWrite: true,
    transmission: 0.7,
  });
  const wall = new T.Mesh(new T.BoxGeometry(3, 3, 0.2), glass);
  const other = new T.Mesh(wall.geometry, glass);
  wall.position.set(0, 1, 3);
  other.position.set(8, 1, 3);
  wall.updateMatrixWorld(true);
  other.updateMatrixWorld(true);
  const instances = new T.InstancedMesh(wall.geometry, glass, 2);
  const matrix = new T.Matrix4().makeTranslation(0, 1, 3);
  instances.setMatrixAt(0, matrix);
  instances.setMatrixAt(1, new T.Matrix4().makeTranslation(8, 1, 3));
  const occlusion = new MeetingWallOcclusion();
  occlusion.enter([wall, other, instances]);
  occlusion.update(new T.Vector3(0, 1, 7), [new T.Vector3(0, 1, 0)]);
  assert.notEqual(wall.material, glass);
  assert.equal(wall.material.opacity, 0.12);
  assert.equal(wall.material.transmission, 0.7);
  assert.equal(wall.material.depthWrite, false);
  assert.equal(other.material, glass);
  assert.equal(glass.opacity, 0.4);
  assert.equal(instances.material, glass);
  const unchanged = new T.Matrix4();
  instances.getMatrixAt(0, unchanged);
  assert.ok(unchanged.equals(matrix));
  let disposed = false;
  wall.material.addEventListener("dispose", () => {
    disposed = true;
  });
  occlusion.update(new T.Vector3(0, 1, -7), [new T.Vector3(0, 1, 0)]);
  assert.equal(wall.material, glass);
  assert.equal(disposed, true);
  occlusion.enter([wall]);
  occlusion.update(new T.Vector3(0, 1, 7), [new T.Vector3(0, 1, 0)]);
  occlusion.dispose();
  assert.equal(wall.material, glass);
  assert.equal(glass.depthWrite, true);
});
