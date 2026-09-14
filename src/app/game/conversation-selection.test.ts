import assert from "node:assert/strict";
import test from "node:test";
import {
  closeConversation,
  initialConversationSelection,
  selectMeeting,
  selectNpc,
  selectRoom,
  selectionKey,
} from "./conversation-selection";

test("selecting a room, NPC, or meeting replaces the previous conversation", () => {
  let state = initialConversationSelection;
  state = selectRoom(state, "office-1");
  assert.deepEqual(state, { kind: "room", roomId: "office-1" });

  state = selectNpc(state, "npc-1", "소피");
  assert.deepEqual(state, { kind: "npc", npcId: "npc-1", npcName: "소피" });

  state = selectMeeting(state);
  assert.deepEqual(state, { kind: "meeting" });
  assert.deepEqual(closeConversation(state), { kind: "none" });
});

test("conversation keys stay stable when display names change", () => {
  assert.equal(selectionKey({ kind: "room", roomId: "r1" }), "room:r1");
  assert.equal(selectionKey({ kind: "npc", npcId: "n1", npcName: "소피" }), "npc:n1");
  assert.equal(selectionKey({ kind: "npc", npcId: "n1", npcName: "Sophie" }), "npc:n1");
  assert.equal(
    selectionKey({ kind: "compose", mode: "invite", roomId: "r1", presetNpcIds: [] }),
    "compose:invite:r1",
  );
});
