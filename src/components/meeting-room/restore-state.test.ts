import test from "node:test";
import assert from "node:assert/strict";
import { restoreMeetingChat, restoreMeetingExecution } from "./restore-state";
import type { MeetingDiscussionState } from "../../lib/meeting-discussion-state";

const state: MeetingDiscussionState = {
  topic: "Meeting",
  npcs: [{ id: "one", name: "One" }],
  mode: "manual",
  initiatorId: "user",
  initiatorSocketId: "old-socket",
  isWaitingInput: true,
};
const messages = [{ senderType: "npc", content: "Hello", id: "message" }];
test("manual reconnect restores completed messages and actual next-turn readiness", () => {
  const restored = restoreMeetingChat(state, messages);
  assert.deepEqual(restored.messages, messages);
  assert.equal(restored.isWaitingInput, true);
  assert.equal(
    restoreMeetingChat({ ...state, isWaitingInput: false }, messages).isWaitingInput,
    false,
  );
});
test("mid-turn reconnect keeps raw prefix so later chunks can complete it", () => {
  const currentSpeaker = { npcId: "one", npcName: "One" };
  const rawStreams = { one: "Hello " };
  const restored = restoreMeetingChat(
    { ...state, isWaitingInput: false, currentSpeaker, rawStreams },
    messages,
  );
  assert.deepEqual(restored.currentSpeaker, currentSpeaker);
  assert.equal(restored.rawStreams.one + "world", "Hello world");
  restored.rawStreams.one += "world";
  assert.equal(rawStreams.one, "Hello ");
  assert.equal(restored.isWaitingInput, false);
});
test("finished meeting join clears chat and transient state", () => {
  assert.deepEqual(restoreMeetingChat(null, messages), {
    messages: [],
    rawStreams: {},
    streams: {},
    currentSpeaker: null,
    isWaitingInput: false,
  });
});
test("snapshot sanitizes NPC display but preserves raw prefixes and user text", () => {
  const rawStreams = { one: "SPE" };
  const restored = restoreMeetingChat({ ...state, rawStreams }, [
    { senderType: "npc", content: "SPEAK: Hello" },
    { senderType: "user", content: "SPEAK: literal user input" },
  ]);
  assert.equal(restored.streams.one, "");
  assert.equal(restored.rawStreams.one, "SPE");
  assert.equal(restored.messages[0].content, "Hello");
  assert.equal(restored.messages[1].content, "SPEAK: literal user input");
});

test("mode execution uses actual readiness rather than inferring manual means waiting", () => {
  assert.equal(restoreMeetingExecution({ isWaitingInput: false }).isWaitingInput, false);
  assert.equal(restoreMeetingExecution({ isWaitingInput: true }).isWaitingInput, true);
  const speaker = { npcId: "one", npcName: "One" };
  assert.deepEqual(restoreMeetingExecution({ currentSpeaker: speaker }).currentSpeaker, speaker);
  assert.equal(restoreMeetingExecution(undefined).isWaitingInput, false);
});
