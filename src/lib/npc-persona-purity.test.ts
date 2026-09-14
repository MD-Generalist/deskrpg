import test from "node:test";
import assert from "node:assert/strict";

import { buildPersonaConfig } from "./npc-agent-defaults";

// 저장되는 인격에 태스크 절차가 섞이지 않는다.
//
// 예전에는 `injectTaskPrompt()` 가 절차를 인격 문자열 **앞에 붙여서** 저장했다.
// 실측(2026-08-30, 스테이징 소피): 저장된 인격 2,496자 중 1,704자(68%)가 주입된
// 절차였다. 사용자가 인격을 편집하면 절차를 같이 지울 수 있었고, 이미 인격이 있는
// 프로필에 절차만 얹는 것도 불가능했다.
//
// 태스크 시스템은 2026-09 에 폐기됐지만, 이 계약은 남는다 — 회의 규칙 같은 절차는
// 시스템 지시의 층(npc-prompt-layers)으로 가고, 저장된 인격은 사용자가 쓴 것만 담는다.

test("저장되는 인격에 태스크 절차가 섞이지 않는다", () => {
  const cfg = buildPersonaConfig({
    presetId: "dev-a",
    npcName: "앨리스",
    locale: "ko",
    identityOverride: "나는 앨리스다.",
  });
  assert.equal(cfg.identity.includes("Task Management Protocol"), false);
});

test("프리셋 기본 인격에도 섞이지 않는다", () => {
  const cfg = buildPersonaConfig({ presetId: "dev-a", npcName: "앨리스", locale: "ko" });
  assert.equal(cfg.identity.includes("Task Management Protocol"), false);
});

test("사용자가 쓴 인격이 손대지 않은 채 들어 있다", () => {
  // `localizeNpcPromptDocument` 가 앞에 "## 언어 정책" 블록을 붙인다 — 그건 문서
  // 지역화이지 태스크 절차가 아니다. 여기서 고정하는 것은 **사용자가 쓴 본문이
  // 잘리거나 변형되지 않는다**는 것이다.
  const written = "나는 앨리스다.\n\n## 원칙\n- 짧게 말한다";
  const cfg = buildPersonaConfig({
    presetId: "dev-a",
    npcName: "앨리스",
    locale: "ko",
    identityOverride: written,
  });
  assert.ok(cfg.identity.includes(written), "사용자 본문이 그대로 들어 있어야 한다");
  assert.equal(cfg.identity.includes("Task Management Protocol"), false);
});
