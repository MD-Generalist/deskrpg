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
