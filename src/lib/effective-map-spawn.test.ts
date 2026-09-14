import test from "node:test";
import assert from "node:assert/strict";
import { effectiveMapSpawn } from "./effective-map-spawn";
import { buildOfficeEnvironment } from "../game/three/office-environments";
import fixture from "./fixtures/official-agency-v2.json";
test("v3 uses current Tiled spawn and leaves the old mapConfig untouched", () => {
  const config = { spawnCol: 15, spawnRow: 19 };
  assert.deepEqual(
    effectiveMapSpawn(JSON.stringify(buildOfficeEnvironment("agency")), JSON.stringify(config)),
    { col: 23, row: 23 },
  );
  assert.deepEqual(config, { spawnCol: 15, spawnRow: 19 });
});
test("legacy configured spawns retain precedence", () =>
  assert.deepEqual(effectiveMapSpawn(fixture, { spawnCol: 2, spawnRow: 3 }), { col: 2, row: 3 }));
