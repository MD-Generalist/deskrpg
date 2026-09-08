/** 게이트웨이의 프로필들이 데리고 있는 것들. `sumGatewayUsage` 가 합산해 준다. */
export type GatewayUsage = { profiles: number; npcs: number; channels: number };

/**
 * 삭제 확인을 띄우기 전에 무엇을 물을지 정한다.
 *
 * 서버(`api/gateways/[id]` DELETE)는 채널 바인딩이 하나라도 있으면 409
 * `gateway_in_use_by_channels` 로 **거절한다**. 그런데도 "프로필과 NPC 자리가 함께
 * 사라집니다" 를 묻고 있으면, 사용자는 일어나지 않을 삭제에 동의한 뒤 아무 일도
 * 없는 화면을 보게 된다 — 이 태스크가 없애려던 바로 그 부류의 거짓 확인이다.
 *
 * 그래서 채널에 나가 있는 자리가 하나라도 있으면 확인 자체를 띄우지 않고, 먼저
 * 연결을 풀라고 말한다.
 */
export function planGatewayDelete(
  usage: GatewayUsage,
): { blocked: true } | { blocked: false; profiles: number; npcs: number } {
  if (usage.channels > 0) return { blocked: true };
  return { blocked: false, profiles: usage.profiles, npcs: usage.npcs };
}
