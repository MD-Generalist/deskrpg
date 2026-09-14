import assert from "node:assert/strict";
import test from "node:test";
import { ConversationSessionStore } from "./conversation-session";

test("draft and scroll position remain independent for each conversation", () => {
  const store = new ConversationSessionStore();
  store.setDraft("npc:n1", "첫 질문");
  store.setScroll("npc:n1", 240);
  store.setDraft("room:r1", "그룹 질문");

  assert.deepEqual(store.get("npc:n1"), { draft: "첫 질문", scrollTop: 240 });
  assert.deepEqual(store.get("room:r1"), { draft: "그룹 질문", scrollTop: 0 });
});

test("session values are bounded and returned as copies", () => {
  const store = new ConversationSessionStore();
  store.setDraft("npc:n1", "가".repeat(600));
  store.setScroll("npc:n1", -30);

  const first = store.get("npc:n1");
  assert.equal(first.draft.length, 500);
  assert.equal(first.scrollTop, 0);
  first.draft = "mutated";
  assert.equal(store.get("npc:n1").draft.length, 500);
});
