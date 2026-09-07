// 클라이언트와 서버가 함께 쓰는 순수 정책 값이다.
// **`node:crypto` 같은 서버 전용 모듈을 여기서 import 하지 않는다** —
// `"use client"` 페이지가 이 파일의 상수를 가져가므로 곧바로 클라이언트 번들에 실린다.
// 난수가 필요한 것은 `invite-code.ts` 에 있다.

export const ACCOUNT_PASSWORD_MIN_LENGTH = 8;
export const CHANNEL_PASSWORD_MIN_LENGTH = 8;

export function isAccountPasswordValid(password: string): boolean {
  return password.length >= ACCOUNT_PASSWORD_MIN_LENGTH;
}

export function isChannelPasswordValid(password: string): boolean {
  return password.length >= CHANNEL_PASSWORD_MIN_LENGTH;
}
