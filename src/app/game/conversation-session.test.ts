import assert from "node:assert/strict";
import test from "node:test";
import { ConversationSessionStore } from "./conversation-session";

const text = (value: string) => [{ kind: "text" as const, text: value }];

test("draft and scroll position remain independent for each conversation", () => {
  const store = new ConversationSessionStore();
  store.setDraft("npc:n1", text("첫 질문"));
  store.setScroll("npc:n1", 240);
  store.setDraft("room:r1", text("그룹 질문"));

  assert.deepEqual(store.get("npc:n1"), { draft: text("첫 질문"), scrollTop: 240 });
  assert.deepEqual(store.get("room:r1"), { draft: text("그룹 질문"), scrollTop: 0 });
});

test("session values are bounded and returned as copies", () => {
  const store = new ConversationSessionStore();
  store.setDraft("npc:n1", text("가".repeat(600)));
  store.setScroll("npc:n1", -30);

  const first = store.get("npc:n1");
  const only = first.draft[0];
  assert.equal(only.kind === "text" && only.text.length, 500);
  assert.equal(first.scrollTop, 0);
  first.draft.push({ kind: "text", text: "mutated" });
  assert.equal(store.get("npc:n1").draft.length, 1);
});

test("a draft keeps skill and mention chips as chips", () => {
  const store = new ConversationSessionStore();
  const draft = [
    { kind: "mention" as const, id: "n1", name: "Sophie" },
    { kind: "text" as const, text: " " },
    { kind: "skill" as const, name: "research" },
    { kind: "text" as const, text: " go" },
  ];
  store.setDraft("room:r1", draft);
  assert.deepEqual(store.get("room:r1").draft, draft);
  store.clearDraft("room:r1");
  assert.deepEqual(store.get("room:r1").draft, []);
});

test("an old plain-string draft reads back as one text segment", () => {
  const store = new ConversationSessionStore();
  store.setDraft("npc:n1", "/tmp 폴더 정리해");
  assert.deepEqual(store.get("npc:n1").draft, text("/tmp 폴더 정리해"));
});
