// NPC 를 클릭했을 때 무엇을 할지 정한다.
//
// 예전에는 "걸어가서 도착하면 대화한다" 하나뿐이었다. 그래서 이미 NPC 옆에 서 있으면
// 경로가 서지 않고(길이 0~1), 도착 이벤트도 오지 않아 아무 일도 일어나지 않았다 —
// 클릭은 먹었는데 화면은 선택 표시만 바뀌는, 사용자가 원인을 알 수 없는 무반응이다.
//
// 게다가 그 경우에도 `targetNpcId` 는 남아 있어서, 나중에 다른 곳으로 걸어가 도착하는
// 순간 엉뚱한 NPC 와의 대화가 열렸다.
export type NpcClickIntent =
  | "interact-now" // 이미 닿아 있다 — 그 자리에서 대화를 연다
  | "walk-then-interact" // 걸어간 뒤 도착 시점에 대화를 연다
  | "walk-only"; // NPC 를 클릭한 게 아니다 — 이동만 한다

/**
 * @param pathLength 계산된 경로의 길이. 시작 타일을 포함하므로 1 이하는 "움직일 필요 없음"이다.
 * @param clickedNpcId 클릭 지점에 NPC 가 있으면 그 id, 없으면 null.
 */
export function decideNpcClick(input: {
  pathLength: number;
  clickedNpcId: string | null;
}): NpcClickIntent {
  if (!input.clickedNpcId) return "walk-only";
  return input.pathLength > 1 ? "walk-then-interact" : "interact-now";
}

/** 도착 대기를 걸어 둘 때만 목표를 기억한다. 그러지 않으면 오염된 목표가 남는다. */
export function shouldRememberTarget(intent: NpcClickIntent): boolean {
  return intent === "walk-then-interact";
}
