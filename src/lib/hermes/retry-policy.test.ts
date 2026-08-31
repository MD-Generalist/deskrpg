import test from "node:test";
import assert from "node:assert/strict";

import { parseRetryAfterMs, shouldRetryStatus, retryDelayMs } from "./retry-policy";

// Hermes 는 동시 실행 상한을 넘기면 조용히 버리지 않는다 —
// `429 + Retry-After: 1 + code: rate_limit_exceeded` 로 또박또박 거절한다
// (api_server.py:7154-7182). 그걸 받아 버리는 쪽이 DeskRPG 였다.

test("429 만 재시도한다", () => {
  assert.equal(shouldRetryStatus(429), true);
  // 503 은 게이트웨이가 스스로 못 받는 상태다 — 되풀이해도 같은 답이 온다.
  for (const s of [400, 401, 403, 404, 500, 503]) {
    assert.equal(shouldRetryStatus(s), false, `${s}`);
  }
});

test("Retry-After 초를 밀리초로 읽는다", () => {
  assert.equal(parseRetryAfterMs("1"), 1000);
  assert.equal(parseRetryAfterMs("0"), 0);
  assert.equal(parseRetryAfterMs("2.5"), 2500);
});

test("Retry-After 가 없거나 이상하면 null", () => {
  for (const v of [null, "", "soon", "-1", "NaN"]) {
    assert.equal(parseRetryAfterMs(v), null, JSON.stringify(v));
  }
});

test("Retry-After 가 터무니없이 길면 상한으로 자른다", () => {
  // 회의 한 턴을 몇 분씩 붙들면 사용자는 멈춘 것으로 본다.
  assert.equal(parseRetryAfterMs("600"), 10_000);
});

test("헤더가 없으면 시도마다 늘어나는 백오프를 쓴다", () => {
  assert.equal(retryDelayMs(0, null), 500);
  assert.equal(retryDelayMs(1, null), 1000);
  assert.equal(retryDelayMs(2, null), 2000);
});

test("헤더가 있으면 헤더가 이긴다", () => {
  // 서버가 아는 것이 우리 추측보다 낫다.
  assert.equal(retryDelayMs(0, 1000), 1000);
  assert.equal(retryDelayMs(2, 1000), 1000);
});
