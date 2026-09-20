import assert from "node:assert/strict";
import test from "node:test";

import { taskTimeMs } from "./plugin-time";

const EPOCH_SECONDS = 1758412800; // 2025-09-21T00:00:00Z
const AS_MS = EPOCH_SECONDS * 1000;

test("플러그인이 보내는 epoch 초 정수를 읽는다", () => {
  assert.equal(taskTimeMs(EPOCH_SECONDS), AS_MS);
});

test("Date.parse 로는 이 값을 읽을 수 없다 — 이 테스트가 결함의 근거다", () => {
  // 화면이 `Date.parse(task.started_at)` 을 부르던 시절 경과 시간이 조용히 사라진 이유.
  assert.ok(Number.isNaN(Date.parse(String(EPOCH_SECONDS))));
});

test("가짜 플러그인 서버가 보내는 ISO 문자열도 읽는다", () => {
  assert.equal(taskTimeMs(new Date(AS_MS).toISOString()), AS_MS);
});

test("숫자로만 된 문자열은 epoch 초로 읽는다", () => {
  assert.equal(taskTimeMs(String(EPOCH_SECONDS)), AS_MS);
});

test("이미 ms 인 값은 1000배 하지 않는다", () => {
  assert.equal(taskTimeMs(AS_MS), AS_MS);
});

test("없거나 못 읽는 값은 null — 0 이나 NaN 을 돌려주지 않는다", () => {
  assert.equal(taskTimeMs(undefined), null);
  assert.equal(taskTimeMs(null), null);
  assert.equal(taskTimeMs(""), null);
  assert.equal(taskTimeMs("어제"), null);
  assert.equal(taskTimeMs(Number.NaN), null);
});

test("epoch 0 은 값이 없는 것과 다르다", () => {
  assert.equal(taskTimeMs(0), 0);
});
