/**
 * "곁에 와서 기다리는 NPC 를 언제 자리로 돌려보내나" 의 순수 판정.
 *
 * 컨텍스트 메뉴로 부른 NPC(`direct`)는 1:1 대화창이 없으면 잠시 뒤 돌아간다 — 원래 규칙.
 * 맵 채팅으로 지명돼 온 NPC(`map-chat`)는 **채널 채팅 패널이 보이는 동안** 머문다.
 * 예전엔 `dialogOpen` 만 봐서, 그룹 채팅 중에도 10초면 돌아가 버렸다.
 */
export type CalledBy = "direct" | "map-chat";

export type ReturnCandidate = {
  moveState: "idle" | "moving-to-player" | "waiting" | "returning";
  calledBy: CalledBy;
};

export type ReturnContext = { dialogOpen: boolean; channelChatVisible: boolean };

/** 대기 타이머를 굴려 시간이 차면 돌려보낼 대상인가. */
export function shouldAutoReturn(npc: ReturnCandidate, ctx: ReturnContext): boolean {
  if (npc.moveState !== "waiting") return false;
  if (ctx.dialogOpen) return false;
  if (npc.calledBy === "map-chat" && ctx.channelChatVisible) return false;
  return true;
}

/** 채널 채팅이 닫히는 순간 타이머 없이 바로 돌려보낼 대상인가. */
export function shouldReturnOnChatClose(npc: ReturnCandidate): boolean {
  return npc.moveState === "waiting" && npc.calledBy === "map-chat";
}
