import test from "node:test";
import assert from "node:assert/strict";
import * as T from "three";
import { furnishLegacyAgencyV2, LEGACY_AGENCY_V2_ROOMS, OFFICE_ROOMS } from "./office-room-layout";
import { OFFICE_ENVIRONMENTS, buildOfficeEnvironment } from "./office-environments";
import { tiledSnapshot } from "./tiled-preview";
import { furnitureSeats } from "./seating";
import { getObjectDimensions } from "../../lib/object-types";
import { readAmbientZones, ambientTileAllowed } from "../ambient-zones";
import { findPath, clearSegment } from "../navigation";
import { TECH_STARTUP_BOUNDARIES } from "./tech-startup-layout";
import { addOfficeRoomSurfaces } from "./room-architecture";

for (const { id } of OFFICE_ENVIRONMENTS) {
  test(`${id}: distinct rooms share rendering, collision and ambient bounds`, () => {
    const map = buildOfficeEnvironment(id);
    const snapshot = tiledSnapshot(map);
    const blocked = new Set(snapshot.blocked);
    const zones = readAmbientZones(map as unknown as Record<string, unknown>);
    if (id === "agency") {
      assert.equal(zones.length, 9);
      assert.equal(OFFICE_ROOMS.agency, undefined);
      assert.ok(!snapshot.objects.some((object) => object.type.startsWith("room_wall")));
      return;
    }
    if (id === "trading") {
      assert.equal(zones.length, 9);
      assert.equal(furnitureSeats(snapshot.objects).length, 55);
      assert.equal(ambientTileAllowed(zones, 4, 13), false);
      assert.equal(ambientTileAllowed(zones, 12, 12), true);
      const world = new T.Group();
      addOfficeRoomSurfaces(world, id, { environmentVersion: snapshot.environmentVersion });
      assert.equal(world.children.length, 0);
      return;
    }
    if (id === "publishing") {
      assert.equal(zones.length, 5);
      assert.ok(zones.every((zone) => zone.roaming));
      assert.equal(map.width, 30);
      assert.equal(map.height, 26);
      const world = new T.Group();
      addOfficeRoomSurfaces(world, id, { environmentVersion: snapshot.environmentVersion });
      assert.equal(world.children.length, 0, "new layout omits retired CEO surfaces");
      return;
    }
    if (id === "tech") {
      assert.equal(map.width, 44);
      assert.equal(map.height, 20);
      assert.equal(zones.length, 8);
      assert.equal(furnitureSeats(snapshot.objects).length, 40);
      assert.equal(ambientTileAllowed(zones, 3, 3), false);
      assert.equal(ambientTileAllowed(zones, 35, 8), true);
      assert.ok(!snapshot.objects.some((object) => object.type.startsWith("room_wall")));
      for (const room of Object.values(TECH_STARTUP_BOUNDARIES)) {
        for (let x = room.westCol + 1; x <= room.eastCol; x++)
          assert.equal(
            blocked.has(`${x},${room.frontRow}`),
            !(room.doorCols as readonly number[]).includes(x),
          );
        for (const x of room.doorCols)
          for (const y of [room.frontRow - 1, room.frontRow, room.frontRow + 1])
            assert.equal(blocked.has(`${x},${y}`), false, `tech doorway approach ${x},${y}`);
      }
      const world = new T.Group();
      addOfficeRoomSurfaces(world, id, { environmentVersion: snapshot.environmentVersion });
      assert.equal(
        world.children.length,
        0,
        "reference map does not receive retired CEO-suite floors",
      );
      return;
    }
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
      const route = findPath(
        id === "trading" ? 37 : Math.floor(snapshot.cols / 2),
        snapshot.rows - 3,
        x,
        y,
        walkable,
      );
      assert.ok(route, `unreachable seat ${x},${y}`);
      for (let i = 1; i < route.length; i++) {
        assert.ok(clearSegment(route[i - 1], route[i], walkable));
        assert.ok(clearSegment(route[i], route[i - 1], walkable));
      }
    }
  });
}
test("the four shared suites differ by room footprints and order", () => {
  assert.equal(
    new Set(
      Object.values(OFFICE_ROOMS).map((rooms) =>
        JSON.stringify(rooms.map(({ id, x, width, depth }) => [id, x, width, depth])),
      ),
    ).size,
    4,
  );
});

