/**
 * 직원 대화창의 탭 상태 — 어느 NPC 의 선택인지 함께 기억한다.
 *
 * 다른 직원으로 바뀌면 `chat` 으로 돌아가는 것이 기존 동작이다. effect 로 되돌리지 않고
 * 렌더 중 파생하므로(`tabFor`), 한 프레임 동안 옛 직원의 탭이 보이는 일이 없다.
 */

export type NpcPanelTab = "chat" | "cron" | "cards";

export type NpcTabState = { npcId: string | null; tab: NpcPanelTab };

/** 저장된 선택이 지금 열린 직원의 것일 때만 쓴다 — 아니면 `chat`. */
export function tabFor(state: NpcTabState, dialogNpcId: string | null): NpcPanelTab {
  return state.npcId === dialogNpcId ? state.tab : "chat";
}
