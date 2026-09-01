/**
 * 프로필 스코프 호출에 쓸 토큰을 고른다.
 *
 * **default 키로 폴백하지 않는다.** 프로필 스코프 경로(`/p/{name}/...`)에
 * default 키를 보내면 Hermes 가 fail-closed 로 401 을 낸다. 그러면 화면에
 * "토큰이 틀렸습니다" 가 뜨는데, 진짜 원인은 "이 프로필이 DeskRPG 에 등록되지
 * 않았다" 이다 — 사용자가 영원히 못 고칠 진단이 된다.
 */

export type ProfileTokenResult =
  { ok: true; profileToken: string } | { ok: false; reason: "no_profile" };

export function selectProfileToken(input: {
  rows: Array<{ profileName: string; tokenEncrypted: string }>;
  profileName: string;
  decrypt: (payload: string) => string;
}): ProfileTokenResult {
  const row = input.rows.find((r) => r.profileName === input.profileName);
  if (!row) return { ok: false, reason: "no_profile" };
  try {
    return { ok: true, profileToken: input.decrypt(row.tokenEncrypted) };
  } catch {
    // 키가 바뀌었거나 레코드가 손상됐다. 던지면 500 이 나가고 진단이 사라진다.
    return { ok: false, reason: "no_profile" };
  }
}
