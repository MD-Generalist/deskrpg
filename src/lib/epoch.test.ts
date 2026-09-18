import test from "node:test";
import assert from "node:assert/strict";

import { epochSecondsToMs } from "./epoch";

test("플러그인 사건 ts(초)를 ms 로 바꾼다", () => {
  assert.equal(epochSecondsToMs(1_758_000_000), 1_758_000_000_000);
});
