import test from "node:test";
import assert from "node:assert/strict";
import { applyOfficePreset } from "./office-presets";
import { tiledSnapshot } from "./tiled-preview";
import type { TiledMap } from "../../components/map-editor/hooks/useMapEditor";
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
