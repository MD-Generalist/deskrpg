import type { KanbanBoard, KanbanTask, KanbanTaskStatus } from "@/lib/hermes/deskrpg-plugin-types";
import { taskTimeMs } from "@/lib/plugin-time";

/**
 * 상태 묶음 순서 — 작을수록 앞. 어휘는 `KANBAN_TASK_STATUSES` 다(`in_progress` 같은 상태는
 * 없다 — 진행 중은 `running`). 스펙이 말한 것은 "진행 중 → 대기 → 완료" 뿐이라
 * `blocked` 는 나머지와 함께 둔다.
 */
function rank(status: KanbanTaskStatus): number {
  if (status === "running") return 0;
  if (status === "done") return 2;
  if (status === "archived") return 3;
  return 1;
}

/** 보드에서 이 프로필이 담당인 카드만, 진행 중 → 나머지 → 완료 → 보관 · 각 묶음 최신순으로. */
export function assignedCards(board: KanbanBoard, npcProfile: string): KanbanTask[] {
  const mine = board.columns.flatMap((c) => c.tasks).filter((t) => t.assignee === npcProfile);
  return mine.sort((a, b) => {
    const byRank = rank(a.status) - rank(b.status);
    if (byRank !== 0) return byRank;
    // 칸반 시각은 epoch 초이거나 ISO 문자열이다 — 문자열 비교를 하지 않고 `taskTimeMs` 로만 읽는다.
    return (taskTimeMs(b.created_at) ?? 0) - (taskTimeMs(a.created_at) ?? 0);
  });
}
