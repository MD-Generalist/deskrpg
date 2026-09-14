import test from "node:test";
import assert from "node:assert/strict";
import * as T from "three";
import { OFFICE_FINISHES } from "./office-finishes";
import { officeLighting, shadowExtent } from "./office-lighting";
import { addOfficeDetails } from "./office-details";
import { detailSurfaces } from "./surface-detail";
import { disposeTree } from "./office-renderer";
for (const id of Object.keys(OFFICE_FINISHES) as (keyof typeof OFFICE_FINISHES)[]) {
  test(`${id}: finishes and props stay inside navigation footprint, with usable lighting`, () => {
    const root = new T.Group();
    addOfficeDetails(root, "desk", "#aa8855", "#eeeedd", false, id);
    detailSurfaces(root, ["#aa8855"], [OFFICE_FINISHES[id].upholstery], ["#35434b"]);
    const bounds = new T.Box3().setFromObject(root).getSize(new T.Vector3());
    assert.ok(bounds.x <= 1 && bounds.z <= 1);
    assert.ok(root.children.length > 10);
    const light = officeLighting(id);
    assert.ok(light.sunIntensity > 0 && light.fillIntensity > 0 && light.exposure > 0);
    let textured = 0;
    root.traverse((o) => {
      if (o instanceof T.Mesh && o.material instanceof T.MeshStandardMaterial && o.material.map)
        textured++;
    });
    assert.ok(textured > 0);
    disposeTree(root);
    assert.equal(root.children.length, 0);
  });
}
test("shadow extent contains map corners and tall furniture", () => {
  for (const [x, y] of [
    [30, 22],
    [80, 10],
    [10, 80],
  ])
    assert.ok(shadowExtent(x, y) > Math.hypot(x, y) / 2 + 3);
});
