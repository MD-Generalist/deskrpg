/**
 * 이 NPC 의 인격을 **누가 소유하는가** 를 판정한다.
 *
 * Hermes 에 붙은 NPC 의 인격은 프로필의 SOUL.md 가 소유한다. DeskRPG 는 그것을
 * 바꿀 수 없다 — `instructions` 는 기존 시스템 프롬프트를 대체하지 못하고 뒤에
 * 덧붙기만 하며(`agent/conversation_loop.py` 의 `effective + "\n\n" + ephemeral`),
 * SOUL.md 로드를 끄는 스위치는 HTTP 표면에 없다.
 *
 * 그래서 편집 칸을 열어 두면 **화면이 거짓말을 한다** — 사용자는 성격을 쓰고
 * 저장까지 확인하지만 NPC 는 그것을 읽은 적이 없다. 소유자가 프로필이면 입력
 * 대신 "게이트웨이가 관리합니다" 를 보여준다.
 */
export function isPersonaOwnedByProfile(input: {
  adapterType: string | null | undefined;
  /** 게이트웨이에 이미 있는 에이전트를 고른 경우 (레거시 경로). */
  existingAgentSelected?: boolean;
}): boolean {
  if (input.existingAgentSelected) return true;
  return input.adapterType === "hermes";
}
