import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { attachKeyStorage, stripApiKey } from "./plugin-provision";

describe("stripApiKey", () => {
  it("apiKey 를 응답에서 제거한다", () => {
    // 이 값은 게이트웨이의 한 프로필을 여는 자격증명이다. 브라우저에 닿으면
    // 그 순간부터 우리가 통제할 수 없는 곳(콘솔·확장·에러 리포터)에 남는다.
    const out = stripApiKey({ name: "noah", apiKey: "k".repeat(40), keyIssued: true });
    assert.deepEqual(out, { name: "noah", keyIssued: true });
    assert.equal("apiKey" in out, false);
  });

  it("키 발급 실패는 프로필이 생겼다는 사실과 함께 남긴다", () => {
    // 실패를 뭉개면 사용자는 만들어진 프로필을 모른 채 같은 이름으로 재시도해
    // 409 를 만난다.
    const out = stripApiKey({
      name: "noah",
      keyIssued: false,
      keyError: ".env 을 쓸 수 없다: PermissionError",
    });
    assert.deepEqual(out, {
      name: "noah",
      keyIssued: false,
      keyError: ".env 을 쓸 수 없다: PermissionError",
    });
  });

  it("직렬화 결과에 키가 남지 않는다", () => {
    const secret = "s".repeat(40);
    const json = JSON.stringify(stripApiKey({ name: "n", apiKey: secret, keyIssued: true }));
    assert.equal(json.includes(secret), false);
  });
});

describe("attachKeyStorage", () => {
  it("키가 발급되지 않았으면 저장을 시도하지 않았다는 뜻으로 keyStored:false 만 붙인다", () => {
    const safe = stripApiKey({ name: "noah", keyIssued: false, keyError: "boom" });
    const out = attachKeyStorage(safe, null);
    assert.deepEqual(out, { name: "noah", keyIssued: false, keyError: "boom", keyStored: false });
  });

  it("저장에 성공하면 keyStored:true 다", () => {
    const safe = stripApiKey({ name: "noah", apiKey: "k".repeat(40), keyIssued: true });
    const out = attachKeyStorage(safe, { ok: true });
    assert.deepEqual(out, { name: "noah", keyIssued: true, keyStored: true });
  });

  it("게이트웨이 소유자가 아니라 저장이 거부되면 이유와 함께 keyStored:false 다", () => {
    // 판정 B: 프로필은 실제로 만들어졌으니 201 은 유지하되, 저장 실패를 숨기지 않는다 —
    // 숨기면 그 프로필은 다시 만들 수도(같은 이름 409), 열 수도 없는 상태로 영구히 남는다.
    const safe = stripApiKey({ name: "noah", apiKey: "k".repeat(40), keyIssued: true });
    const out = attachKeyStorage(safe, { ok: false, reason: "forbidden" });
    assert.deepEqual(out, {
      name: "noah",
      keyIssued: true,
      keyStored: false,
      keyStoredError: "forbidden",
    });
  });
});
