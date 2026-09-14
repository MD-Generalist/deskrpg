import test from "node:test";
import assert from "node:assert/strict";
import smallOffice from "../lib/builtin/small-office-template.json";
import { buildOfficeEnvironment, OFFICE_ENVIRONMENTS } from "../game/three/office-environments";
import { tiledSnapshot } from "../game/three/tiled-preview";
import { furnitureSeats } from "../game/three/seating";
import { deriveChannelMotionLayout, closestValidUnoccupiedSpawn } from "./channel-motion-layout";

for (const environment of OFFICE_ENVIRONMENTS) {
  test(`persisted ${environment.id} agrees with UI2 seats, occupancy, and dimensions`, () => {
    const map = buildOfficeEnvironment(environment.id);
    const snapshot = tiledSnapshot(map);
    const layout = deriveChannelMotionLayout({ mapData: JSON.stringify(map) }, [
      { id: "npc", positionX: 15, positionY: 19 },
    ])!;
    assert.deepEqual(
      layout.bounds,
      environment.id === "executive" ? { width: 576, height: 576 } : { width: 960, height: 704 },
    );
    assert.deepEqual(layout.npcs, [{ id: "npc", x: 496, y: 624 }]);
    assert.deepEqual(
      layout.seats.map(({ id }) => id),
      [
        ...new Set(
          furnitureSeats(snapshot.objects)
            .map((seat) => ({ x: (seat.anchorX ?? seat.x) * 32, y: (seat.anchorZ ?? seat.z) * 32 }))
            .filter(layout.canStandAt)
            .map(({ x, y }) => `${x}:${y}`),
        ),
      ],
    );
    const blocked = new Set(snapshot.blocked);
    for (let y = 0; y < map.height; y++)
      for (let x = 0; x < map.width; x++) {
        assert.equal(layout.isWalkable(x, y), !blocked.has(`${x},${y}`));
      }
    const spawn = closestValidUnoccupiedSpawn(layout, { x: 496, y: 624 })!;
    assert.ok(layout.canStandAt(spawn));
    assert.notDeepEqual(spawn, layout.npcs[0]);
    assert.ok(Math.hypot(spawn.x - 496, spawn.y - 624) >= 14.08);
    assert.deepEqual(spawn, closestValidUnoccupiedSpawn(layout, { x: 496, y: 624 }));
  });
}

test("real saved Small Office JSON retains geometry and does not become a generated environment", () => {
  const map = smallOffice.tiledJson;
  const layout = deriveChannelMotionLayout(
    { mapData: map, mapConfig: JSON.stringify({ cols: 99, rows: 99 }) },
    [],
  )!;
  assert.deepEqual(layout.bounds, { width: map.width * 32, height: map.height * 32 });
  assert.equal(layout.seats.length, furnitureSeats(tiledSnapshot(map as never).objects).length);
  const spawn = closestValidUnoccupiedSpawn(layout, {
    x: (smallOffice.spawnCol + 0.5) * 32,
    y: (smallOffice.spawnRow + 0.5) * 32,
  })!;
  assert.ok(layout.canStandAt(spawn));
});

test("body rejects wall corners and out of bounds; nearest free spawn avoids players and NPCs", () => {
  const map = buildOfficeEnvironment("tech");
  map.width = 3;
  map.height = 3;
  map.layers = [
    {
      id: 1,
      name: "Collision",
      type: "tilelayer",
      width: 3,
      height: 3,
      data: [1, 0, 0, 0, 0, 0, 0, 0, 0],
      visible: true,
      opacity: 1,
      x: 0,
      y: 0,
    },
  ];
  const layout = deriveChannelMotionLayout({ mapData: map }, [
    { id: "npc", positionX: 1, positionY: 1 },
  ])!;
  assert.equal(layout.canStandAt({ x: 34, y: 34 }), false);
  assert.equal(layout.canStandAt({ x: 1, y: 48 }), false);
  assert.equal(layout.canStandAt({ x: Infinity, y: 48 }), false);
  assert.deepEqual(closestValidUnoccupiedSpawn(layout, { x: 48, y: 48 }, [{ x: 48, y: 16 }]), {
    x: 16,
    y: 48,
  });
  assert.deepEqual(closestValidUnoccupiedSpawn(layout, { x: 50, y: 70 }), { x: 50, y: 70 });
  const all = Array.from({ length: 9 }, (_, i) => ({
    x: ((i % 3) + 0.5) * 32,
    y: (Math.floor(i / 3) + 0.5) * 32,
  }));
  assert.equal(closestValidUnoccupiedSpawn(layout, { x: 48, y: 48 }, all), null);
});

test("legacy persisted objects retain direction, wall collisions and fixed scene bounds", () => {
  const map = {
    layers: {
      floor: [
        [1, 1, 1],
        [1, 1, 1],
      ],
      walls: [
        [2, 0, 0],
        [0, 0, 0],
      ],
    },
    objects: [{ id: "chair", type: "chair", col: 1, row: 1, direction: "left" }],
  };
  const layout = deriveChannelMotionLayout({ mapData: JSON.stringify(map) }, [])!;
  assert.deepEqual(layout.bounds, { width: 1280, height: 960 });
  assert.equal(layout.isWalkable(0, 0), false);
  assert.deepEqual(layout.seats, [{ id: "48:48", x: 48, y: 48 }]);
});

test("missing or malformed snapshots fail closed", () => {
  for (const mapData of [
    null,
    "{",
    {},
    { tiledversion: "1", width: -1, height: 20, layers: [] },
    { layers: {}, objects: [] },
  ]) {
    assert.equal(deriveChannelMotionLayout({ mapData }, []), null);
  }
});

test("edited themed maps keep edits and GameScene's no-Collision legacy wall fallback", () => {
  const map = buildOfficeEnvironment("agency");
  const walls = map.layers.find((layer) => layer.name === "Walls")!;
  map.layers = map.layers.filter((layer) => layer.name.toLowerCase() !== "collision");
  walls.data![19 * map.width + 15] = 2;
  const layout = deriveChannelMotionLayout({ mapData: JSON.stringify(map) }, [])!;
  assert.equal(layout.isWalkable(15, 19), false);
  assert.notDeepEqual(closestValidUnoccupiedSpawn(layout, { x: 496, y: 624 }), { x: 496, y: 624 });
});
