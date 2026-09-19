/**
 * API 키 입력칸에 공통으로 붙이는 속성 — 비밀번호 관리자가 이 칸을 "로그인" 으로 보지 않게 한다.
 *
 * `type="password"` 에 `autoComplete="off"` 만 두면 Bitwarden·1Password·Chrome 이 폼 제출을 로그인으로
 * 보고 "로그인 정보 저장/업데이트" 를 띄운다(2026-09-19 스테이징 실측 — 수락하면 이 사이트 비밀번호가 API
 * 키로 덮인다). `new-password` 는 저장 제안 대상에서 빠지게 하는 표준 힌트이고, 나머지는 관리자별 무시 표시다.
 */
export const SECRET_INPUT_PROPS = {
  type: "password",
  autoComplete: "new-password",
  spellCheck: false,
  "data-bwignore": "true",
  "data-1p-ignore": "true",
  "data-lpignore": "true",
  "data-form-type": "other",
} as const;
