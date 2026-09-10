import test from "node:test";
import assert from "node:assert/strict";
import {
  OFFICE_ENVIRONMENTS,
  buildOfficeEnvironment,
  type OfficeEnvironmentId,
} from "./office-environments";
import { OBJECT_TYPES } from "../../lib/object-types";
import { tiledSnapshot } from "./tiled-preview";

test("five immutable localized environments have different furnished layouts", () => {
  assert.deepEqual(
    OFFICE_ENVIRONMENTS.map((entry) => entry.id),
    ["trading", "agency", "tech", "executive", "publishing"],
  );
  assert.ok(Object.isFrozen(OFFICE_ENVIRONMENTS));
  const layouts = new Set<string>();
  for (const entry of OFFICE_ENVIRONMENTS) {
    assert.ok(Object.isFrozen(entry));
    assert.ok(entry.nameKo && entry.nameEn && entry.descriptionKo && entry.descriptionEn);
    assert.match(entry.color, /^#[\da-f]{6}$/i);
    layouts.add(JSON.stringify(tiledSnapshot(buildOfficeEnvironment(entry.id)).objects));
  }
  assert.equal(layouts.size, 5);
  assert.throws(
    () => buildOfficeEnvironment("unknown" as OfficeEnvironmentId),
    /Unknown office environment/,
  );
});

for (const environment of OFFICE_ENVIRONMENTS) {
  test(`${environment.id}: valid deterministic Tiled map with connected seats and entrance`, () => {
    const map = buildOfficeEnvironment(environment.id);
    assert.equal(map.width, 30);
    assert.equal(map.height, 22);
    assert.equal(map.tilewidth, 32);
    assert.equal(map.tileheight, 32);
    const snapshot = tiledSnapshot(map);
    assert.deepEqual(snapshot, tiledSnapshot(JSON.parse(JSON.stringify(map))));
    assert.deepEqual(map, buildOfficeEnvironment(environment.id));
    const layer = map.layers.find((entry) => entry.name === "Objects")!;
    assert.equal(
      layer.properties!.find((property) => property.name === "officeEnvironment")?.value,
      environment.id,
    );
    const objects = map.layers.flatMap((entry) => entry.objects || []);
    const ids = objects.map((object) => object.id);
    assert.equal(new Set(ids).size, ids.length);
    assert.ok(map.nextobjectid > Math.max(...ids));
    const spawns = objects.filter((object) => object.type === "spawn");
    assert.equal(spawns.length, 1);
    const spawn = spawns[0];
    const blocked = new Set(snapshot.blocked);
    const start = `${spawn.x / 32},${spawn.y / 32}`;
    assert.ok(!blocked.has(start));
    const reached = new Set([start]);
    const queue = [[spawn.x / 32, spawn.y / 32]];
    const neighbors = (x: number, y: number) => [
      [x - 1, y],
      [x + 1, y],
      [x, y - 1],
      [x, y + 1],
    ];
    for (let i = 0; i < queue.length; i++) {
      for (const [x, y] of neighbors(queue[i][0], queue[i][1])) {
        const key = `${x},${y}`;
        if (x < 0 || x >= 30 || y < 0 || y >= 22 || blocked.has(key) || reached.has(key)) continue;
        reached.add(key);
        queue.push([x, y]);
      }
    }
    assert.equal(reached.size + blocked.size, 30 * 22, "All empty tiles are connected");
    for (const x of [14, 15, 16]) assert.ok(reached.has(`${x},21`));
    const occupied = new Set<string>();
    for (const object of objects) {
      if (object.type === "spawn") continue;
      const def = OBJECT_TYPES[object.type];
      assert.ok(def, `Known type ${object.type}`);
      assert.equal(object.width, def.width * 32);
      assert.equal(object.height, def.height * 32);
      const x = object.x / 32,
        y = object.y / 32;
      assert.ok(Number.isInteger(x) && Number.isInteger(y));
      assert.ok(x >= 0 && y >= 0 && x + def.width <= 30 && y + def.height <= 22);
      if (object.type === "chair") assert.ok(reached.has(`${x},${y}`), "Seat is walkable");
      if (object.type === "computer")
        assert.ok(
          objects.some(
            (desk) =>
              (desk.type === "desk" || desk.type === "reception_desk") &&
              desk.x === object.x &&
              desk.y === object.y,
          ),
          "Computer rests on a desk",
        );
      if (!def.collision) continue;
      let accessible = false;
      for (let col = x; col < x + def.width; col++)
        for (let row = y; row < y + def.height; row++) {
          const key = `${col},${row}`;
          assert.ok(!occupied.has(key), `No solid overlap at ${key}`);
          occupied.add(key);
          accessible ||= neighbors(col, row).some(([a, b]) => reached.has(`${a},${b}`));
        }
      if (object.type !== "cubicle_wall") assert.ok(accessible, `Can approach ${object.type}`);
    }
    const independent = buildOfficeEnvironment(environment.id);
    layer.objects!.length = 0;
    assert.ok(independent.layers.find((entry) => entry.name === "Objects")!.objects!.length > 50);
  });
}
