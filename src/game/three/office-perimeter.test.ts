import test from "node:test";
import assert from "node:assert/strict";
import * as T from "three";
import { officePerimeterRuns, addOfficePerimeter } from "./office-perimeter";
test("four exterior corners share exact endpoints while entrance stays open", () => {
  const runs = officePerimeterRuns(30, 22);
  const counts = new Map<string, number>();
  for (const r of runs)
    for (const [x, z] of [
      [r.x1, r.z1],
      [r.x2, r.z2],
    ]) {
      const key = `${x},${z}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  for (const key of ["0.5,0.5", "29.5,0.5", "0.5,21.5", "29.5,21.5"])
    assert.equal(counts.get(key), 2);
  assert.equal(counts.get("14,21.5"), 1);
  assert.equal(counts.get("17,21.5"), 1);
  assert.equal(
    runs.filter((r) => r.z1 === 21.5 && r.z2 === 21.5).some((r) => r.x1 < 15 && r.x2 > 15),
    false,
  );
});
test("every exterior run has capped posts at both ends", () => {
  const root = new T.Group();
  addOfficePerimeter(root, 30, 22, "#eeeeee", "#aa8855");
  root.updateMatrixWorld(true);
  for (const r of officePerimeterRuns(30, 22))
    for (const [x, z] of [
      [r.x1, r.z1],
      [r.x2, r.z2],
    ]) {
      const point = new T.Vector3(x, r.height * 0.6, z);
      let supported = false;
      root.traverse((object) => {
        if (
          object instanceof T.Mesh &&
          object.material instanceof T.MeshStandardMaterial &&
          !object.material.transparent
        )
          supported ||= new T.Box3().setFromObject(object).containsPoint(point);
      });
      assert.ok(supported, `end post at ${x},${z}`);
    }
});
