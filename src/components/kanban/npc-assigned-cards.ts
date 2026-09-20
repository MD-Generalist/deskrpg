import type { KanbanBoard, KanbanTask } from "@/lib/hermes/deskrpg-plugin-types";

/** 상태 묶음 순서 — 작을수록 앞. */
function rank(status: string): number {
  if (status === "in_progress") return 0;
  if (status === "done") return 2;
  return 1;
}

/** 보드에서 이 프로필이 담당인 카드만, 진행 중 → 대기 → 완료 · 각 묶음 최신순으로. */
export function assignedCards(board: KanbanBoard, npcProfile: string): KanbanTask[] {
  const mine = board.columns.flatMap((c) => c.tasks).filter((t) => t.assignee === npcProfile);
  return mine.sort((a, b) => {
    const byRank = rank(a.status) - rank(b.status);
    if (byRank !== 0) return byRank;
    return (b.created_at ?? "").localeCompare(a.created_at ?? "");
  });
}
