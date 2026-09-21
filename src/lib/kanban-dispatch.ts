import type { KanbanChannelContext } from "@/lib/kanban-access";

/**
 * R9. 카드를 만들거나 실행 가능한 상태로 바꾼 직후 디스패치를 한 번 요청한다. 실패는 무시한다 —
 * 응답 경로에 섞지 않고, 게이트웨이 내장 디스패처의 다음 주기·다음 폴링이 이어받는다.
 * 부르지 않으면 카드가 그 주기만큼 ready 에 머문다.
 */
export async function dispatchOnce(ctx: Pick<KanbanChannelContext, "client" | "boardSlug">) {
  try {
    await ctx.client.kanban.dispatch(ctx.boardSlug);
  } catch {
    // 위 주석 참고.
  }
}
