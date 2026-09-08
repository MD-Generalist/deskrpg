/**
 * 같은 오리진의 경로만 통과시킨다. 열린 리다이렉트를 막는다.
 *
 * `//evil.com` 과 `/\evil.com` 은 브라우저가 **프로토콜 상대 URL** 로 읽는다 —
 * 첫 글자가 `/` 라는 것만 보고 통과시키면 남의 사이트로 나간다. 개행이 섞인 값은
 * 헤더로 나갈 때 응답을 쪼갤 수 있으므로 함께 막는다.
 */
export function safeReturnTo(value: string | null | undefined, fallback = "/channels"): string {
  if (!value) return fallback;
  if (!value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return fallback;
  if (/[\r\n]/.test(value)) return fallback;
  return value;
}
