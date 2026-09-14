import assert from "node:assert/strict";
import test from "node:test";
import { recentMeetingSpeech } from "./recent-speech";
const message = {
  id: "1",
  sender: "Seo",
  senderId: "npc-seo",
  senderType: "npc" as const,
  content: "최종 본문입니다.",
  timestamp: 1000,
};
test("final speech survives stream cleanup and expires after six seconds", () => {
  assert.equal(recentMeetingSpeech([message], "npc-seo", 1000), "최종 본문입니다.");
  assert.equal(recentMeetingSpeech([message], "npc-seo", 6999), "최종 본문입니다.");
  assert.equal(recentMeetingSpeech([message], "npc-seo", 7000), null);
  assert.equal(recentMeetingSpeech([message], "npc-tae", 1000), null);
});
test("newest same speaker message replaces old text without reviving an empty final", () => {
  assert.equal(
    recentMeetingSpeech(
      [message, { ...message, id: "2", content: "새 본문", timestamp: 2000 }],
      "npc-seo",
      2200,
    ),
    "새 본문",
  );
  assert.equal(
    recentMeetingSpeech(
      [message, { ...message, id: "2", content: " ", timestamp: 2000 }],
      "npc-seo",
      2200,
    ),
    null,
  );
  assert.equal(recentMeetingSpeech([], "npc-seo", 2200), null);
});
