/**
 * "이 카드를 펴라" 를 칸반 모달의 두 prop 중 맞는 쪽으로 보낸다.
 *
 * `initialTaskId` 는 마운트 때만 읽히므로(`KanbanBoardModal.tsx:45`) 이미 열린 보드에는
 * 닿지 않는다 — 그때는 `focusRequest` 의 `seq` 를 올려야 선택이 옮겨진다(같은 파일 52줄 주석).
 * 그래서 누를 당시 보드가 열려 있었는지로 갈라 둔다.
 */

import { nextKanbanFocus, type KanbanFocusRequest } from "@/app/game/artifact-entry";

export type OpenCardTarget = {
  initialTaskId: string | null;
  focusRequest: KanbanFocusRequest | null;
};

export function openCardTarget(input: {
  boardOpen: boolean;
  taskId: string;
  prev?: OpenCardTarget | null;
}): OpenCardTarget {
  if (!input.boardOpen) return { initialTaskId: input.taskId, focusRequest: null };
  return {
    initialTaskId: null,
    focusRequest: nextKanbanFocus(input.prev?.focusRequest ?? null, input.taskId),
  };
}
