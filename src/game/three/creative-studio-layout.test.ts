import test from "node:test";
import assert from "node:assert/strict";
import { buildOfficeEnvironment } from "./office-environments";
import {
  CREATIVE_STUDIO_SEAT_CONTRACT,
  CREATIVE_STUDIO_SIZE,
  CREATIVE_STUDIO_ZONES,
} from "./creative-studio-layout";
import { tiledSnapshot } from "./tiled-preview";
import { furnitureSeats } from "./seating";
import {
  computeOccupiedTiles,
  getObjectDimensions,
  OBJECT_TYPES,
  type MapObject,
} from "../../lib/object-types";
import { clearSegment, findPath } from "../navigation";
import { ambientTileAllowed, destinationTileAllowed, readAmbientZones } from "../ambient-zones";

const neighbors = (x: number, y: number) =>
  [
    [x - 1, y],
    [x + 1, y],
    [x, y - 1],
    [x, y + 1],
  ] as const;

test("agency is the deterministic 42x26 creative studio", () => {
  const map = buildOfficeEnvironment("agency");
  const properties = map.layers.find((layer) => layer.name === "Objects")?.properties;
  assert.deepEqual(CREATIVE_STUDIO_SIZE, { cols: 42, rows: 26 });
  assert.equal(map.width, 42);
  assert.equal(map.height, 26);
  assert.equal(
    properties?.find((property) => property.name === "officeEnvironmentVersion")?.value,
    5,
  );
  assert.deepEqual(
    CREATIVE_STUDIO_ZONES.map((zone) => zone.id),
    [
      "photo",
      "workstations",
      "ideation",
      "main-lounge",
      "production",
      "studio-director",
      "meeting",
      "pantry",
      "small-lounge",
    ],
  );
});

test("creative studio places every signature zone with typed collision geometry", () => {
  const snapshot = tiledSnapshot(buildOfficeEnvironment("agency"));
  const required = [
    "studio_worktable",
    "studio_round_table",
    "studio_sofa",
    "studio_stool",
    "studio_shelf",
    "studio_counter",
    "photo_cyclorama",
    "photo_camera",
    "photo_light",
    "mobile_board",
    "glass_partition",
  ];
  for (const type of required) {
    assert.ok(OBJECT_TYPES[type], `registered ${type}`);
    assert.ok(
      snapshot.objects.some((object) => object.type === type),
      `placed ${type}`,
    );
  }

  const occupied = new Map<string, string>();
  for (const object of snapshot.objects) {
    if (object.type === "computer") continue;
    const size = getObjectDimensions(object.type, object.direction);
    for (let x = object.col; x < object.col + size.width; x++)
      for (let y = object.row; y < object.row + size.height; y++) {
        const tile = `${x},${y}`;
        assert.ok(!occupied.has(tile), `${object.type} overlaps ${occupied.get(tile)} at ${tile}`);
        occupied.set(tile, object.type);
      }
  }
});

test("creative studio fills its open plan with working clusters, dividers, and support props", () => {
  const objects = tiledSnapshot(buildOfficeEnvironment("agency")).objects;
  const count = (type: string) => objects.filter((object) => object.type === type).length;

  assert.ok(
    objects.filter((object) => object.type !== "wall").length >= 110,
    "reference-scale density cannot regress to the sparse first studio",
  );
  assert.equal(count("desk"), 10, "two four-person pods and one two-person work island");
  assert.equal(
    objects.filter((object) => object.type === "computer" && object.variant === "studio-monitor")
      .length,
    10,
    "every shared work desk is dressed with a monitor",
  );
  assert.equal(count("computer"), 11, "the director desk adds a dedicated monitor");
  const workstationBands = new Set(
    objects
      .filter((object) => object.type === "desk")
      .map((object) =>
        object.col < 16 ? "rear-west" : object.col < 24 ? "rear-centre" : "rear-east",
      ),
  );
  assert.deepEqual(
    [...workstationBands].sort(),
    ["rear-centre", "rear-east", "rear-west"],
    "workstations remain distributed across three islands",
  );
  const workstationZone = CREATIVE_STUDIO_ZONES.find((zone) => zone.id === "workstations")!;
  for (const object of objects.filter(
    (object) => object.type === "chair" && object.variant === "office-neutral",
  )) {
    assert.ok(
      object.col >= workstationZone.x &&
        object.col < workstationZone.x + workstationZone.width &&
        object.row >= workstationZone.y &&
        object.row < workstationZone.y + workstationZone.height,
      `work seat ${object.col},${object.row} stays in its ambient zone`,
    );
  }
  assert.ok(count("studio_shelf") >= 10, "low storage and shelving divide the open zones");
  assert.ok(count("plant") >= 6, "planting varies the open floor edges");
  assert.ok(count("photo_light") >= 3, "photo bay has key, fill, and reflector equipment");
  assert.equal(count("studio_stool"), 4, "pantry bar seating matches the reference");
  assert.ok(count("studio_sofa") >= 3, "the central lounge uses a broad modular curve");
  for (const type of ["kitchen_counter", "microwave_cabinet", "refrigerator"])
    assert.ok(count(type) >= 1, `pantry includes ${type}`);
});

