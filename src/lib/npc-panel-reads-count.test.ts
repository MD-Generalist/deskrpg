import assert from "node:assert/strict";
import { test } from "node:test";
import { pruneSeenIds, unseenCardCount, unseenCronCount } from "./npc-panel-reads-count";

test("본 카드는 세지 않는다", () => {
  assert.equal(unseenCardCount(["a", "b", "c"], ["a"]), 2);
  assert.equal(unseenCardCount(["a"], ["a"]), 0);
  assert.equal(unseenCardCount([], ["a", "b"]), 0);
});

test("담당에서 빠진 id 는 가지쳐진다 — 집합이 무한히 자라지 않는다", () => {
  assert.deepEqual(pruneSeenIds(["a", "b"], ["a", "옛것", "또옛것"]), ["a"]);
  assert.deepEqual(pruneSeenIds([], ["a"]), []);
});

test("크론은 seenAt 이후만 센다", () => {
  const times = ["2026-09-20T00:00:00Z", "2026-09-21T00:00:00Z", "2026-09-22T00:00:00Z"];
  assert.equal(unseenCronCount(times, "2026-09-21T00:00:00Z"), 1);
  assert.equal(unseenCronCount(times, null), 3);
  assert.equal(unseenCronCount(times, "2026-09-23T00:00:00Z"), 0);
});

test("seenAt 과 정확히 같은 시각은 이미 본 것으로 본다", () => {
  assert.equal(unseenCronCount(["2026-09-21T00:00:00Z"], "2026-09-21T00:00:00Z"), 0);
});
