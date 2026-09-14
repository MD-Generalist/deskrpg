import { test } from "node:test";
import assert from "node:assert/strict";
import { SpeechPreviews } from "./speech-previews";

test("partial and final replies replace previews and remain readable after completion", () => {
  const previews = new SpeechPreviews();
  previews.set("npc", "첫 답변", 0);
  previews.set("npc", "첫 답변\n다음 문장", 1000);
  previews.set("other", "다른 직원", 1000);
  previews.set("npc", "", 1100);
  assert.equal(previews.get("npc", 12000), "첫 답변 다음 문장");
  assert.equal(previews.get("other", 12000), "다른 직원");
  assert.equal(previews.get("npc", 13000), undefined);
});

test("long Korean and emoji text stays bounded without splitting surrogate pairs", () => {
  const previews = new SpeechPreviews();
  previews.set("npc", "안녕😀".repeat(100), 0);
  const text = previews.get("npc", 0)!;
  assert.equal(Array.from(text).length, 240);
  assert.ok(text.endsWith("..."));
  assert.ok(!text.includes("\ufffd"));
});
