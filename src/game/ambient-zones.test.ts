import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ambientTileAllowed,
  ambientPathAllowed,
  destinationTileAllowed,
  findTaggedDestinationPath,
  readAmbientZones,
} from "./ambient-zones";
import publishingV2 from "../lib/fixtures/official-publishing-v2.json";
import { buildOfficeEnvironment } from "./three/office-environments";
test("map-owned excluded rooms reject destinations and through paths, but permit exit", () => {
  const zones = readAmbientZones(publishingV2 as unknown as Record<string, unknown>);
  assert.equal(zones.length, 3);
  assert.equal(ambientTileAllowed(zones, 4, 5), false);
  assert.equal(ambientTileAllowed(zones, 14, 4), true);
  assert.equal(ambientTileAllowed(zones, 24, 4), true);
  assert.equal(ambientTileAllowed(zones, 4, 9), true);
  assert.equal(ambientPathAllowed(zones, 4, 5, { x: 14, y: 10 }), false);
  assert.equal(ambientPathAllowed(zones, 4, 5, { x: 4, y: 3 }), true);
  assert.equal(ambientTileAllowed(zones, 4, 5), false);
});
test("arbitrary maps reuse zone rules and legacy maps remain unrestricted", () => {
  const zones = [{ id: "warehouse", x: 50, y: 60, width: 3, height: 4, roaming: false }];
  assert.equal(ambientTileAllowed(zones, 52, 63), false);
  assert.equal(ambientTileAllowed(zones, 53, 63), true);
  assert.deepEqual(readAmbientZones({}), []);
  assert.deepEqual(
    readAmbientZones({
      layers: [
        {
          name: "Objects",
          type: "objectgroup",
          properties: [{ name: "ambientZones", value: "broken" }],
        },
      ],
    }),
    [],
  );
});

test("creative studio purpose-only zones reject roaming but accept matching explicit destinations", () => {
  const zones = readAmbientZones(
    buildOfficeEnvironment("agency") as unknown as Record<string, unknown>,
  );
  assert.deepEqual(
    zones.find((zone) => zone.id === "photo"),
    {
      id: "photo",
      x: 1,
      y: 2,
      width: 9,
      height: 9,
      roaming: false,
      access: "purpose-only",
      destinationTags: ["photo"],
    },
  );
  assert.equal(ambientTileAllowed(zones, 5, 8), false);
  assert.equal(destinationTileAllowed(zones, 5, 8, "photo"), true);
  assert.equal(destinationTileAllowed(zones, 5, 8, "meeting"), false);
  assert.equal(destinationTileAllowed(zones, 35, 4, "meeting"), true);
  assert.equal(destinationTileAllowed(zones, 35, 4), false);
  assert.equal(destinationTileAllowed(zones, 26, 10), true);
  assert.equal(ambientTileAllowed(zones, 30, 10), false, "east aisle is not an idle stop");
  assert.equal(
    ambientPathAllowed(zones, 30, 10, { x: 25, y: 10 }),
    true,
    "east aisle remains traversable",
  );
  assert.equal(ambientTileAllowed(zones, 21, 24), false, "entrance is not an idle stop");
});

test("malformed optional ambient metadata is rejected while legacy metadata remains valid", () => {
  const mapWith = (zone: Record<string, unknown>) => ({
    layers: [
      {
        name: "Objects",
        type: "objectgroup",
        properties: [{ name: "ambientZones", value: JSON.stringify([zone]) }],
      },
    ],
  });
  const legacy = { id: "legacy", x: 1, y: 2, width: 3, height: 4, roaming: true };
  assert.deepEqual(readAmbientZones(mapWith(legacy)), [legacy]);
  assert.deepEqual(readAmbientZones(mapWith({ ...legacy, access: "private" })), []);
  assert.deepEqual(
    readAmbientZones(
      mapWith({ ...legacy, roaming: false, access: "ambient", destinationTags: ["work"] }),
    ),
    [],
  );
  assert.deepEqual(
    readAmbientZones(mapWith({ ...legacy, access: "ambient", destinationTags: [] })),
    [],
  );
  assert.deepEqual(readAmbientZones(mapWith({ ...legacy, destinationTags: ["work", 7] })), []);
  assert.deepEqual(
    readAmbientZones(
      mapWith({
        ...legacy,
        destinationExclusions: [{ x: 1, y: 1, width: 0, height: 2 }],
      }),
    ),
    [],
  );
  assert.deepEqual(
    readAmbientZones(
      mapWith({
        ...legacy,
        access: "ambient",
        destinationTags: ["work"],
        destinationExclusions: [{ x: 9, y: 9, width: 1, height: 1 }],
      }),
    ),
    [],
  );
});

test("mixed metadata preserves each legacy roaming zone and lets restrictive overlaps win", () => {
  const legacy = { id: "legacy", x: 1, y: 1, width: 2, height: 2, roaming: true };
  const modern = {
    id: "modern",
    x: 5,
    y: 5,
    width: 2,
    height: 2,
    roaming: true,
    access: "ambient" as const,
    destinationTags: ["work"],
  };
  assert.equal(ambientTileAllowed([legacy, modern], 1, 1), true);
  assert.equal(ambientTileAllowed([legacy, modern], 5, 5), true);
  assert.equal(ambientTileAllowed([legacy, modern], 4, 4), false);

  const restricted = {
    id: "restricted",
    x: 2,
    y: 2,
    width: 2,
    height: 2,
    roaming: false,
    access: "purpose-only" as const,
    destinationTags: ["meeting"],
  };
  assert.equal(ambientTileAllowed([legacy, modern, restricted], 2, 2), false);
});

