import assert from "node:assert/strict";
import test from "node:test";
import { createRejoinTracker } from "./socket-rejoin";

test("첫 connect 는 재조인이 아니다 — 스폰 경로가 이미 join 을 보냈다", () => {
  const t = createRejoinTracker();
  assert.equal(t.shouldRejoin(true), false);
});

test("disconnect 뒤 connect 는 재조인이고, 한 번만 소비된다", () => {
  const t = createRejoinTracker();
  t.onDisconnect();
  assert.equal(t.shouldRejoin(true), true);
  assert.equal(
    t.shouldRejoin(true),
    false,
    "같은 재연결로 두 번 join 하면 player:joined 가 두 번 방송된다",
  );
});

test("플레이어가 아직 스폰 전이면 재조인하지 않고 플래그를 남긴다", () => {
  const t = createRejoinTracker();
  t.onDisconnect();
  assert.equal(t.shouldRejoin(false), false);
  assert.equal(t.shouldRejoin(true), true, "스폰 뒤 다음 connect 에서 잡아야 한다");
});
