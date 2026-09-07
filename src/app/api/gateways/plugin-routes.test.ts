import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  validateConfigPatch,
  validateCreatableProfileName,
  validateIdentityPutBody,
} from "@/app/api/gateways/[id]/plugin/validation";

describe("validateCreatableProfileName", () => {
  test("accepts a well-formed lowercase name", () => {
    const result = validateCreatableProfileName({ name: "noah" });
    assert.deepEqual(result, { ok: true, name: "noah" });
  });

  test("rejects an uppercase name (existing-profile regex would have allowed it)", () => {
    // 판정 A: Hermes 는 새 프로필 생성 시 `^[a-z0-9][a-z0-9_-]{0,63}$` 만 받는다.
    const result = validateCreatableProfileName({ name: "MyBot" });
    assert.deepEqual(result, { ok: false, errorCode: "invalid_profile_name" });
  });

  test("rejects a dot (existing-profile regex would have allowed it)", () => {
    const result = validateCreatableProfileName({ name: "my.bot" });
    assert.deepEqual(result, { ok: false, errorCode: "invalid_profile_name" });
  });

  test("rejects reserved names", () => {
    const result = validateCreatableProfileName({ name: "test" });
    assert.deepEqual(result, { ok: false, errorCode: "invalid_profile_name" });
  });

  test("rejects a leading dash", () => {
    const result = validateCreatableProfileName({ name: "-lead" });
    assert.deepEqual(result, { ok: false, errorCode: "invalid_profile_name" });
  });

  test("rejects a non-string name", () => {
    const result = validateCreatableProfileName({ name: 42 });
    assert.deepEqual(result, { ok: false, errorCode: "invalid_profile_name" });
  });
});

describe("validateIdentityPutBody", () => {
  test("accepts a body with a non-empty ifRevision", () => {
    const result = validateIdentityPutBody({ body: "hello", ifRevision: "rev-1" });
    assert.deepEqual(result, { ok: true, body: "hello", ifRevision: "rev-1" });
  });

  test("rejects a missing ifRevision", () => {
    const result = validateIdentityPutBody({ body: "hello" });
    assert.deepEqual(result, { ok: false, errorCode: "bad_request" });
  });

  test("rejects an empty ifRevision", () => {
    const result = validateIdentityPutBody({ body: "hello", ifRevision: "" });
    assert.deepEqual(result, { ok: false, errorCode: "bad_request" });
  });

  test("rejects a non-string body", () => {
    const result = validateIdentityPutBody({ body: 123, ifRevision: "rev-1" });
    assert.deepEqual(result, { ok: false, errorCode: "bad_request" });
  });
});

describe("validateConfigPatch", () => {
  test("accepts a patch containing only allowed keys", () => {
    const result = validateConfigPatch({ model: "gpt-5", toolsets: ["web"] });
    assert.deepEqual(result, { ok: true, patch: { model: "gpt-5", toolsets: ["web"] } });
  });

  test("accepts an empty patch", () => {
    const result = validateConfigPatch({});
    assert.deepEqual(result, { ok: true, patch: {} });
  });

  test("rejects an unsupported key", () => {
    const result = validateConfigPatch({ model: "gpt-5", memory: "on" });
    assert.deepEqual(result, {
      ok: false,
      errorCode: "unsupported_config_key",
      unknownKeys: ["memory"],
    });
  });

  test("passes reasoning_effort through", () => {
    // 플러그인이 받는 키인데 여기서 막히면 화면의 드롭다운이 조용히 무력해진다.
    const result = validateConfigPatch({ reasoning_effort: "high" });
    assert.deepEqual(result, { ok: true, patch: { reasoning_effort: "high" } });
  });

  test("passes an empty reasoning_effort through (means unset)", () => {
    // 빈 문자열은 "지정 안 함" 이라는 뜻이다 — 여기서 떨구면 해제할 방법이 없다.
    const result = validateConfigPatch({ reasoning_effort: "" });
    assert.deepEqual(result, { ok: true, patch: { reasoning_effort: "" } });
  });

  test("rejects a non-object body", () => {
    const result = validateConfigPatch("nope");
    assert.deepEqual(result, { ok: false, errorCode: "bad_request" });
  });

  test("rejects an array body", () => {
    const result = validateConfigPatch(["model"]);
    assert.deepEqual(result, { ok: false, errorCode: "bad_request" });
  });
});
