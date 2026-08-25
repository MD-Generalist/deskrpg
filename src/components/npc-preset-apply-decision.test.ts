import test from "node:test";
import assert from "node:assert/strict";

import { shouldReplacePresetText } from "./npc-preset-apply-decision";

const untouched = { identity: false, soul: false };

// --- 외형 프리셋: 암묵적 조작이므로 사용자가 쓴 페르소나를 지킨다 ---

test("외형 프리셋은 편집된 identity 를 덮어쓰지 않는다", () => {
  assert.equal(shouldReplacePresetText("appearance", { identity: true, soul: false }), false);
});

test("외형 프리셋은 identity 만 편집됐어도 soul 까지 지킨다", () => {
  // identity 만 손댄 흔한 경우. soul 을 프리셋으로 갈아 끼우면 identity 는 사용자 것,
  // soul 은 프리셋 것인 혼합 페르소나가 만들어진다 — 화면의 프리셋 이름이 거짓이 된다.
  assert.equal(shouldReplacePresetText("appearance", { identity: true, soul: false }), false);
});

test("외형 프리셋은 soul 만 편집됐어도 identity 까지 지킨다", () => {
  assert.equal(shouldReplacePresetText("appearance", { identity: false, soul: true }), false);
});

test("외형 프리셋은 아무것도 손대지 않았으면 페르소나를 채운다", () => {
  assert.equal(shouldReplacePresetText("appearance", untouched), true);
});

// --- 페르소나 select: 교체가 요청 자체다 ---

test("페르소나를 직접 고르면 편집된 본문도 교체한다", () => {
  assert.equal(shouldReplacePresetText("persona", { identity: true, soul: true }), true);
});

test("페르소나를 직접 고르면 빈 본문도 채운다", () => {
  assert.equal(shouldReplacePresetText("persona", untouched), true);
});
