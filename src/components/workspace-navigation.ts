/**
 * 사이드바 메뉴 — **온보딩 순서 그대로** 둔다: 내 캐릭터 → 연결 → 직원 → 사무실.
 *
 * 이 순서가 곧 신규 사용자가 밟는 길이다. **먼저 "나" 를 만든다**(캐릭터가 없으면 사무실 화면이
 * 캐릭터 화면으로 되돌려 보낸다 — `src/app/channels/page.tsx` 의 리다이렉트). 그 다음 Hermes
 * 게이트웨이를 연결하고, 직원을 만들어 그 직원으로 모델에 로그인하고, 마지막에 사무실을 만들어
 * 입주한다. 예전 메뉴는 순서가 흩어져 있었고 `내 캐릭터` 가 아예 없었다.
 *
 * `AI 제공자`(`/providers`)는 Hermes 이전 시절의 화면이라 뺐다 — Hermes 는 제공자 인증을
 * 프로필마다 자기 쪽에서 관리한다. 눌러도 이 제품의 흐름과 이어지지 않아 사용자를 잘못 이끈다.
 */
export type WorkspaceNavKey = "gateways" | "profiles" | "characters" | "channels";

export const WORKSPACE_NAV: ReadonlyArray<{ key: WorkspaceNavKey; href: string }> = [
  { key: "characters", href: "/characters" },
  { key: "gateways", href: "/gateways" },
  { key: "profiles", href: "/profiles" },
  { key: "channels", href: "/channels" },
];

/** 직원(Hermes 프로필) 화면 주소. 직원 관리는 `/profiles` 한 곳에서만 한다. */
export function employeesHref(
  gatewayId: string,
  options: { create?: boolean; returnTo?: string } = {},
): string {
  const params = new URLSearchParams({ gateway: gatewayId });
  if (options.returnTo) params.set("returnTo", options.returnTo);
  // 채용은 전용 페이지가 전담한다(docs/standards.md "1기능 1페이지").
  return `/profiles${options.create ? "/new" : ""}?${params.toString()}`;
}
