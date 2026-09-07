/**
 * **새 Hermes 프로필을 생성**할 때만 쓰는 엄격한 이름 문법.
 *
 * 이 파일과 `profile-name.ts`(`PROFILE_NAME_RE`)는 서로 다른 흐름을 위한 서로 다른
 * 검증기다 — 혼동하면 안 된다:
 *
 *   - `profile-name.ts` (관대) — **이미 존재하는** 프로필을 발견·등록할 때 쓴다.
 *     과거 Hermes 가 허용했던 대문자·마침표 이름이 디스크에 이미 있을 수 있어서,
 *     여기를 조이면 그런 기존 프로필이 등록 화면에서 조용히 거부당한다.
 *   - `creatable-profile-name.ts` (이 파일, 엄격) — **새로** 만들 이름을 검증한다.
 *     Hermes 서버가 실제로 받아줄 이름이어야 하므로, 서버가 요구하는 문법을
 *     그대로 따른다.
 *
 * 정규식·예약어 출처(리뷰 라운드 1에서 서버 소스 실측):
 *   hermes_cli/profiles.py:51   _PROFILE_ID_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{0,63}$")
 *   hermes_cli/profiles.py:265  _RESERVED_NAMES = {hermes, test, tmp, root, sudo}  ← 거부
 *                               ("default" 는 서버에서 특례 통과하지만, 우리는 그 이름으로
 *                                새로 만들 일이 없으므로 여기서는 예약어와 함께 거부한다.)
 */

export const CREATABLE_PROFILE_NAME_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;

export const RESERVED_PROFILE_NAMES: ReadonlySet<string> = new Set([
  "hermes",
  "test",
  "tmp",
  "root",
  "sudo",
]);

export function isCreatableProfileName(name: string): boolean {
  if (name === "default") return false;
  if (RESERVED_PROFILE_NAMES.has(name)) return false;
  return CREATABLE_PROFILE_NAME_RE.test(name);
}
