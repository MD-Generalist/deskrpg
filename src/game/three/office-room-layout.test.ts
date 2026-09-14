import test from "node:test";
import assert from "node:assert/strict";
import * as T from "three";
import { OFFICE_ROOMS } from "./office-room-layout";
import { OFFICE_ENVIRONMENTS, buildOfficeEnvironment } from "./office-environments";
import { tiledSnapshot } from "./tiled-preview";
import { furnitureSeats } from "./seating";
import { getObjectDimensions } from "../../lib/object-types";
import { readAmbientZones, ambientTileAllowed } from "../ambient-zones";
import { findPath, clearSegment } from "../navigation";
import { addOfficeRoomSurfaces } from "./room-architecture";

for (const { id } of OFFICE_ENVIRONMENTS) {
  test(`${id}: distinct rooms share rendering, collision and ambient bounds`, () => {
    const map = buildOfficeEnvironment(id);
    const snapshot = tiledSnapshot(map);
    const blocked = new Set(snapshot.blocked);
    const zones = readAmbientZones(map as unknown as Record<string, unknown>);
    assert.equal(zones.length, 3);
    const rooms = OFFICE_ROOMS[id];
    if (id === "executive") {
      assert.ok(
        !snapshot.objects.some((o) => o.type.startsWith("room_wall")),
        "reference suite remains open",
      );
      assert.equal(ambientTileAllowed(zones, 4, 6), false, "private desk is excluded from roaming");
      assert.equal(ambientTileAllowed(zones, 12, 13), true, "lounge stays available");
      assert.equal(snapshot.objects.filter((o) => o.type === "conference_table").length, 1);
      assert.equal(snapshot.objects.filter((o) => o.type === "office_sofa").length, 1);
      return;
    }
    const boundary = rooms[0].z + rooms[0].depth;
    for (const room of rooms) {
      assert.deepEqual(
        zones.find((z) => z.id === room.id),
        {
          id: room.id,
          x: room.x,
          y: room.z,
          width: room.width,
          height: room.depth + 1,
          roaming: room.id !== "ceo",
        },
      );
      assert.equal(ambientTileAllowed(zones, room.door, boundary), room.id !== "ceo");
      for (let x = room.x; x < room.x + room.width; x++)
        assert.equal(blocked.has(`${x},${boundary}`), x !== room.door && x !== room.door + 1);
      for (const x of [room.door, room.door + 1])
        for (const z of [boundary - 1, boundary, boundary + 1, boundary + 2])
          assert.equal(blocked.has(`${x},${z}`), false, `${room.id}: doorway approach ${x},${z}`);
    }
    for (let x = 1; x < 29; x++)
      for (const z of [boundary + 1, boundary + 2]) assert.equal(blocked.has(`${x},${z}`), false);
    const world = new T.Group();
    addOfficeRoomSurfaces(world, id);
    const floors = world.children.filter(
      (o): o is T.Mesh => o instanceof T.Mesh && o.geometry instanceof T.PlaneGeometry,
    );
    assert.equal(floors.length, 3);
    for (let i = 0; i < rooms.length; i++) {
      assert.equal(floors[i].position.x, rooms[i].x + rooms[i].width / 2);
      assert.equal(floors[i].position.z, rooms[i].z + rooms[i].depth / 2);
    }
  });
  test(`${id}: footprints do not overlap and every seat has a reversible body-clear path`, () => {
    const snapshot = tiledSnapshot(buildOfficeEnvironment(id));
    const tiles = new Map<string, string>();
    for (const object of snapshot.objects) {
      // Computers intentionally sit on their supporting desks; all other footprints are exclusive.
      if (object.type === "computer") continue;
      const size = getObjectDimensions(object.type);
      for (let x = object.col; x < object.col + size.width; x++)
        for (let y = object.row; y < object.row + size.height; y++) {
          assert.ok(x >= 0 && x < snapshot.cols && y >= 0 && y < snapshot.rows, object.type);
          const tile = `${x},${y}`;
          assert.ok(!tiles.has(tile), `${object.type} overlaps ${tiles.get(tile)} at ${tile}`);
          tiles.set(tile, object.type);
        }
    }
    const blocked = new Set(snapshot.blocked);
    const walkable = (x: number, y: number) =>
      x >= 1 &&
      x < snapshot.cols - 1 &&
      y >= 1 &&
      y < snapshot.rows - 1 &&
      !blocked.has(`${x},${y}`);
    const seats = furnitureSeats(snapshot.objects);
    assert.ok(seats.length >= 12);
    for (const seat of seats) {
      const x = (seat.anchorX ?? seat.x) - 0.5,
        y = (seat.anchorZ ?? seat.z) - 0.5;
      const route = findPath(Math.floor(snapshot.cols / 2), snapshot.rows - 3, x, y, walkable);
      assert.ok(route, `unreachable seat ${x},${y}`);
      for (let i = 1; i < route.length; i++) {
        assert.ok(clearSegment(route[i - 1], route[i], walkable));
        assert.ok(clearSegment(route[i], route[i - 1], walkable));
      }
    }
  });
}
test("five suites differ by room footprints and order, not just finishes", () => {
  assert.equal(
    new Set(
      Object.values(OFFICE_ROOMS).map((rooms) =>
        JSON.stringify(rooms.map(({ id, x, width, depth }) => [id, x, width, depth])),
      ),
    ).size,
    5,
  );
});