test("retired agency v2 geometry remains frozen for exact-snapshot migration", () => {
  assert.ok(Object.isFrozen(LEGACY_AGENCY_V2_ROOMS));
  assert.ok(LEGACY_AGENCY_V2_ROOMS.every(Object.isFrozen));
  assert.deepEqual(
    LEGACY_AGENCY_V2_ROOMS.map(({ id, x, z, width, depth, door }) => [
      id,
      x,
      z,
      width,
      depth,
      door,
    ]),
    [
      ["ceo", 1, 1, 7, 8, 3],
      ["meeting", 9, 1, 12, 8, 14],
      ["pantry", 22, 1, 7, 8, 24],
    ],
  );
  const first: string[] = [];
  const second: string[] = [];
  const collect = (target: string[]) => (type: string, x: number, y: number) =>
    target.push(`${type}:${x}:${y}`);
  furnishLegacyAgencyV2(collect(first));
  furnishLegacyAgencyV2(collect(second));
  assert.deepEqual(first, second);
  assert.equal(first.length, 93);
});

test("old and edited legacy agency snapshots keep v2 room surfaces", () => {
  for (const environmentVersion of [2, undefined]) {
    const map = buildOfficeEnvironment("agency");
    const layer = map.layers.find((entry) => entry.name === "Objects")!;
    const versionProperty = layer.properties!.find(
      (property) => property.name === "officeEnvironmentVersion",
    )!;
    if (environmentVersion === undefined)
      layer.properties = layer.properties!.filter(
        (property) => property.name !== "officeEnvironmentVersion",
      );
    else versionProperty.value = environmentVersion;
    layer.objects!.push({
      id: map.nextobjectid++,
      name: "room_wall_h",
      type: "room_wall_h",
      x: 32,
      y: 9 * 32,
      width: 32,
      height: 32,
      visible: true,
    });
    const snapshot = tiledSnapshot(map);
    assert.equal(snapshot.environmentVersion, environmentVersion);
    const hasLegacyPartitions = snapshot.objects.some((object) =>
      object.type.startsWith("room_wall"),
    );
    const world = new T.Group();
    addOfficeRoomSurfaces(world, snapshot.environment!, {
      environmentVersion: snapshot.environmentVersion,
      hasLegacyPartitions,
    });
    assert.equal(
      world.children.filter(
        (object): object is T.Mesh =>
          object instanceof T.Mesh && object.geometry instanceof T.PlaneGeometry,
      ).length,
      3,
    );
  }

  for (const options of [
    { environmentVersion: 3, hasLegacyPartitions: true },
    { environmentVersion: 2, hasLegacyPartitions: false },
    { environmentVersion: undefined, hasLegacyPartitions: false },
  ]) {
    const world = new T.Group();
    addOfficeRoomSurfaces(world, "agency", options);
    assert.equal(world.children.length, 0, "current studio never receives retired room surfaces");
  }
});

test("legacy tech v2 and unversioned snapshots retain their original room surfaces", () => {
  for (const environmentVersion of [2, undefined]) {
    const world = new T.Group();
    addOfficeRoomSurfaces(world, "tech", { environmentVersion, hasLegacyPartitions: true });
    const floors = world.children.filter(
      (object): object is T.Mesh =>
        object instanceof T.Mesh && object.geometry instanceof T.PlaneGeometry,
    );
    assert.equal(floors.length, OFFICE_ROOMS.tech.length);
    for (let i = 0; i < floors.length; i++) {
      assert.equal(floors[i].position.x, OFFICE_ROOMS.tech[i].x + OFFICE_ROOMS.tech[i].width / 2);
      assert.equal(floors[i].position.z, OFFICE_ROOMS.tech[i].z + OFFICE_ROOMS.tech[i].depth / 2);
    }
  }
});