test("tagged action resolves a body-clear route from circulation into a purpose-only zone", () => {
  const map = buildOfficeEnvironment("agency");
  const zones = readAmbientZones(map as unknown as Record<string, unknown>);
  const snapshot = tiledSnapshot(map);
  const blocked = new Set(snapshot.blocked);
  const walkable = (x: number, y: number) =>
    x >= 1 && x < snapshot.cols - 1 && y >= 1 && y < snapshot.rows && !blocked.has(`${x},${y}`);
  const start = { x: 23, y: 23 };
  const destination = { x: 5, y: 8 };

  assert.equal(ambientTileAllowed(zones, destination.x, destination.y), false);
  assert.equal(
    findTaggedDestinationPath(zones, "meeting", start, destination, walkable),
    null,
    "an action cannot enter a purpose zone under the wrong tag",
  );
  const route = findTaggedDestinationPath(zones, "photo", start, destination, walkable);
  assert.ok(route, "photo action enters its matching purpose-only zone");
  assert.deepEqual(route.at(-1), destination);
  for (let index = 1; index < route.length; index++) {
    assert.ok(clearSegment(route[index - 1], route[index], walkable));
    assert.ok(clearSegment(route[index], route[index - 1], walkable));
  }
});

import { AmbientExitPolicy } from "./ambient-zones";
import { OFFICE_ENVIRONMENTS } from "./three/office-environments";
import { OFFICE_ROOMS } from "./three/office-room-layout";
import { TECH_STARTUP_BOUNDARIES } from "./three/tech-startup-layout";
import { tiledSnapshot } from "./three/tiled-preview";
import { TrafficCoordinator } from "./traffic";
import { ACTOR_RADIUS, clearSegment } from "./navigation";

for (const { id } of OFFICE_ENVIRONMENTS) {
  if (id === "agency" || id === "publishing") continue;
  test(`${id}: an inside worker fully exits ${id === "tech" ? "server room" : "CEO"} through incremental traffic and cannot reenter`, () => {
    const map = buildOfficeEnvironment(id);
    const zones = readAmbientZones(map as unknown as Record<string, unknown>);
    const blocked = new Set(tiledSnapshot(map).blocked);
    const room = id === "tech" ? undefined : OFFICE_ROOMS[id].find((room) => room.id === "ceo")!;
    const boundary =
      id === "tech" ? TECH_STARTUP_BOUNDARIES.server.frontRow : room!.z + room!.depth;
    const door = id === "tech" ? TECH_STARTUP_BOUNDARIES.server.doorCols[0] : room!.door;
    const origin = id === "trading" ? { x: 7, y: 15 } : { x: door, y: boundary };
    const goal = id === "trading" ? { x: 10, y: 15 } : { x: door, y: boundary + 2 };
    const policy = new AmbientExitPolicy(zones, origin);
    const traffic = new TrafficCoordinator();
    let position = { ...origin };
    const floor = (x: number, y: number) =>
      x > 0 && x < map.width - 1 && y > 0 && y < map.height - 1 && !blocked.has(`${x},${y}`);
    for (let frame = 0; frame < 100; frame++) {
      const allowed = policy.at(position);
      const walkable = (x: number, y: number) => floor(x, y) && allowed(x, y);
      const next = traffic.step("worker", position, goal, 0.05, frame * 16, walkable, [
        { id: "worker", ...position },
      ]);
      assert.ok(clearSegment(position, next, walkable));
      position = next;
    }
    assert.ok(
      Math.hypot(position.x - goal.x, position.y - goal.y) < 1e-6,
      "body clears the boundary instead of freezing at half a tile",
    );
    assert.equal(
      policy.at(position)(origin.x, origin.y),
      false,
      "exit permission is permanently revoked for this excursion",
    );
    traffic.clear();
    for (let frame = 0; frame < 100; frame++) {
      const allowed = policy.at(position);
      position = traffic.step(
        "worker",
        position,
        origin,
        0.05,
        2000 + frame * 16,
        (x, y) => floor(x, y) && allowed(x, y),
        [{ id: "worker", ...position }],
      );
      assert.ok(
        id === "trading"
          ? position.x > 7.5 + ACTOR_RADIUS
          : position.y > boundary + 0.5 + ACTOR_RADIUS,
        "cannot reverse into the excluded room after leaving",
      );
    }
    const outsider = new AmbientExitPolicy(zones, goal);
    assert.equal(
      outsider.at(origin)(origin.x, origin.y),
      false,
      "moving a later query inside never grants a new permit",
    );
  });
}

test("exit permit survives the center crossing only until the full body clears", () => {
  const zones = [{ id: "private", x: 1, y: 1, width: 4, height: 4, roaming: false }];
  const inside = new AmbientExitPolicy(zones, { x: 2, y: 4 });
  assert.equal(inside.at({ x: 2, y: 4.55 })(2, 4), true);
  assert.equal(inside.at({ x: 2, y: 4.73 })(2, 4), false);
  assert.equal(inside.at({ x: 2, y: 4.55 })(2, 4), false);
  const outside = new AmbientExitPolicy(zones, { x: 2, y: 4.55 });
  assert.equal(
    outside.at({ x: 2, y: 4.55 })(2, 4),
    false,
    "body overlap alone cannot originate permission",
  );
});

test("publishing reference rooms allow wandering without obsolete CEO exclusion", () => {
  const zones = readAmbientZones(
    buildOfficeEnvironment("publishing") as unknown as Record<string, unknown>,
  );
  assert.equal(zones.length, 5);
  assert.ok(zones.every((zone) => zone.roaming));
  assert.equal(ambientTileAllowed(zones, 4, 5), true);
});
