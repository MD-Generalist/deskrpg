import { safeReturnTo } from "@/lib/return-to";

/**
 * `?returnTo=` 를 화면이 쓸 수 있는 링크 대상으로 바꾼다.
 *
 * 값이 없으면 `null` — 돌아갈 곳이 없으면 링크 자체를 띄우지 않는다. 값이 있으면
 * `safeReturnTo` 를 반드시 통과시킨다. 이 한 줄을 page.tsx 안에 두면 렌더 없이는
 * 검증할 수 없어서, `//evil.com` 같은 값이 링크로 나가는지 아무도 못 본다.
 */
export function backLinkTarget(returnTo: string | null | undefined): string | null {
  return returnTo ? safeReturnTo(returnTo) : null;
}
