import { test } from "node:test";
import assert from "node:assert/strict";
import { ambientTileAllowed, ambientPathAllowed, readAmbientZones } from "./ambient-zones";
import { buildOfficeEnvironment } from "./three/office-environments";
test("map-owned excluded rooms reject destinations and through paths, but permit exit", () => {
  const zones = readAmbientZones(
    buildOfficeEnvironment("publishing") as unknown as Record<string, unknown>,
  );
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

import { AmbientExitPolicy } from "./ambient-zones";
import { OFFICE_ENVIRONMENTS } from "./three/office-environments";
import { OFFICE_ROOMS } from "./three/office-room-layout";
import { tiledSnapshot } from "./three/tiled-preview";
import { TrafficCoordinator } from "./traffic";
import { ACTOR_RADIUS, clearSegment } from "./navigation";

for (const { id } of OFFICE_ENVIRONMENTS) {
  test(`${id}: an inside worker fully exits CEO through incremental traffic and cannot reenter`, () => {
    const map = buildOfficeEnvironment(id);
    const zones = readAmbientZones(map as unknown as Record<string, unknown>);
    const blocked = new Set(tiledSnapshot(map).blocked);
    const room = OFFICE_ROOMS[id].find((room) => room.id === "ceo")!;
    const boundary = room.z + room.depth;
    const origin = { x: room.door, y: boundary };
    const goal = { x: room.door, y: boundary + 2 };
    const policy = new AmbientExitPolicy(zones, origin);
    const traffic = new TrafficCoordinator();
    let position = { ...origin };
    const floor = (x: number, y: number) =>
      x > 0 && x < 29 && y > 0 && y < 21 && !blocked.has(`${x},${y}`);
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
        position.y > boundary + 0.5 + ACTOR_RADIUS,
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
