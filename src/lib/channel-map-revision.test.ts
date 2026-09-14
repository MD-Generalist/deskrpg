import test from "node:test";
import assert from "node:assert/strict";
import { mapContentRevision } from "./channel-map-revision";

test("map revision canonicalizes PostgreSQL objects and SQLite JSON without losing map edits", () => {
  const first = { layers: [{ data: [1, 2], name: "floor" }], width: 2 };
  const reordered = { width: 2, layers: [{ name: "floor", data: [1, 2] }] };
  assert.equal(mapContentRevision(first), mapContentRevision(JSON.stringify(reordered)));
  assert.match(mapContentRevision(first), /^map-sha256:[a-f0-9]{64}$/);
  assert.notEqual(mapContentRevision(first), mapContentRevision({ ...first, width: 3 }));
  assert.notEqual(
    mapContentRevision(first),
    mapContentRevision({ ...first, layers: [{ data: [2, 1], name: "floor" }] }),
  );
  assert.equal(mapContentRevision(null), mapContentRevision("null"));
  assert.notEqual(mapContentRevision(null), mapContentRevision("invalid map"));
  assert.notEqual(mapContentRevision(null), mapContentRevision(first));
});
