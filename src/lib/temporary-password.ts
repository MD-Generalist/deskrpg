import { randomBytes } from "node:crypto";

/**
 * 서버 전용이다 — `node:crypto` 를 끌고 온다. `security-policy.ts` 옆에 두지 않는 이유는
 * `invite-code.ts` 와 같다: 그 파일은 `"use client"` 페이지가 상수 때문에 import 한다.
 *
 * 관리자·CLI 가 발급하는 임시 비밀번호다. 평문은 발급 응답에 한 번 실릴 뿐,
 * 저장도 기록도 하지 않는다.
 */
export function generateTemporaryPassword(): string {
  // base64url 16바이트 = 22자. 계정 최소 길이(8자)를 넉넉히 넘는다.
  return randomBytes(16).toString("base64url");
}
