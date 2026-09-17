/**
 * Hermes 대시보드에서 **그 프로필로** 로그인하는 화면 주소.
 *
 * Hermes 는 NPC(프로필)마다 로그인한다 — 업스트림 #111724 부터 프로필은 default 의 `auth.json` 을
 * 물려받지 않는다. 대시보드는 `?profile=<이름>` 으로 관리 대상 프로필을 고르므로, Keys 화면(`/env`)에
 * 그 값을 실어 보내면 사용자가 상단 선택기를 따로 바꿀 필요가 없다.
 *
 * 클라이언트 컴포넌트가 import 한다 — 서버 전용 모듈에 의존하지 않는다.
 */
export function profileLoginUrl(
  dashboardUrl: string | null | undefined,
  profile: string,
): string | null {
  if (!dashboardUrl || !profile) return null;
  let url: URL;
  try {
    url = new URL(dashboardUrl);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const base = `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
  return `${base}/env?profile=${encodeURIComponent(profile)}`;
}
