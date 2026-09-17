import test from "node:test";
import assert from "node:assert/strict";
import { OFFICE_LOOKS, officeLookAppearance, resolveOfficeLook } from "./office-looks";
import { validateOfficeAppearance } from "./office-appearance";
test("all fifty looks survive existing appearance validation and JSON roundtrip", () => {
  assert.equal(OFFICE_LOOKS.length, 50);
  assert.equal(new Set(OFFICE_LOOKS.map((l) => l.id)).size, 50);
  for (const look of OFFICE_LOOKS) {
    const appearance = officeLookAppearance(look.id);
    assert.equal(validateOfficeAppearance(appearance), null, look.id);
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
  assert.notEqual(a, b);
  a.bodyType = "female";
  assert.equal(b.bodyType, OFFICE_LOOKS[0].bodyType);
});

import * as T from "three";
import { createOfficeActor } from "./office-actor";
import { disposeTree } from "./office-renderer";
test("legacy procedural rigs have distinct geometry, stable identity and finite poses", () => {
  const silhouettes = new Set<string>();
  for (const [i, look] of OFFICE_LOOKS.entries()) {
    const actor = createOfficeActor("actor", look, i);
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
  assert.ok(silhouettes.size >= 35);
});

test("expanded wardrobe offers distinct structural options beyond palette changes", () => {
  for (const outfit of ["double-breasted", "hoodie", "labcoat"])
    assert.ok(
      OFFICE_LOOKS.some((look) => look.outfit === outfit),
      outfit,
    );
  for (const hair of ["bun", "long", "braids"])
    assert.ok(
      OFFICE_LOOKS.some((look) => look.hairStyle === hair),
      hair,
    );
  for (const accessory of ["badge", "headset", "notebook"])
    assert.ok(
      OFFICE_LOOKS.some((look) => look.accessory === accessory),
      accessory,
    );
  assert.ok(OFFICE_LOOKS.some((look) => look.bag === "backpack"));
  assert.ok(OFFICE_LOOKS.some((look) => look.skirtLength === "knee"));
  assert.equal(new Set(OFFICE_LOOKS.map((look) => look.name)).size, 50);
  for (const look of OFFICE_LOOKS) {
    assert.ok(look.subtitle.includes(" · ") && look.subtitleEn.includes(" · "), look.id);
    assert.ok(look.build >= 0.8 && look.build <= 1.4, look.id);
  }
});

test("new garment and accessory options change rendered geometry", () => {
  const base = OFFICE_LOOKS[0];
  const signature = (look: typeof base) => {
    const actor = createOfficeActor("test", look, 0);
    const shapes: string[] = [];
    actor.root.updateMatrixWorld(true);
    actor.root.traverse((object) => {
      if (object instanceof T.Mesh)
        shapes.push(
          JSON.stringify([
            object.geometry.getAttribute("position").count,
            object.matrixWorld.elements,
          ]),
        );
    });
    disposeTree(actor.root);
    return shapes.join("|");
  };
  const initial = signature(base);
  for (const change of [
    { hairStyle: "bun" },
    { hairStyle: "long" },
    { hairStyle: "braids" },
    { outfit: "double-breasted" },
    { outfit: "hoodie" },
    { outfit: "labcoat" },
    { neckwear: "bow" },
    { neckwear: "scarf" },
    { neckwear: "turtleneck" },
    { accessory: "headset" },
    { accessory: "notebook" },
    { bag: "backpack" },
    { lower: "skirt", skirtLength: "knee" },
  ] as const)
    assert.notEqual(signature({ ...base, ...change }), initial, JSON.stringify(change));
});

test("vest pinstripes and cardigan knit alter garment geometry independently of color", () => {
  const signature = (look: (typeof OFFICE_LOOKS)[number]) => {
    const actor = createOfficeActor("pattern", look, 0);
    const shapes: unknown[] = [];
    actor.root.updateMatrixWorld(true);
    actor.root.traverse((object) => {
      if (object instanceof T.Mesh) {
        object.geometry.computeBoundingBox();
        shapes.push([
          object.geometry.boundingBox?.min.toArray(),
          object.geometry.boundingBox?.max.toArray(),
          object.matrixWorld.elements,
        ]);
      }
    });
    disposeTree(actor.root);
    return JSON.stringify(shapes);
  };
  const vest = OFFICE_LOOKS.find((look) => look.id === "office-kyung")!;
  assert.notEqual(signature(vest), signature({ ...vest, pattern: undefined }));
  assert.notEqual(signature(vest), signature({ ...vest, pattern: "knit" }));
  const cardigan = OFFICE_LOOKS.find((look) => look.id === "office-eun")!;
  assert.notEqual(signature(cardigan), signature({ ...cardigan, pattern: undefined }));
});
