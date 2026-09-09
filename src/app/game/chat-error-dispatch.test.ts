import assert from "node:assert/strict";
import test from "node:test";
import { decideChatError } from "./chat-error-dispatch";

test("not_joined → 재조인 요청 + 재시도 토스트", () => {
  assert.deepEqual(decideChatError({ code: "not_joined" }), {
    toastKey: "game.channelChatNotJoined",
    rejoin: true,
  });
});

test("모르는 코드는 일반 실패 토스트, 재조인 없음", () => {
  assert.deepEqual(decideChatError({ code: "weird" }), {
    toastKey: "game.channelChatFailed",
    rejoin: false,
  });
  assert.deepEqual(decideChatError(null), { toastKey: "game.channelChatFailed", rejoin: false });
});
