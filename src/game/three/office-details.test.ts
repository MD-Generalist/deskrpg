import { test } from "node:test";
import assert from "node:assert/strict";
import * as T from "three";
import { addOfficeDetails } from "./office-details";

for (const type of [
  "desk",
  "bookshelf",
  "meeting_table",
  "reception_desk",
  "chair",
  "computer",
  "whiteboard",
  "coffee",
  "plant",
  "cubicle_wall",
]) {
  test(`${type} details stay inside the existing footprint with finite geometry`, () => {
    const group = new T.Group();
    assert.equal(addOfficeDetails(group, type, "#a17b4f", "#dfd0ab", true), true);
    const bounds = new T.Box3().setFromObject(group);
    const size = bounds.getSize(new T.Vector3());
    const limit = type === "meeting_table" || type === "reception_desk" ? 2 : 1.01;
    assert.ok(size.x <= limit && size.z <= limit, `${type}: ${size.toArray()}`);
    assert.ok(Number.isFinite(size.y) && size.y > 0 && size.y < 3);
    group.traverse((object) => {
      if (!(object instanceof T.Mesh)) return;
      object.geometry.dispose();
      for (const material of Array.isArray(object.material) ? object.material : [object.material])
        material.dispose();
    });
  });
}
