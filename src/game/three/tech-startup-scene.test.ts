import test from "node:test";
import assert from "node:assert/strict";
import { isTechStartupMap, techPartitionSpan } from "./tech-startup-scene";
import { TECH_STARTUP_BOUNDARIES } from "./tech-startup-layout";

test("tech corner frames reach the exact rear and front wall axes", () => {
  for (const room of Object.values(TECH_STARTUP_BOUNDARIES)) {
    const first = techPartitionSpan({
      id: "first",
      type: "glass_partition",
      col: room.eastCol,
      row: 1,
      direction: "right",
    });
    const last = techPartitionSpan({
      id: "last",
      type: "glass_partition",
      col: room.eastCol,
      row: room.frontRow - 1,
      direction: "right",
    });
    const front = techPartitionSpan({
      id: "front",
      type: "glass_partition",
      col: room.eastCol,
      row: room.frontRow,
    });
    assert.equal(first.z - first.length / 2, 0.5);
    assert.equal(last.z + last.length / 2, front.z);
    assert.equal(front.x + front.length / 2, last.x);
  }
});
test("new tech finishes require explicit v3 metadata", () => {
  assert.equal(isTechStartupMap({ environment: "tech", environmentVersion: 3 }), true);
  assert.equal(isTechStartupMap({ environment: "tech", environmentVersion: 2 }), false);
  assert.equal(isTechStartupMap({ environment: "tech" }), false);
  assert.equal(isTechStartupMap({ environment: "agency", environmentVersion: 5 }), false);
});
