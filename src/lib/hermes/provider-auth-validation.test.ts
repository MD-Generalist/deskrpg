import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { validateAuthSegment, validateKeyBody } from "./provider-auth-validation";

describe("프로바이더 인증 입력 검증", () => {
  it("경로 세그먼트는 좁은 문자만", () => {
    assert.equal(validateAuthSegment("openai-codex"), true);
    assert.equal(validateAuthSegment("abc_DEF.1-2"), true);
    for (const bad of ["", "a/b", "..%2f", "x".repeat(129), "a b", ".", ".."]) {
      assert.equal(validateAuthSegment(bad), false);
    }
  });
  it("키 본문은 문자열 value 만, 값을 오류에 싣지 않는다", () => {
    assert.deepEqual(validateKeyBody({ value: "sk-VALUE-123" }), {
      ok: true,
      value: "sk-VALUE-123",
    });
    for (const bad of [
      null,
      {},
      { value: 1 },
      { value: "" },
      { value: "x".repeat(1025) },
      "sk-raw",
      ["sk-arr"],
    ]) {
      const got = validateKeyBody(bad);
      assert.equal(got.ok, false);
      assert.equal(JSON.stringify(got).includes("sk-"), false);
    }
  });
});
