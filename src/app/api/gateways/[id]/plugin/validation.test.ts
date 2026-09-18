import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { validateConfigPatch, validateCreateOptions } from "./validation";

describe("validateConfigPatch — 피커 키", () => {
  it("enabledToolsets·disabledSkills 를 통과시킨다", () => {
    const got = validateConfigPatch({ enabledToolsets: ["web"], disabledSkills: [] });
    assert.equal(got.ok, true);
  });
});

describe("validateCreateOptions", () => {
  it("cloneFrom 은 default 만 받는다", () => {
    assert.deepEqual(validateCreateOptions({ name: "n" }), { ok: true });
    assert.deepEqual(validateCreateOptions({ name: "n", cloneFrom: "default" }), { ok: true, cloneFrom: "default" });
    assert.deepEqual(validateCreateOptions({ name: "n", cloneFrom: "mia" }), { ok: false, errorCode: "bad_request" });
    assert.deepEqual(validateCreateOptions({ name: "n", cloneFrom: true }), { ok: false, errorCode: "bad_request" });
  });
});
