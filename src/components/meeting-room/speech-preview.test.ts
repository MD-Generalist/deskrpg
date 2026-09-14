import assert from "node:assert/strict";
import test from "node:test";

import { buildSpeechBubblePreview } from "./speech-preview";

test("meeting preview preserves the sentence beginning for visual three-line clamping", () => {
  const text = "이 문장은 회의 자리 위 말풍선에 전부 올라가기에는 너무 길다";
  assert.equal(buildSpeechBubblePreview(text), text);
  assert.equal(buildSpeechBubblePreview("  짧은\n 한 줄  "), "짧은 한 줄");
  assert.equal(buildSpeechBubblePreview("   "), "");
});
