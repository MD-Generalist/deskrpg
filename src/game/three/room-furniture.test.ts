import { strict as assert } from "node:assert";
import { test } from "node:test";
import { Box3, Mesh } from "three";
import { buildRoomFurniture } from "./room-furniture";

const footprints: Record<string, number> = {
  conference_table: 4,
  office_sofa: 2,
  office_armchair: 1,
  low_cabinet: 2,
  kitchen_counter: 2,
  refrigerator: 1,
  microwave_cabinet: 1,
  cup_shelf: 1,
  recycling_bins: 1,
  office_printer: 1,
  coat_rack: 1,
  meeting_display: 2,
  floor_lamp: 1,
  office_locker: 1,
};

test("room furniture respects its navigation footprint and stands on the floor", () => {
  for (const [type, width] of Object.entries(footprints)) {
    const group = buildRoomFurniture(type);
    assert.ok(group, type);
    const bounds = new Box3().setFromObject(group);
    assert.ok(Math.abs(bounds.min.y) < 1e-6, `${type} must touch the floor`);
    assert.ok(bounds.min.x >= -width / 2 && bounds.max.x <= width / 2, `${type} width`);
    const depth = type === "conference_table" ? 2 : 1;
    assert.ok(bounds.min.z >= -depth / 2 && bounds.max.z <= depth / 2, `${type} depth`);
    assert.ok(bounds.max.y < 2.1, `${type} must fit below room partitions`);
    group.traverse((object) => {
      if (object instanceof Mesh) {
        for (const material of Array.isArray(object.material)
          ? object.material
          : [object.material]) {
          assert.ok(
            material.userData.surface === undefined ||
              ["wood", "fabric", "leather", "metal", "book"].includes(material.userData.surface),
            `${type} valid surface tag`,
          );
        }
        const positions = object.geometry.getAttribute("position");
        assert.ok(Array.from(positions.array).every(Number.isFinite), `${type} finite vertices`);
      }
    });
  }
});

test("unsupported room furniture falls back to the existing object renderer", () => {
  assert.equal(buildRoomFurniture("meeting_table"), null);
  assert.equal(buildRoomFurniture("unknown"), null);
});

test("executive furniture keeps existing collision and seat footprints", () => {
  for (const [type, width, depth] of [
    ["reception_desk", 2, 1],
    ["meeting_table", 2, 2],
    ["conference_table", 4, 2],
    ["chair", 1, 1],
    ["bookshelf", 1, 1],
    ["office_sofa", 2, 1],
    ["office_armchair", 1, 1],
  ] as const) {
    const model = buildRoomFurniture(type, true);
    assert.ok(model);
    const bounds = new Box3().setFromObject(model);
    assert.ok(bounds.min.x >= -width / 2 && bounds.max.x <= width / 2, `${type} width`);
    assert.ok(bounds.min.z >= -depth / 2 && bounds.max.z <= depth / 2, `${type} depth`);
    assert.ok(bounds.min.y >= -0.001, `${type} above floor`);
  }
});
