import assert from "node:assert/strict";
import test from "node:test";
import { createRejoinTracker, registerOnce, shouldRejoinForError } from "./socket-rejoin";

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

test("registerOnce 는 같은 핸들러를 두 번 등록해도 한 번만 걸린다", () => {
  const handlers = new Map<string, Set<() => void>>();
  const bus = {
    on(event: string, handler: () => void) {
      if (!handlers.has(event)) handlers.set(event, new Set());
      handlers.get(event)!.add(handler);
    },
    off(event: string, handler: () => void) {
      handlers.get(event)?.delete(handler);
    },
  };
  const handler = () => {};

  registerOnce(bus, "socket-rejoin", handler);
  registerOnce(bus, "socket-rejoin", handler);

  assert.equal(
    handlers.get("socket-rejoin")?.size,
    1,
    "setupSocketListeners 가 두 번 불려도 핸들러는 하나여야 한다",
  );
});

test("shouldRejoinForError: 같은 소켓 id 면 이미 join 했으니 재조인하지 않는다", () => {
  assert.equal(
    shouldRejoinForError("abc", "abc"),
    false,
    "connect 핸들러가 이미 이 id 로 join 했다",
  );
});

test("shouldRejoinForError: 다른 소켓 id 면 아직 join 안 한 것이므로 재조인한다", () => {
  assert.equal(shouldRejoinForError("new-id", "old-id"), true);
});

test("shouldRejoinForError: 현재 소켓 id 가 없으면(연결 끊김) 이 id 로는 join 한 적이 없으니 재조인한다", () => {
  assert.equal(shouldRejoinForError(undefined, "old-id"), true);
});

test("shouldRejoinForError: 이번 세션에서 한 번도 join 한 적 없으면 재조인한다", () => {
  assert.equal(shouldRejoinForError("abc", undefined), true);
});
