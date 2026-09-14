import { test } from "node:test";
import assert from "node:assert/strict";
import { buildOfficeEnvironment } from "./office-environments";
import { projectTiledGeometry } from "../../lib/tiled-geometry";
import { resolveSeat, sofaSeats } from "./seating";

test("executive suite keeps large desk collision and separate entry reception", () => {
  const map = projectTiledGeometry(buildOfficeEnvironment("executive"));
  const desk = map.objects.find((o) => o.type === "executive_desk")!;
  assert.ok(desk);
  for (let x = 3; x < 7; x++)
    for (let z = 6; z < 8; z++) assert.ok(map.blocked.includes(`${x},${z}`));
  const reception = map.objects.find((o) => o.type === "reception_desk")!;
  assert.equal(reception.row, 14);
  assert.ok(!map.blocked.includes("9,15"));
  const manager = map.objects.find((o) => o.type === "chair" && o.row === 5)!;
  assert.equal(resolveSeat(manager, map.objects).x, desk.col + 2);
});

test("lounge directions survive Tiled projection and seats face the coffee table", () => {
  const map = projectTiledGeometry(buildOfficeEnvironment("executive"));
  const table = map.objects.find((o) => o.type === "meeting_table")!;
  for (const object of map.objects.filter((o) =>
    ["office_sofa", "office_armchair"].includes(o.type),
  )) {
    for (const seat of sofaSeats(object)) {
      const vector = { down: [0, 1], up: [0, -1], left: [-1, 0], right: [1, 0] }[seat.direction];
      assert.ok((table.col + 1 - seat.x) * vector[0] + (table.row + 0.5 - seat.z) * vector[1] > 0);
      assert.ok(!map.blocked.includes(`${Math.floor(seat.anchorX!)},${Math.floor(seat.anchorZ!)}`));
    }
  }
});
