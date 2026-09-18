/**
 * 맵 배치가 보내는 요청. `GamePageClient` 는 node 에서 렌더할 수 없으므로 본문을
 * 여기서 만들고 테스트한다.
 *
 * 본문에 자리 말고 다른 필드를 실으면 라우트가 400 `unsupported_npc_field` 로
 * 거절한다 — 예전 배치 경로는 이름·페르소나·외형까지 함께 보냈고(그때는 NPC 를
 * 생성했다), 그 필드들은 이제 Hermes 프로필이 정본이다.
 */
export function buildPlacementRequest(
  npcId: string,
  col: number,
  row: number,
): { url: string; init: RequestInit } {
  return {
    url: `/api/npcs/${encodeURIComponent(npcId)}`,
    init: {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ positionX: col, positionY: row }),
    },
  };
}

/**
 * 배치 후 다른 플레이어에게 무엇을 보낼지.
 *
 * 자리 **이동** 일 때 `npc:broadcast-add` 만 보내면 다른 화면은 옛 칸에 그대로 서 있다 —
 * 받는 쪽 `npc:added` 는 `if (this.npcSprites.some(n => n.id === id)) return;` 로
 * 이미 있는 NPC 를 무시하기 때문이다(OfficeSimulation.addNpc). 그래서 이동은 먼저 빼고 다시 넣는다.
 * 첫 배치는 뺄 것이 없으므로 add 하나뿐이다.
 */
export type PlacementBroadcastStep = "remove" | "add";

export function placementBroadcastPlan(prevPlaced: boolean): PlacementBroadcastStep[] {
  return prevPlaced ? ["remove", "add"] : ["add"];
}

/**
 * 배치 요청 응답 상태 → 배치 모드를 유지할 것인가.
 *
 * 409 는 "그 칸에 이미 다른 직원이 있다" 다. 사용자는 다른 칸을 찍으면 되므로 배치
 * 모드를 유지한다. 예전에는 주석만 그렇게 적혀 있고 `return` 이 `finally` 의
 * 정리(setPlacementMode(false))를 건너뛰지 못해, 칸을 찍으면 아무 일도 안 일어난
 * 채 배치 모드만 사라졌다 — 이 브랜치가 없애려던 조용한 실패의 전형이다.
 */
export function keepsPlacementMode(status: number): boolean {
  return status === 409;
}
