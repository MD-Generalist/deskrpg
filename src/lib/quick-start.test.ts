import test from "node:test";
import assert from "node:assert/strict";

import {
  QUICK_START_APPEARANCE,
  quickStartChannelName,
  quickStartCharacterName,
  quickStartGamePath,
} from "./quick-start";
import { validateOfficeAppearance } from "../game/three/office-appearance";

test("기본 외형은 캐릭터 라우트의 검증을 통과하는 첫 번째 남성 룩이다", () => {
  assert.equal(validateOfficeAppearance(QUICK_START_APPEARANCE), null);
  assert.deepEqual(QUICK_START_APPEARANCE, { officeLookId: "office-jun", bodyType: "male" });
});

test("이름은 닉네임에서 나오고 길이 한도를 넘지 않는다", () => {
  assert.equal(quickStartCharacterName("  단테  "), "단테");
  assert.equal(quickStartCharacterName(""), "Player");
  assert.equal(quickStartCharacterName("x".repeat(80)).length, 50);
  assert.equal(quickStartChannelName(null), "My Office");
  assert.equal(quickStartChannelName("x".repeat(200)).length, 100);
});

test("게임 경로에는 채널만 실린다 — 캐릭터는 서버가 정한다", () => {
  assert.equal(quickStartGamePath({ channelId: "c 1" }), "/game?channelId=c+1");
});
