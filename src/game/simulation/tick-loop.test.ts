import test from "node:test";
import assert from "node:assert/strict";
import { clampFrameDelta, MAX_FRAME_DELTA_MS } from "./tick-loop";

test("첫 프레임은 경과 0, 그 뒤는 실제 경과를 쓴다", () => {
  assert.equal(clampFrameDelta(1000, null), 0);
  assert.equal(clampFrameDelta(1016.7, 1000), 16.700000000000045);
});

test("가려진 탭에서 돌아온 긴 공백은 상한으로 잘린다", () => {
  assert.equal(clampFrameDelta(60_000, 1000), MAX_FRAME_DELTA_MS);
  assert.equal(clampFrameDelta(1300, 1000, 100), 100);
});

test("시계가 거꾸로 가도 음수 경과는 내지 않는다", () => {
  assert.equal(clampFrameDelta(900, 1000), 0);
});
