import assert from "node:assert/strict";
import test from "node:test";

import { MapChatParticipants } from "./map-chat-participants";

test("맵 채팅으로 온 NPC 가 참여자가 되고, 다시 부를 대상은 곁에 없는 참여자다", () => {
  const p = new MapChatParticipants();
  p.noteCalled("a", "map-chat");
  p.noteCalled("b", "map-chat");
  p.noteCalled("c"); // 컨텍스트 메뉴 — 참여자 아님
  assert.deepEqual(p.recallTargets(new Set(["a"])).sort(), ["b"], "a 는 이미 곁에 있으니 제외");
});

test("돌려보내기(명시적 dismiss)는 참여자에서 뺀다 — 자동 복귀는 빼지 않는다", () => {
  const p = new MapChatParticipants();
  p.noteCalled("a", "map-chat");
  p.noteCalled("b", "map-chat");
  p.dismiss("a");
  assert.deepEqual(p.recallTargets(new Set()), ["b"]);
});

test("같은 NPC 를 여러 번 불러도 한 번만", () => {
  const p = new MapChatParticipants();
  p.noteCalled("a", "map-chat");
  p.noteCalled("a", "map-chat");
  assert.deepEqual(p.recallTargets(new Set()), ["a"]);
});
