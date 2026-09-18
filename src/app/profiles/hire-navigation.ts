/**
 * 채용(마법사) 화면의 주소 계산 — **마법사는 `/profiles/new` 한 페이지가 전담한다.**
 *
 * 예전에는 직원 목록 안에서 4단계 마법사가 펼쳐져, 한 화면이 목록·생성·인격 편집·모델 설정을
 * 동시에 담았다(`docs/standards.md` 의 "1기능 1페이지" 위반). 목록은 링크만 갖는다.
 */
export function hirePageHref(
  gatewayId: string,
  options: { returnTo?: string | null; profile?: string | null } = {},
): string {
  const params = new URLSearchParams({ gateway: gatewayId });
  // 기존 직원의 인격을 이어서 편집하는 경로. 직원 상세 페이지가 생기면 그쪽으로 옮긴다.
  if (options.profile) params.set("profile", options.profile);
  if (options.returnTo) params.set("returnTo", options.returnTo);
  return `/profiles/new?${params.toString()}`;
}

/**
 * 마법사를 닫았을 때 어디로 돌아갈지.
 *
 * 게임 화면의 "새 직원" 으로 들어왔으면 그 자리로 돌려보내고 자리 지정까지 잇는다
 * (`assignSeat=1`). 그 외에는 직원 목록으로 돌아간다 — 방금 만든 직원이 보이는 곳이다.
 */
export function hireDoneHref(gatewayId: string, returnTo?: string | null): string {
  if (returnTo) return `${returnTo}${returnTo.includes("?") ? "&" : "?"}assignSeat=1`;
  return `/profiles?gateway=${encodeURIComponent(gatewayId)}`;
}

/**
 * 직원 상세 화면 — 그 직원 하나를 고치는 곳(인격·외형·모델·계정·삭제).
 *
 * 프로필 이름은 게이트웨이 안에서 고유하므로 이름을 경로에, 게이트웨이를 쿼리에 싣는다.
 */
export function employeeDetailHref(gatewayId: string, profileName: string): string {
  return `/profiles/${encodeURIComponent(profileName)}?gateway=${encodeURIComponent(gatewayId)}`;
}
