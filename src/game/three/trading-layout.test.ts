import test from "node:test";
import assert from "node:assert/strict";
import { buildOfficeEnvironment } from "./office-environments";
import { TRADING_ENTRANCE } from "./trading-layout";
import { tiledSnapshot } from "./tiled-preview";
import { furnitureSeats } from "./seating";
import { clearSegment, findPath } from "../navigation";
test("all trading seating anchors have body-clear routes from the shared entrance", () => {
  const snapshot = tiledSnapshot(buildOfficeEnvironment("trading"));
  const blocked = new Set(snapshot.blocked);
  const walkable = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < snapshot.cols && y < snapshot.rows && !blocked.has(`${x},${y}`);
  const spawn = { col: TRADING_ENTRANCE.spawnCol, row: TRADING_ENTRANCE.spawnRow };
  const seats = furnitureSeats(snapshot.objects);
  assert.ok(seats.length >= 50);
  for (const seat of seats) {
    const x = Math.floor((seat.anchorX ?? seat.x) - 0.5);
    const y = Math.floor((seat.anchorZ ?? seat.z) - 0.5);
    const route = findPath(spawn.col, spawn.row, x, y, walkable, (a, b) =>
      clearSegment(a, b, walkable),
    );
    assert.ok(route, `reachable seat ${x},${y}`);
    for (let i = 1; i < route.length; i++)
      assert.ok(clearSegment(route[i - 1], route[i], walkable));
  }
});

test("trading reference keeps six four-seat work islands and a genuinely blocked U-shaped void", () => {
  const snapshot = tiledSnapshot(buildOfficeEnvironment("trading"));
  assert.equal(snapshot.cols, 44);
  assert.equal(snapshot.rows, 30);
  assert.equal(
    snapshot.objects.filter((o) => o.type === "chair" && o.destinationTags?.includes("work"))
      .length,
    24,
  );
  assert.equal(
    snapshot.objects.filter((o) => o.type === "chair" && o.destinationTags?.includes("conference"))
      .length,
    12,
  );
  assert.equal(furnitureSeats(snapshot.objects).length, 55);
  const blocked = new Set(snapshot.blocked);
  for (let y = 19; y < 30; y++) for (let x = 18; x < 26; x++) assert.ok(blocked.has(`${x},${y}`));
  assert.equal(blocked.has("37,27"), false);
});

test("every room doorway stays open and purpose-only offices remain separate ambient zones", () => {
  const map = buildOfficeEnvironment("trading");
  const blocked = new Set(tiledSnapshot(map).blocked);
  for (const room of TRADING_ROOMS)
    for (const cell of room.doorCells) {
      const col =
        room.doorSide === "front" ? cell : room.doorSide === "left" ? room.westCol : room.eastCol;
      const row = room.doorSide === "front" ? room.frontRow : cell;
      assert.equal(blocked.has(`${col},${row}`), false, `${room.id} doorway ${col},${row}`);
    }
  assert.deepEqual(
    TRADING_ROOMS.filter((r) => !r.roaming).map((r) => r.id),
    ["director", "manager", "sales-office"],
  );
});

import { TRADING_ROOMS } from "./trading-layout";
import { officeFootprintLayers, furnishRoomBoundary } from "./office-layout-modules";
test("room boundaries and floor masks are independent of trading-map dimensions", () => {
  const walls: string[] = [];
  furnishRoomBoundary(
    (_type, x, y) => walls.push(`${x},${y}`),
    {
      id: "test",
      westCol: 0,
      eastCol: 12,
      backRow: 0,
      frontRow: 5,
      doorSide: "front",
      doorCells: [3, 4],
      roaming: true,
    },
    "test",
    { westCol: 0, eastCol: 12, backRow: 0 },
  );
  assert.deepEqual(walls, ["1,5", "2,5", "5,5", "6,5", "7,5", "8,5", "9,5", "10,5", "11,5"]);
  assert.deepEqual(
    officeFootprintLayers(3, 2, (x, y) => x !== 1 || y !== 1),
    { floor: [1, 1, 1, 1, 0, 1], collision: [0, 0, 0, 0, 1, 0] },
  );
});
