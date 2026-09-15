import test from "node:test";
import assert from "node:assert/strict";
import {
  isOfficeEnvironmentId,
  resolveOfficeEnvironment,
  resolveOfficeEnvironmentVersion,
} from "./office-environment-theme";
import { buildOfficeEnvironment, OFFICE_ENVIRONMENTS } from "./office-environments";
import { tiledSnapshot } from "./tiled-preview";

for (const entry of OFFICE_ENVIRONMENTS) {
  test(`${entry.id} metadata survives JSON loading and reaches the preview snapshot`, () => {
    const map = JSON.parse(JSON.stringify(buildOfficeEnvironment(entry.id)));
    assert.equal(resolveOfficeEnvironment(map), entry.id);
    assert.equal(resolveOfficeEnvironment(map.layers), entry.id);
    assert.equal(tiledSnapshot(map).environment, entry.id);
    assert.equal(
      tiledSnapshot(map).environmentVersion,
      entry.id === "agency"
        ? 5
        : entry.id === "executive"
          ? 5
          : entry.id === "tech" || entry.id === "trading" || entry.id === "publishing"
            ? 3
            : 2,
    );
    assert.ok(isOfficeEnvironmentId(entry.id));
  });
}

test("missing or malformed environment tags safely preserve the legacy theme", () => {
  for (const candidate of [
    null,
    undefined,
    42,
    "trading",
    [],
    {},
    { layers: null },
    { layers: [null, 42, "Objects"] },
  ])
    assert.equal(resolveOfficeEnvironment(candidate), undefined);
  for (const value of [undefined, null, 42, "office", "__proto__", {}, "TRADING"])
    assert.equal(isOfficeEnvironmentId(value), false);
  const layer = {
    name: "Objects",
    type: "objectgroup",
    properties: [{ name: "officeEnvironment", type: "string", value: "trading" }],
  };
  for (const invalid of [
    { ...layer, name: "Floor" },
    { ...layer, type: "tilelayer" },
    { ...layer, properties: null },
    {
      ...layer,
      properties: [null, {}, { name: "officeEnvironment", type: "string", value: "unknown" }],
    },
    { ...layer, properties: [{ name: "officeEnvironment", type: "int", value: "trading" }] },
  ])
    assert.equal(resolveOfficeEnvironment({ layers: [invalid] }), undefined);
  assert.equal(resolveOfficeEnvironment({ layers: [{ ...layer, name: "objects" }] }), "trading");
  const map = buildOfficeEnvironment("tech");
  map.layers.find((entry) => entry.name === "Objects")!.properties = [];
  assert.equal(tiledSnapshot(map).environment, undefined);
});

test("office environment versions are strict optional integer metadata", () => {
  const map = buildOfficeEnvironment("agency");
  assert.equal(resolveOfficeEnvironmentVersion(map), 5);
  const layer = map.layers.find((entry) => entry.name === "Objects")!;
  const version = layer.properties!.find(
    (property) => property.name === "officeEnvironmentVersion",
  )!;
  for (const value of [undefined, null, 0, -1, 2.5, "2"]) {
    version.value = value as never;
    assert.equal(resolveOfficeEnvironmentVersion(map), undefined);
  }
});
