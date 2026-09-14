import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import fixture from "./fixtures/official-agency-v2.json";
import { buildOfficeEnvironment } from "../game/three/office-environments";
import { upgradeOfficialEnvironmentMap } from "./official-environment-upgrade";

const reorder = (value: unknown): unknown =>
  Array.isArray(value)
    ? value.map(reorder)
    : value && typeof value === "object"
      ? Object.fromEntries(
          Object.entries(value)
            .reverse()
            .map(([k, v]) => [k, reorder(v)]),
        )
      : value;
test("v2 fixture is the frozen output of commit 5d836178", () => {
  assert.equal(
    createHash("sha256")
      .update(readFileSync(new URL("./fixtures/official-agency-v2.json", import.meta.url)))
      .digest("hex"),
    "d17e2d0a8e7900e2ad5cfe879c9dc406bcb9dbadc6fdedc2d85e42663fc9015f",
  );
  assert.equal(fixture.width, 30);
  assert.equal(fixture.height, 22);
});
for (const [kind, input] of Object.entries({
  object: fixture,
  sqlite: JSON.stringify(fixture),
  jsonb: reorder(fixture),
}))
  test(`exact ${kind} upgrades to fresh v3 without mutation`, () => {
    const before = JSON.stringify(input);
    const result = upgradeOfficialEnvironmentMap(input);
    assert.equal(result.upgraded, true);
    assert.equal(result.fromVersion, 2);
    assert.deepEqual(result.map, buildOfficeEnvironment("agency"));
    assert.notEqual(result.map, upgradeOfficialEnvironmentMap(input).map);
    assert.equal(JSON.stringify(input), before);
  });
for (const edit of ["object", "layer-order", "metadata", "spawn", "dimension"])
  test(`protects ${edit} edits by identity`, () => {
    const map = structuredClone(fixture);
    if (edit === "object") map.layers.find((l) => l.name === "Objects")!.objects!.pop();
    if (edit === "layer-order") map.layers.reverse();
    if (edit === "metadata") Object.assign(map, { custom: true });
    if (edit === "spawn")
      map.layers.find((l) => l.name === "Objects")!.objects!.find((o) => o.type === "spawn")!.x +=
        32;
    if (edit === "dimension") map.width++;
    const result = upgradeOfficialEnvironmentMap(map);
    assert.equal(result.upgraded, false);
    assert.equal(result.map, map);
  });
for (const map of [
  null,
  undefined,
  "broken",
  "null",
  {},
  buildOfficeEnvironment("agency"),
  buildOfficeEnvironment("tech"),
])
  test(`ineligible input ${typeof map} stays unchanged`, () => {
    const result = upgradeOfficialEnvironmentMap(map);
    assert.equal(result.upgraded, false);
    assert.equal(result.map, map);
  });
