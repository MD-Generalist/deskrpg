/**
 * 게이트웨이 목록을 다시 불러온 뒤 무엇을 선택할지 정한다.
 *
 * 빈 선택은 "연결 마법사를 보여 준다" 는 뜻이다. 마법사가 주소 연결을 막 저장한 직후
 * 목록만 새로 고칠 때는 `autoSelect: false` 로 부른다 — 그러지 않으면 새 게이트웨이가
 * 자동 선택되면서 마법사와 그 안의 플러그인 설치 안내가 사라진다.
 */
export function nextSelectedGatewayId(
  current: string,
  gateways: ReadonlyArray<{ id: string }>,
  options: { autoSelect?: boolean } = {},
): string {
  if (current && gateways.some((gateway) => gateway.id === current)) return current;
  if (options.autoSelect === false) return "";
  return gateways[0]?.id ?? "";
}
