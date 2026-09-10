import test from "node:test";
import assert from "node:assert/strict";
import { OFFICE_LOOKS, officeLookAppearance, resolveOfficeLook } from "./office-looks";
import { validateAppearance } from "../../lib/lpc-registry";
test("all ten looks survive existing appearance validation and JSON roundtrip", () => {
  assert.equal(OFFICE_LOOKS.length, 10);
  assert.equal(new Set(OFFICE_LOOKS.map((l) => l.id)).size, 10);
  for (const look of OFFICE_LOOKS) {
    const appearance = officeLookAppearance(look.id);
    assert.equal(validateAppearance(appearance), null, look.id);
    assert.equal(resolveOfficeLook(JSON.stringify(appearance))?.id, look.id);
  }
});
test("legacy, malformed and unknown appearances resolve safely", () => {
  for (const value of [null, undefined, 12, "broken", "null", {}, { officeLookId: "missing" }])
    assert.equal(resolveOfficeLook(value), undefined);
  assert.throws(() => officeLookAppearance("missing"));
});
test("one saved appearance cannot mutate another character", () => {
  const a = officeLookAppearance(OFFICE_LOOKS[0].id),
    b = officeLookAppearance(OFFICE_LOOKS[0].id);
  a.layers.body!.variant = "black";
  assert.equal(b.layers.body!.variant, "light");
});

import * as T from "three";
import { createActor } from "./characters";
import { disposeTree } from "./office-renderer";
test("lookbook rigs have distinct geometry, stable identity and finite poses", () => {
  const silhouettes = new Set<string>();
  for (const [i, look] of OFFICE_LOOKS.entries()) {
    const actor = createActor("actor", look.coat, i, undefined, look);
    assert.equal(actor.root.userData.officeLookId, look.id);
    const box = new T.Box3().setFromObject(actor.root);
    assert.ok(box.max.y > 1.8 && box.max.y < 2.2, look.id);
    const geometry: T.BufferGeometry[] = [];
    actor.root.traverse((o) => {
      if (o instanceof T.Mesh) geometry.push(o.geometry);
    });
    silhouettes.add(`${geometry.length}:${box.getSize(new T.Vector3()).x.toFixed(3)}`);
    actor.root.position.set(7, 0, 4);
    for (const phase of ["idle", "walking", "thinking", "streaming"] as const)
      for (const seated of [true, false]) {
        actor.update(5, phase === "walking", phase, seated);
        actor.root.updateMatrixWorld(true);
        actor.root.traverse((o) =>
          assert.ok(o.matrixWorld.elements.every(Number.isFinite), look.id),
        );
        assert.deepEqual(actor.root.position.toArray(), [7, 0, 4]);
      }
    let disposed = 0;
    geometry.forEach((g) => g.addEventListener("dispose", () => disposed++));
    disposeTree(actor.root);
    assert.equal(disposed, geometry.length);
  }
  assert.ok(silhouettes.size >= 9);
});
