import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  validateAuthSegment,
  validateKeyBody,
  validateToolProviderBody,
} from "./provider-auth-validation";

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

describe("validateToolProviderBody — 도구 프로바이더 선택 본문", () => {
  it("프로바이더와 키 맵을 받는다", () => {
    assert.deepEqual(
      validateToolProviderBody({ provider: "OpenAI TTS", env: { VOICE_TOOLS_OPENAI_KEY: "sk-x" } }),
      { ok: true, provider: "OpenAI TTS", env: { VOICE_TOOLS_OPENAI_KEY: "sk-x" } },
    );
    assert.deepEqual(validateToolProviderBody({ provider: "Microsoft Edge TTS" }), {
      ok: true,
      provider: "Microsoft Edge TTS",
      env: {},
    });
  });

  it("모양이 틀리면 bad_request 이고 값을 싣지 않는다", () => {
    const secret = "sk-SECRET-should-not-echo";
    for (const input of [
      null,
      [],
      { provider: "" },
      { provider: 1 },
      { provider: "x".repeat(129) },
      { provider: "A", env: [] },
      { provider: "A", env: { lower_case: secret } },
      { provider: "A", env: { OK_KEY: 12 } },
      { provider: "A", env: { OK_KEY: "x".repeat(1025) } },
    ]) {
      const result = validateToolProviderBody(input);
      assert.deepEqual(result, { ok: false, errorCode: "bad_request" });
      assert.equal(JSON.stringify(result).includes(secret), false);
    }
  });
});
