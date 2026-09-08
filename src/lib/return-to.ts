/**
 * 같은 오리진의 경로만 통과시킨다. 열린 리다이렉트를 막는다.
 *
 * `//evil.com` 과 `/\evil.com` 은 브라우저가 **프로토콜 상대 URL** 로 읽는다 —
 * 첫 글자가 `/` 라는 것만 보고 통과시키면 남의 사이트로 나간다. 개행이 섞인 값은
 * 헤더로 나갈 때 응답을 쪼갤 수 있으므로 함께 막는다.
 *
 * 탭(U+0009)도 같이 막는다. 브라우저의 URL 파서는 탭·개행을 URL 에서 **제거하므로**,
 * `/\t/evil.com` 은 앞의 세 검사를 전부 통과하고도 `//evil.com` 으로 읽힌다.
 * 마지막 줄은 그 계열 전체에 대한 벨트-앤-브레이스다: 실제 URL 파서에 넣어
 * 오리진이 그대로인지 본다.
 */
export function safeReturnTo(value: string | null | undefined, fallback = "/channels"): string {
  if (!value) return fallback;
  if (!value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return fallback;
  if (/[\r\n\t]/.test(value)) return fallback;
  try {
    if (new URL(value, "http://x").origin !== "http://x") return fallback;
  } catch {
    return fallback;
  }
  return value;
}