test("studio object types publish stable footprints, rotation, and collision behavior", () => {
  const contracts = {
    studio_worktable: [6, 3, true],
    studio_round_table: [3, 3, true],
    studio_sofa: [3, 1, true],
    studio_stool: [1, 1, false],
    studio_shelf: [2, 1, true],
    studio_counter: [4, 1, true],
    photo_cyclorama: [7, 3, true],
    photo_camera: [1, 1, true],
    photo_light: [1, 1, true],
    mobile_board: [2, 1, true],
    glass_partition: [1, 1, true],
  } as const;
  for (const [type, [width, height, collision]] of Object.entries(contracts)) {
    assert.deepEqual(getObjectDimensions(type), { width, height }, `${type} footprint`);
    assert.deepEqual(
      getObjectDimensions(type, "right"),
      { width: height, height: width },
      `${type} rotated footprint`,
    );
    const object: MapObject = { id: type, type, col: 2, row: 3 };
    assert.equal(computeOccupiedTiles([object]).size, collision ? width * height : 0, type);
  }
});

test("creative studio entrance, circulation lanes, and all seat anchors stay reachable", () => {
  const snapshot = tiledSnapshot(buildOfficeEnvironment("agency"));
  const blocked = new Set(snapshot.blocked);
  for (const x of [21, 22, 23, 24, 25])
    for (const y of [snapshot.rows - 4, snapshot.rows - 3, snapshot.rows - 2, snapshot.rows - 1])
      assert.equal(blocked.has(`${x},${y}`), false, `clear entrance ${x},${y}`);
  assert.equal(blocked.has("20,25"), true, "west entrance jamb remains closed");
  assert.equal(blocked.has("26,25"), true, "east entrance jamb remains closed");

  const aisleTiles = [
    ...[8, 9].flatMap((y) => Array.from({ length: 11 }, (_, i) => [i + 1, y] as const)),
    ...[10, 11].flatMap((x) => Array.from({ length: 24 }, (_, i) => [x, i + 1] as const)),
    ...[30, 31].flatMap((x) => Array.from({ length: 24 }, (_, i) => [x, i + 1] as const)),
    ...[15, 16].flatMap((y) => Array.from({ length: 21 }, (_, i) => [i + 10, y] as const)),
    ...[23, 24].flatMap((y) => Array.from({ length: 21 }, (_, i) => [i + 10, y] as const)),
  ];
  const zones = readAmbientZones(
    buildOfficeEnvironment("agency") as unknown as Record<string, unknown>,
  );
  for (const [x, y] of aisleTiles) {
    assert.equal(blocked.has(`${x},${y}`), false, `two-tile primary aisle is clear at ${x},${y}`);
    assert.equal(
      ambientTileAllowed(zones, x, y),
      false,
      `primary aisle cannot be an ambient stop at ${x},${y}`,
    );
  }

  const walkable = (x: number, y: number) =>
    x >= 1 && x < snapshot.cols - 1 && y >= 1 && y < snapshot.rows && !blocked.has(`${x},${y}`);
  const start = { x: 23, y: snapshot.rows - 3 };
  const reached = new Set([`${start.x},${start.y}`]);
  const queue = [start];
  for (let i = 0; i < queue.length; i++) {
    for (const [x, y] of neighbors(queue[i].x, queue[i].y)) {
      const key = `${x},${y}`;
      if (!walkable(x, y) || reached.has(key)) continue;
      reached.add(key);
      queue.push({ x, y });
    }
  }
  for (let x = 1; x < snapshot.cols - 1; x++)
    for (let y = 1; y < snapshot.rows; y++)
      if (!blocked.has(`${x},${y}`)) assert.ok(reached.has(`${x},${y}`), `reachable ${x},${y}`);

  const legacySeatObjects = snapshot.objects.filter((object) =>
    ["chair", "office_armchair", "office_sofa"].includes(object.type),
  );
  assert.equal(
    furnitureSeats(legacySeatObjects).length,
    CREATIVE_STUDIO_SEAT_CONTRACT.tileGridAnchors,
  );
  const deferredCatalogAnchors = snapshot.objects.reduce(
    (total, object) =>
      total +
      (CREATIVE_STUDIO_SEAT_CONTRACT.deferredCatalogSeatsPerObject[
        object.type as keyof typeof CREATIVE_STUDIO_SEAT_CONTRACT.deferredCatalogSeatsPerObject
      ] ?? 0),
    0,
  );
  assert.equal(deferredCatalogAnchors, CREATIVE_STUDIO_SEAT_CONTRACT.deferredCatalogAnchors);
  assert.equal(
    CREATIVE_STUDIO_SEAT_CONTRACT.tileGridAnchors + deferredCatalogAnchors,
    CREATIVE_STUDIO_SEAT_CONTRACT.totalAnchors,
  );
  const seats = furnitureSeats(snapshot.objects);
  assert.ok(seats.length >= CREATIVE_STUDIO_SEAT_CONTRACT.tileGridAnchors);
  for (const seat of seats) {
    const x = Math.floor((seat.anchorX ?? seat.x) - 0.5);
    const y = Math.floor((seat.anchorZ ?? seat.z) - 0.5);
    const route = findPath(start.x, start.y, x, y, walkable, (a, b) =>
      clearSegment(a, b, walkable),
    );
    assert.ok(route, `body-clear route to seat ${x},${y}`);
    for (let i = 1; i < route.length; i++) {
      assert.ok(clearSegment(route[i - 1], route[i], walkable), `forward seat route ${x},${y}`);
      assert.ok(clearSegment(route[i], route[i - 1], walkable), `reverse seat route ${x},${y}`);
    }
  }
});

