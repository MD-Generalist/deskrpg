import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import fixture from "./fixtures/official-agency-v2.json";
import fixtureV3 from "./fixtures/official-agency-v3.json";
import fixtureV4 from "./fixtures/official-agency-v4.json";
import techV2 from "./fixtures/official-tech-v2.json";
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
test("official fixtures freeze the exact v2, v3 and v4 releases", () => {
  assert.equal(
    createHash("sha256")
      .update(readFileSync(new URL("./fixtures/official-agency-v2.json", import.meta.url)))
      .digest("hex"),
    "d17e2d0a8e7900e2ad5cfe879c9dc406bcb9dbadc6fdedc2d85e42663fc9015f",
  );
  assert.equal(fixture.width, 30);
  assert.equal(fixture.height, 22);
  assert.equal(
    createHash("sha256")
      .update(readFileSync(new URL("./fixtures/official-agency-v3.json", import.meta.url)))
      .digest("hex"),
    "276b0bdb5954b020e34d1efa7f8520a82dd749acea64e61b8bd5bdbefab034cd",
  );
  assert.equal(fixtureV3.width, 42);
  assert.equal(fixtureV3.height, 26);
  assert.equal(
    createHash("sha256")
      .update(readFileSync(new URL("./fixtures/official-agency-v4.json", import.meta.url)))
      .digest("hex"),
    "32f297141d91ccffd0835b150e474fa98e8538128b8a251271cd357c5dad3956",
  );
  assert.equal(fixtureV4.width, 42);
  assert.equal(fixtureV4.height, 26);
});
for (const [kind, input] of Object.entries({
  object: fixture,
  sqlite: JSON.stringify(fixture),
  jsonb: reorder(fixture),
}))
  test(`exact v2 ${kind} upgrades to fresh v5 without mutation`, () => {
    const before = JSON.stringify(input);
    const result = upgradeOfficialEnvironmentMap(input);
    assert.equal(result.upgraded, true);
    assert.equal(result.fromVersion, 2);
    assert.deepEqual(result.map, buildOfficeEnvironment("agency"));
    assert.notEqual(result.map, upgradeOfficialEnvironmentMap(input).map);
    assert.equal(JSON.stringify(input), before);
  });
for (const [kind, input] of Object.entries({
  object: fixtureV3,
  sqlite: JSON.stringify(fixtureV3),
  jsonb: reorder(fixtureV3),
}))
  test(`exact v3 ${kind} upgrades to fresh v5 without mutation`, () => {
    const before = JSON.stringify(input);
    const result = upgradeOfficialEnvironmentMap(input);
    assert.equal(result.upgraded, true);
    assert.equal(result.fromVersion, 3);
    assert.deepEqual(result.map, buildOfficeEnvironment("agency"));
    assert.equal(JSON.stringify(input), before);
  });
for (const [kind, input] of Object.entries({
  object: fixtureV4,
  sqlite: JSON.stringify(fixtureV4),
  jsonb: reorder(fixtureV4),
}))
  test(`exact v4 ${kind} upgrades to fresh v5 without mutation`, () => {
    const before = JSON.stringify(input);
    const result = upgradeOfficialEnvironmentMap(input);
    assert.equal(result.upgraded, true);
    assert.equal(result.fromVersion, 4);
    assert.deepEqual(result.map, buildOfficeEnvironment("agency"));
    assert.equal(JSON.stringify(input), before);
  });
test("protects an edited v4 studio by exact snapshot identity", () => {
  const edited = structuredClone(fixtureV4);
  edited.layers.find((layer) => layer.name === "Objects")!.objects!.pop();
  const result = upgradeOfficialEnvironmentMap(edited);
  assert.equal(result.upgraded, false);
  assert.equal(result.map, edited);
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

test("tech v2 fixture freezes the previous released map", () => {
  assert.equal(
    createHash("sha256")
      .update(readFileSync(new URL("./fixtures/official-tech-v2.json", import.meta.url)))
      .digest("hex"),
    "c1f34aa099030887c20d858640cc06eb5bf78b086723fb4798588a92e3418c93",
  );
  assert.equal(techV2.width, 30);
  assert.equal(techV2.height, 22);
});
for (const [kind, input] of Object.entries({
  object: techV2,
  sqlite: JSON.stringify(techV2),
  jsonb: reorder(techV2),
})) {
  test(`exact tech v2 ${kind} upgrades to v3 without mutation`, () => {
    const before = JSON.stringify(input);
    const result = upgradeOfficialEnvironmentMap(input);
    assert.equal(result.upgraded, true);
    assert.equal(result.fromVersion, 2);
    assert.deepEqual(result.map, buildOfficeEnvironment("tech"));
    assert.notEqual(result.map, upgradeOfficialEnvironmentMap(input).map);
    assert.equal(JSON.stringify(input), before);
  });
}
for (const edit of ["object", "layer-order", "metadata", "spawn", "dimension"]) {
  test(`tech v2 protects ${edit} edits`, () => {
    const map = structuredClone(techV2);
    if (edit === "object") map.layers.find((layer) => layer.name === "Objects")!.objects!.pop();
    if (edit === "layer-order") map.layers.reverse();
    if (edit === "metadata") Object.assign(map, { custom: true });
    if (edit === "spawn")
      map.layers
        .find((layer) => layer.name === "Objects")!
        .objects!.find((object) => object.type === "spawn")!.x += 32;
    if (edit === "dimension") map.width++;
    for (const input of [map, JSON.stringify(map)]) {
      const result = upgradeOfficialEnvironmentMap(input);
      assert.equal(result.upgraded, false);
      assert.equal(result.map, input);
    }
  });
}
