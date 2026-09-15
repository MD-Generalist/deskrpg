import test from "node:test";
import assert from "node:assert/strict";
import { buildOfficeEnvironment } from "./office-environments";
import { PUBLISHING_ENTRANCE } from "./publishing-layout";
import { tiledSnapshot } from "./tiled-preview";
import { furnitureSeats } from "./seating";
import { clearSegment, findPath } from "../navigation";
test("all publishing seating anchors have body-clear routes from the shared entrance", () => {
  const snapshot = tiledSnapshot(buildOfficeEnvironment("publishing"));
  const blocked = new Set(snapshot.blocked);
  const walkable = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < snapshot.cols && y < snapshot.rows && !blocked.has(`${x},${y}`);
  const spawn = { col: PUBLISHING_ENTRANCE.spawnCol, row: PUBLISHING_ENTRANCE.spawnRow };
  const seats = furnitureSeats(snapshot.objects);
  assert.ok(seats.length === 25);
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

test("publishing reference has three four-seat islands and a continuous wall library", () => {
  const snapshot = tiledSnapshot(buildOfficeEnvironment("publishing"));
  assert.deepEqual([snapshot.cols, snapshot.rows], [30, 26]);
  assert.equal(
    snapshot.objects.filter((o) => o.type === "chair" && o.destinationTags?.includes("work"))
      .length,
    12,
  );
  assert.equal(snapshot.objects.filter((o) => o.variant?.startsWith("pub-library")).length, 5);
  assert.equal(snapshot.objects.filter((o) => o.variant === "pub-newbook-display").length, 10);
});

test("publishing doorway and every open floor cell connect to the entrance", () => {
  const snapshot = tiledSnapshot(buildOfficeEnvironment("publishing"));
  const blocked = new Set(snapshot.blocked);
  for (const row of [6, 7]) assert.equal(blocked.has(`8,${row}`), false);
  const queue: [number, number][] = [[PUBLISHING_ENTRANCE.spawnCol, PUBLISHING_ENTRANCE.spawnRow]];
  const visited = new Set([queue[0].join(",")]);
  for (let i = 0; i < queue.length; i++) {
    const [x, y] = queue[i];
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const a = x + dx,
        b = y + dy,
        k = `${a},${b}`;
      if (
        a < 0 ||
        b < 0 ||
        a >= snapshot.cols ||
        b >= snapshot.rows ||
        blocked.has(k) ||
        visited.has(k)
      )
        continue;
      visited.add(k);
      queue.push([a, b]);
    }
  }
  for (let y = 0; y < snapshot.rows; y++)
    for (let x = 0; x < snapshot.cols; x++)
      if (!blocked.has(`${x},${y}`))
        assert.ok(visited.has(`${x},${y}`), `isolated floor ${x},${y}`);
});
