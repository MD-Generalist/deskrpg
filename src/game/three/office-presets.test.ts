import test from "node:test";
import assert from "node:assert/strict";
import { applyOfficePreset } from "./office-presets";
import { tiledSnapshot } from "./tiled-preview";
import { OBJECT_TYPES } from "../../lib/object-types";
import type { TiledMap } from "../../lib/tiled-map";
const base = {
  width: 20,
  height: 15,
  nextlayerid: 2,
  nextobjectid: 1,
  layers: [],
  tilesets: [],
} as unknown as TiledMap;
for (const preset of ["garden", "courtyard", "cafe"] as const)
  test(`${preset} creates a separate standard Tiled map with reachable, free spawn`, () => {
    const result = applyOfficePreset(base, preset),
      snapshot = tiledSnapshot(result);
    assert.deepEqual(base.layers, []);
    assert.ok(snapshot.objects.length > 50);
    const spawn = result.layers.flatMap((l) => l.objects || []).find((o) => o.type === "spawn")!;
    const key = `${spawn.x / 32},${spawn.y / 32}`,
      blocked = new Set(snapshot.blocked);
    assert.ok(!blocked.has(key));
    const queue = [[spawn.x / 32, spawn.y / 32]],
      reached = new Set([key]);
    for (let i = 0; i < queue.length; i++)
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const x = queue[i][0] + dx,
          y = queue[i][1] + dy,
          k = `${x},${y}`;
        if (x < 0 || x >= 20 || y < 0 || y >= 15 || blocked.has(k) || reached.has(k)) continue;
        reached.add(k);
        queue.push([x, y]);
      }
    assert.ok(reached.has("10,14")); // entrance connected
    assert.ok(reached.size > 100); // room is usable, not just a free isolated spawn cell
    const ids = result.layers.flatMap((l) => l.objects || []).map((o) => o.id);
    assert.equal(new Set(ids).size, ids.length);
  });
test("blank template preserves the normal empty-project path", () =>
  assert.equal(applyOfficePreset(base, "blank"), base));

for (const [width, height] of [
  [20, 15],
  [30, 22],
  [40, 30],
])
  test(`trading company ${width}×${height} has connected aisles and accessible furniture`, () => {
    const input = { ...structuredClone(base), width, height };
    const before = structuredClone(input);
    const result = applyOfficePreset(input, "trading");
    assert.deepEqual(input, before);
    assert.notEqual(result, input);
    assert.equal(result.width, width);
    assert.equal(result.height, height);
    const objects = result.layers.flatMap((layer) => layer.objects || []);
    const ids = objects.map((object) => object.id);
    assert.equal(new Set(ids).size, ids.length);
    assert.ok(result.nextobjectid > Math.max(...ids));
    const spawns = objects.filter((object) => object.type === "spawn");
    assert.equal(spawns.length, 1);
    const spawn = spawns[0];
    const blocked = new Set(tiledSnapshot(result).blocked);
    const start = `${spawn.x / 32},${spawn.y / 32}`;
    assert.ok(!blocked.has(start));
    const reached = new Set([start]);
    const queue = [[spawn.x / 32, spawn.y / 32]];
    for (let index = 0; index < queue.length; index++) {
      const [col, row] = queue[index];
      for (const [x, y] of [
        [col - 1, row],
        [col + 1, row],
        [col, row - 1],
        [col, row + 1],
      ]) {
        const key = `${x},${y}`;
        if (x < 0 || x >= width || y < 0 || y >= height || blocked.has(key) || reached.has(key))
          continue;
        reached.add(key);
        queue.push([x, y]);
      }
    }
    // Every free tile belongs to the entrance-connected component.
    assert.equal(reached.size + blocked.size, width * height);
    for (const col of [Math.floor(width / 2) - 1, Math.floor(width / 2), Math.floor(width / 2) + 1])
      assert.ok(reached.has(`${col},${height - 1}`));
    const collisionOwners = new Set<string>();
    for (const object of objects.filter((object) => object.type !== "spawn")) {
      const def = OBJECT_TYPES[object.type];
      assert.ok(def, `Known furniture: ${object.type}`);
      assert.equal(object.width, def.width * 32);
      assert.equal(object.height, def.height * 32);
      const col = object.x / 32,
        row = object.y / 32;
      assert.ok(col >= 0 && row >= 0 && col + def.width <= width && row + def.height <= height);
      if (object.type === "chair") assert.ok(reached.has(`${col},${row}`), "Reachable seat");
      if (!def.collision) continue;
      let accessible = false;
      for (let x = col; x < col + def.width; x++)
        for (let y = row; y < row + def.height; y++) {
          const key = `${x},${y}`;
          assert.ok(!collisionOwners.has(key), `Furniture overlaps at ${key}`);
          collisionOwners.add(key);
          if (
            [
              [x - 1, y],
              [x + 1, y],
              [x, y - 1],
              [x, y + 1],
            ].some(([a, b]) => reached.has(`${a},${b}`))
          )
            accessible = true;
        }
      if (object.type !== "cubicle_wall") assert.ok(accessible, `Approach to ${object.type}`);
    }
    for (const type of [
      "desk",
      "computer",
      "chair",
      "reception_desk",
      "meeting_table",
      "bookshelf",
      "coffee",
      "water_cooler",
      "whiteboard",
    ])
      assert.ok(
        objects.some((object) => object.type === type),
        `Includes ${type}`,
      );
  });

test("trading preset rejects undersized maps without mutation", () => {
  for (const [width, height] of [
    [19, 15],
    [20, 14],
  ]) {
    const input = { ...structuredClone(base), width, height };
    const before = structuredClone(input);
    assert.throws(() => applyOfficePreset(input, "trading"), /at least 20 × 15/);
    assert.deepEqual(input, before);
  }
});

test("trading preset preserves source layers and existing objects", () => {
  const input = structuredClone(base);
  input.nextobjectid = 43;
  input.layers = [
    {
      id: 1,
      name: "Objects",
      type: "objectgroup",
      opacity: 1,
      visible: true,
      x: 0,
      y: 0,
      objects: [
        {
          id: 42,
          name: "existing marker",
          type: "marker",
          x: 64,
          y: 64,
          width: 32,
          height: 32,
          visible: true,
        },
      ],
    },
  ];
  const before = structuredClone(input);
  const result = applyOfficePreset(input, "trading");
  assert.deepEqual(input, before);
  assert.deepEqual(result.layers[0].objects![0], input.layers[0].objects![0]);
  assert.notEqual(result.layers[0], input.layers[0]);
  const ids = result.layers.flatMap((layer) => layer.objects || []).map((object) => object.id);
  assert.equal(new Set(ids).size, ids.length);
});
