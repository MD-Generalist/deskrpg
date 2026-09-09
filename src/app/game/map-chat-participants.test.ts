import assert from "node:assert/strict";
import test from "node:test";

import { MapChatParticipants } from "./map-chat-participants";

test("맵 채팅으로 온 NPC 가 그 방의 참여자가 되고, 다시 부를 대상은 곁에 없는 참여자다", () => {
  const p = new MapChatParticipants();
  p.noteCalled("r1", "a", "map-chat");
  p.noteCalled("r1", "b", "map-chat");
  p.noteCalled("r1", "c"); // 컨텍스트 메뉴 — 참여자 아님
  assert.deepEqual(p.recallTargets("r1", new Set(["a"])).sort(), ["b"], "a 는 이미 곁에 있다");
});

test("참여자는 방마다 갈린다 — 다른 방의 참여자를 부르지 않는다", () => {
  const p = new MapChatParticipants();
  p.noteCalled("r1", "a", "map-chat");
  p.noteCalled("r2", "b", "map-chat");
  assert.deepEqual(p.recallTargets("r1", new Set()), ["a"]);
  assert.deepEqual(p.recallTargets("r2", new Set()), ["b"]);
  assert.deepEqual(p.recallTargets("r3", new Set()), [], "모르는 방은 빈 목록");
  assert.deepEqual(p.recallTargets(null, new Set()), [], "방이 없으면 아무도 부르지 않는다");
});

test("돌려보내기(명시적 dismiss)는 모든 방의 참여자에서 뺀다 — 자동 복귀는 빼지 않는다", () => {
  const p = new MapChatParticipants();
  p.noteCalled("r1", "a", "map-chat");
  p.noteCalled("r2", "a", "map-chat");
  p.noteCalled("r1", "b", "map-chat");
  p.dismiss("a");
  assert.deepEqual(p.recallTargets("r1", new Set()), ["b"]);
  assert.deepEqual(p.recallTargets("r2", new Set()), []);
});

test("같은 NPC 를 여러 번 불러도 한 번만", () => {
  const p = new MapChatParticipants();
  p.noteCalled("r1", "a", "map-chat");
  p.noteCalled("r1", "a", "map-chat");
  assert.deepEqual(p.recallTargets("r1", new Set()), ["a"]);
});

test("roomId 없이 온 호출은 무시한다 — 어느 방의 참여자인지 알 수 없다", () => {
  const p = new MapChatParticipants();
  p.noteCalled(undefined, "a", "map-chat");
  assert.deepEqual(p.recallTargets("r1", new Set()), []);
});
