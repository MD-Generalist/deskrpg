import test from "node:test";
import assert from "node:assert/strict";

import { isPersonaOwnedByProfile } from "./npc-persona-ownership";

test("hermes NPC 의 인격은 프로필이 소유한다", () => {
  // SOUL.md 를 HTTP 로 끌 수 없으므로 DeskRPG 가 인격을 소유할 수 없다.
  assert.equal(isPersonaOwnedByProfile({ adapterType: "hermes" }), true);
});

test("게이트웨이의 기존 에이전트를 고르면 어댑터와 무관하게 프로필 소유다", () => {
  assert.equal(
    isPersonaOwnedByProfile({ adapterType: "claude", existingAgentSelected: true }),
    true,
  );
});

test("CLI 어댑터는 DeskRPG 가 인격을 소유한다", () => {
  // claude/codex 등 CLI 어댑터는 프로필 SOUL.md 개념이 없다 — 편집 칸을 연다.
  for (const t of ["claude", "codex", "gemini", "opencode"]) {
    assert.equal(isPersonaOwnedByProfile({ adapterType: t }), false, t);
  }
});

test("어댑터가 비어 있으면 편집을 막지 않는다", () => {
  assert.equal(isPersonaOwnedByProfile({ adapterType: null }), false);
  assert.equal(isPersonaOwnedByProfile({ adapterType: undefined }), false);
});
