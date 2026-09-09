import assert from "node:assert/strict";
import test from "node:test";
import { handleChatSend } from "./channel-chat";
import type { PlayerState } from "./socket-handlers";

const player: PlayerState = {
  id: "s1",
  userId: "u1",
  characterId: "c1",
  characterName: "단테",
  appearance: null,
  mapId: "ch1",
  x: 0,
  y: 0,
  direction: "down",
  animation: "idle",
};
const base = () => ({
  socketId: "s1",
  message: "안녕",
  now: 10_000,
  lastChatTime: new Map<string, number>(),
  channelChatHistory: new Map(),
  fallbackSender: "nick",
  cooldownMs: 2000,
});

test("players 에 없는 소켓은 조용히 버리지 않고 not_joined 를 돌려준다", () => {
  const r = handleChatSend({ ...base(), player: undefined });
  assert.equal(r.kind, "not_joined");
});

test("정상 전송은 이력에 쌓이고 멘션 여부를 알려준다", () => {
  const args = { ...base(), player };
  const r = handleChatSend({ ...args, message: "@[소피] 안녕" });
  assert.equal(r.kind, "sent");
  if (r.kind !== "sent") return;
  assert.equal(r.mentions, true);
  assert.equal(r.message.sender, "단테");
  assert.equal(args.channelChatHistory.get("ch1")?.length, 1);
});

test("쿨다운 안의 두 번째 메시지는 ignored — not_joined 와 섞이지 않는다", () => {
  const args = { ...base(), player };
  handleChatSend(args);
  const r = handleChatSend({ ...args, now: 10_500 });
  assert.equal(r.kind, "ignored");
});

test("500자 초과는 잘리고 빈 문자열은 ignored", () => {
  const args = { ...base(), player };
  const r = handleChatSend({ ...args, message: "x".repeat(600) });
  assert.equal(r.kind, "sent");
  if (r.kind === "sent") assert.equal(r.message.content.length, 500);
  assert.equal(handleChatSend({ ...base(), player, message: "   " }).kind, "ignored");
});
