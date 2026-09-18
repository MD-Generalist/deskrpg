/**
 * 사이드바 메뉴 — **온보딩 순서 그대로** 둔다: 연결 → 직원 → 내 캐릭터 → 사무실.
 *
 * 이 순서가 곧 신규 사용자가 밟는 길이다(게이트웨이를 연결하고, 직원을 만들어 그 직원으로
 * 로그인하고, 내 캐릭터를 만들고, 사무실을 만들어 들어간다). 예전 메뉴는 순서가 흩어져 있었고
 * `내 캐릭터` 가 아예 없어서 `/channels` 가 되돌려 보낼 때만 만날 수 있었다.
 *
 * `AI 제공자`(`/providers`)는 Hermes 이전 시절의 화면이라 뺐다 — Hermes 는 제공자 인증을
 * 프로필마다 자기 쪽에서 관리한다. 눌러도 이 제품의 흐름과 이어지지 않아 사용자를 잘못 이끈다.
 */
export type WorkspaceNavKey = "gateways" | "profiles" | "characters" | "channels";

export const WORKSPACE_NAV: ReadonlyArray<{ key: WorkspaceNavKey; href: string }> = [
  { key: "gateways", href: "/gateways" },
  { key: "profiles", href: "/profiles" },
  { key: "characters", href: "/characters" },
  { key: "channels", href: "/channels" },
];

/** 직원(Hermes 프로필) 화면 주소. 직원 관리는 `/profiles` 한 곳에서만 한다. */
export function employeesHref(
  gatewayId: string,
  options: { create?: boolean; returnTo?: string } = {},
): string {
  const params = new URLSearchParams({ gateway: gatewayId });
  if (options.create) params.set("new", "1");
  if (options.returnTo) params.set("returnTo", options.returnTo);
  return `/profiles?${params.toString()}`;
}
