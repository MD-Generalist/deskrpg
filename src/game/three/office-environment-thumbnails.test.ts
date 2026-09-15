import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { OFFICE_ENVIRONMENTS } from "./office-environments";
import thumbnails from "./office-environment-thumbnails.json";

test("every selectable environment ships a content-versioned WebP thumbnail", () => {
  assert.deepEqual(Object.keys(thumbnails).sort(), OFFICE_ENVIRONMENTS.map((e) => e.id).sort());
  for (const environment of OFFICE_ENVIRONMENTS) {
    const url = thumbnails[environment.id];
    const bytes = readFileSync(`public${url}`);
    assert.equal(bytes.toString("ascii", 0, 4), "RIFF");
    assert.equal(bytes.toString("ascii", 8, 12), "WEBP");
    assert.ok(url.includes(createHash("sha256").update(bytes).digest("hex").slice(0, 12)));
  }
});
