// 직원 호출(`npc:call`)이 거절됐을 때 사용자에게 보일 문구를 고른다.
//
// 서버는 거절 사유를 ack 로 돌려주지만(`npc-coordination.ts` 의 `handle`), 예전에는 받는
// 쪽이 없어 **클릭이 먹지 않은 것처럼** 보였다. 사유별 문구를 한곳에 모아 두어야
// 새 사유가 생겼을 때 조용히 빈 문자열이 나가지 않는다 — 아래 테스트가 그것을 지킨다.

/** 서버가 `npc:call` 에 돌려줄 수 있는 거절 사유. */
export const NPC_CALL_REJECTIONS = [
  "unknown_npc",
  "meeting_reserved",
  "already_claimed",
  "forbidden",
  "unavailable",
] as const;

export type NpcCallRejection = (typeof NPC_CALL_REJECTIONS)[number];

const MESSAGE_KEYS: Record<NpcCallRejection, string> = {
  unknown_npc: "game.npcCall.unknownNpc",
  meeting_reserved: "game.npcCall.meetingReserved",
  already_claimed: "game.npcCall.alreadyClaimed",
  forbidden: "game.npcCall.forbidden",
  unavailable: "game.npcCall.unavailable",
};

/**
 * 거절 사유 → 번역 키. 모르는 사유도 **문구가 없는 채로 두지 않는다** — 원인을 몰라도
 * "지금은 부를 수 없다" 는 사실은 알려야 반복 클릭을 멈춘다.
 */
export function npcCallErrorKey(error: unknown): string {
  return typeof error === "string" && error in MESSAGE_KEYS
    ? MESSAGE_KEYS[error as NpcCallRejection]
    : MESSAGE_KEYS.unavailable;
}

/** ack 가 성공을 말하는가. ack 자체가 오지 않은 경우(타임아웃)도 실패로 본다. */
export function isNpcCallRejected(result: unknown): boolean {
  return !(
    typeof result === "object" &&
    result !== null &&
    (result as { ok?: unknown }).ok === true
  );
}
