/**
 * "곁에 와서 기다리는 NPC 를 언제 자리로 돌려보내나" 의 순수 판정.
 *
 * 직접 부른 NPC(`calledForRoom=null`)는 1:1 대화창이 없으면 잠시 뒤 돌아간다 — 원래 규칙.
 * 방에서 지명돼 온 NPC(`calledForRoom="r1"`)는 **그 방이 보이는 동안** 머문다.
 * 방이 바뀌면 타이머 없이 바로 돌려보낸다.
 */

export type ReturnCandidate = {
  moveState: "idle" | "moving-to-player" | "waiting" | "returning" | "strolling";
  calledForRoom: string | null;
};

export type ReturnContext = { dialogOpen: boolean; visibleRoomId: string | null };

/** 대기 타이머를 굴려 시간이 차면 돌려보낼 대상인가. */
export function shouldAutoReturn(npc: ReturnCandidate, ctx: ReturnContext): boolean {
  if (npc.moveState !== "waiting") return false;
  if (ctx.dialogOpen) return false;
  if (npc.calledForRoom && npc.calledForRoom === ctx.visibleRoomId) return false;
  return true;
}

/** 보이는 방이 바뀌는 순간 타이머 없이 바로 돌려보낼 대상인가. */
export function shouldReturnOnRoomChange(
  npc: ReturnCandidate,
  visibleRoomId: string | null,
): boolean {
  return (
    npc.moveState === "waiting" && npc.calledForRoom !== null && npc.calledForRoom !== visibleRoomId
  );
}
