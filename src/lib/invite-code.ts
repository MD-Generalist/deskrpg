import { randomBytes } from "node:crypto";

/**
 * 서버 전용이다 — `node:crypto` 를 끌고 온다.
 *
 * `security-policy.ts` 에서 떼어 냈다. 거기엔 `"use client"` 페이지가 상수 하나 때문에
 * import 하는 값들이 있는데, 같은 파일에 이 함수가 있으면 클라이언트 번들이
 * `node:crypto` 를 참조하게 된다. 지금은 번들러가 미사용 import 를 떨어내 주지만,
 * 같은 부류로 이미 한 번 화면이 백지가 된 적이 있다(`plugin-capability.ts` 가 `@/db` 를
 * 물고 들어가 pg·better-sqlite3 가 브라우저로 갔다). 우연에 기대지 않는다.
 */
export function generateChannelInviteCode(): string {
  return randomBytes(12).toString("base64url");
}
