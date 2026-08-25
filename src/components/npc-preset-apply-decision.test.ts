import test from "node:test";
import assert from "node:assert/strict";

import { shouldReplacePresetText } from "./npc-preset-apply-decision";

// --- 외형 프리셋: 암묵적 조작이므로 사용자가 쓴 본문을 지킨다 ---

test("외형 프리셋은 사용자가 편집한 본문을 덮어쓰지 않는다", () => {
  assert.equal(shouldReplacePresetText("appearance", true), false);
});

test("외형 프리셋은 손대지 않은 본문은 채운다", () => {
  assert.equal(shouldReplacePresetText("appearance", false), true);
});

// --- 페르소나 select: 교체가 요청 자체다 ---

test("페르소나를 직접 고르면 편집한 본문도 교체한다", () => {
  assert.equal(shouldReplacePresetText("persona", true), true);
});

test("페르소나를 직접 고르면 빈 본문도 채운다", () => {
  assert.equal(shouldReplacePresetText("persona", false), true);
});
