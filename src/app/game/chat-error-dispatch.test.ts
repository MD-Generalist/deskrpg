import assert from "node:assert/strict";
import test from "node:test";
import { decideChatError } from "./chat-error-dispatch";

test("not_joined → 재조인 요청, 목록으로는 가지 않는다", () => {
  assert.deepEqual(decideChatError({ roomId: "r1", code: "not_joined" }), {
    toastKey: "game.room.error.not_joined",
    rejoin: true,
    backToList: false,
  });
});

test("not_found·forbidden 은 목록으로 돌려보낸다 — 그 방은 더 볼 수 없다", () => {
  for (const code of ["not_found", "forbidden"]) {
    assert.deepEqual(
      decideChatError({ code }),
      { toastKey: `game.room.error.${code}`, rejoin: false, backToList: true },
      code,
    );
  }
});

test("나머지 코드는 토스트만 — 화면을 옮기지 않는다", () => {
  for (const code of ["not_open", "empty", "cooldown", "invalid"]) {
    assert.deepEqual(
      decideChatError({ code }),
      { toastKey: `game.room.error.${code}`, rejoin: false, backToList: false },
      code,
    );
  }
});

test("모르는 코드는 일반 실패 토스트, 재조인도 이동도 없음", () => {
  const generic = { toastKey: "game.channelChatFailed", rejoin: false, backToList: false };
  assert.deepEqual(decideChatError({ code: "weird" }), generic);
  assert.deepEqual(decideChatError(null), generic);
  assert.deepEqual(decideChatError({}), generic);
});
