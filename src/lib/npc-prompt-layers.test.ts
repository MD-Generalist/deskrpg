import test from "node:test";
import assert from "node:assert/strict";

import { composeNpcInstructions, SECTION } from "./npc-prompt-layers";

// 층 조립의 계약을 고정한다. 이 파일이 지키는 두 가지 사실:
//   1) 보낼 것이 없으면 필드 자체를 만들지 않는다 (빈 문자열이 아니라 undefined).
//   2) 각 층은 이름표 붙은 경계 안에 들어가 서로 침범하지 않는다.

test("보낼 층이 하나도 없으면 undefined — 빈 문자열을 보내지 않는다", () => {
  // Hermes 는 instructions 를 기존 시스템 프롬프트 뒤에 이어 붙인다. 빈 문자열을 보내면
  // 의미 없는 개행 두 개가 프롬프트에 남는다. 아예 필드를 만들지 않는 쪽이 옳다.
  assert.equal(composeNpcInstructions({}), undefined);
  assert.equal(composeNpcInstructions({ meetingProtocol: "   " }), undefined);
});

test("회의 규칙만 있으면 그 층만 실린다", () => {
  const out = composeNpcInstructions({ meetingProtocol: "한 번에 한 명씩 말한다" });
  assert.ok(out);
  assert.match(out, new RegExp(`<${SECTION.meeting}>`));
  assert.match(out, /한 번에 한 명씩 말한다/);
});

test("각 층은 이름표 경계로 닫힌다", () => {
  const out = composeNpcInstructions({ meetingProtocol: "MEET" })!;
  for (const name of [SECTION.meeting]) {
    assert.match(out, new RegExp(`<${name}>[\\s\\S]*</${name}>`));
  }
});

test("본문은 그대로 보존된다 — 앞뒤 공백만 다듬는다", () => {
  const body = "줄1\n\n줄2  ";
  const out = composeNpcInstructions({ meetingProtocol: body })!;
  assert.match(out, /줄1\n\n줄2/);
});

test("인격은 보내지 않는다 — SOUL.md 가 단일 소유자다", () => {
  // 게이트웨이 너머에서 인격을 바꿀 수 없다(instructions 는 SOUL.md 뒤에 덧붙기만 한다).
  // 두 인격이 공존하면 결과가 불안정하므로, 보낼 수 있게 되기 전까지 아예 보내지 않는다.
  // 이 계약을 깨려면 이 테스트를 먼저 지워야 한다.
  const out = composeNpcInstructions({
    meetingProtocol: "MEET",
    // @ts-expect-error — identity 는 입력 타입에 없다. 타입이 이미 막고 있다.
    identity: "나는 소피다",
  })!;
  assert.doesNotMatch(out, /나는 소피다/);
});
