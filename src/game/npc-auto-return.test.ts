import assert from "node:assert/strict";
import test from "node:test";

import { shouldAutoReturn, shouldReturnOnChatClose } from "./npc-auto-return";

test("컨텍스트 메뉴로 부른 NPC 는 지금처럼 — 대화창이 없으면 자동 복귀 대상", () => {
  assert.equal(
    shouldAutoReturn(
      { moveState: "waiting", calledBy: "direct" },
      { dialogOpen: false, channelChatVisible: true },
    ),
    true,
  );
  assert.equal(
    shouldAutoReturn(
      { moveState: "waiting", calledBy: "direct" },
      { dialogOpen: true, channelChatVisible: false },
    ),
    false,
  );
});

test("맵 채팅으로 온 NPC 는 채널 채팅이 보이는 동안 머문다", () => {
  assert.equal(
    shouldAutoReturn(
      { moveState: "waiting", calledBy: "map-chat" },
      { dialogOpen: false, channelChatVisible: true },
    ),
    false,
  );
  assert.equal(
    shouldAutoReturn(
      { moveState: "waiting", calledBy: "map-chat" },
      { dialogOpen: false, channelChatVisible: false },
    ),
    true,
    "채널 채팅이 닫혀 있으면 map-chat NPC 도 타이머를 탄다",
  );
});

test("대기 중이 아니면 어느 쪽도 복귀 판정을 하지 않는다", () => {
  assert.equal(
    shouldAutoReturn(
      { moveState: "moving-to-player", calledBy: "map-chat" },
      { dialogOpen: false, channelChatVisible: false },
    ),
    false,
  );
});

test("채널 채팅이 닫히면 대기 중인 map-chat NPC 만 즉시 돌아간다", () => {
  assert.equal(shouldReturnOnChatClose({ moveState: "waiting", calledBy: "map-chat" }), true);
  assert.equal(shouldReturnOnChatClose({ moveState: "waiting", calledBy: "direct" }), false);
  assert.equal(shouldReturnOnChatClose({ moveState: "returning", calledBy: "map-chat" }), false);
});