test("creative studio objects retain visual and destination metadata through Tiled projection", () => {
  const snapshot = tiledSnapshot(buildOfficeEnvironment("agency"));
  const camera = snapshot.objects.find((object) => object.type === "photo_camera")!;
  const production = snapshot.objects.find((object) => object.type === "studio_worktable")!;
  assert.deepEqual(camera.destinationTags, ["photo"]);
  assert.equal(camera.variant, "tripod");
  assert.deepEqual(production.destinationTags, ["production", "worktable"]);
  assert.equal(production.variant, "dressed");
});

test("studio director suite excludes ambient wandering but accepts purposeful work and meetings", () => {
  const zones = readAmbientZones(
    buildOfficeEnvironment("agency") as unknown as Record<string, unknown>,
  );
  const director = zones.find((zone) => zone.id === "studio-director")!;
  assert.equal(director.access, "purpose-only");
  assert.equal(director.roaming, false);
  assert.deepEqual(director.destinationTags, ["work", "desk", "meeting", "lounge"]);
  assert.equal(ambientTileAllowed(zones, 4, 18), false);
  assert.equal(destinationTileAllowed(zones, 4, 18, "meeting"), true);
  assert.equal(destinationTileAllowed(zones, 4, 18, "pantry"), false);
});

test("meeting enclosure joins rear and front boundaries with the two-tile west door retained", () => {
  const snapshot = tiledSnapshot(buildOfficeEnvironment("agency"));
  const blocked = new Set(snapshot.blocked);
  for (let row = 0; row < 8; row++) assert.ok(blocked.has(`32,${row}`), `west boundary ${row}`);
  for (let col = 32; col < 42; col++) assert.ok(blocked.has(`${col},10`), `front boundary ${col}`);
  for (const row of [8, 9]) assert.equal(blocked.has(`32,${row}`), false, `meeting door ${row}`);
});
