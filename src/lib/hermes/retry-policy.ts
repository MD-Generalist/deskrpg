/**
 * 게이트웨이가 "지금은 못 받는다" 고 말할 때의 대응 규칙.
 *
 * Hermes 는 동시 실행 상한(`gateway.api_server.max_concurrent_runs`)을 넘긴 요청을
 * 조용히 버리지 않는다 — `429` + `Retry-After` + `code: rate_limit_exceeded` 로
 * 거절한다(`api_server.py:7154-7182`). 상한은 **모든 에이전트 구동 엔드포인트가
 * 공유**하므로, 회의처럼 N 명에게 동시에 쏘는 쪽이 정면으로 걸린다.
 *
 * 클라이언트 쪽 상한을 게이트웨이 설정에 맞추는 방법도 있지만 그것만으로는 부족하다 —
 * 같은 게이트웨이를 쓰는 다른 클라이언트가 있으면 여전히 429 가 난다. 값을 흉내 내는
 * 것보다 **거절을 제대로 다루는 것**이 근본이다.
 */

/** 잠깐 기다렸다 다시 걸면 성공할 수 있는 상태인가. */
export function shouldRetryStatus(status: number): boolean {
  // 429 만이다. 503 은 게이트웨이가 스스로 못 받는 상태라 되풀이해도 같은 답이 오고,
  // 4xx 는 요청 자체가 틀렸다는 뜻이다.
  return status === 429;
}

/** 회의 한 턴을 붙들어 둘 수 있는 최대 대기. 이보다 길면 사용자는 멈춘 것으로 본다. */
const MAX_RETRY_WAIT_MS = 10_000;

/**
 * `Retry-After` 헤더(초 단위)를 밀리초로 읽는다. 없거나 해석할 수 없으면 `null` —
 * 호출부는 그때 자체 백오프를 쓴다.
 */
export function parseRetryAfterMs(header: string | null | undefined): number | null {
  if (header == null) return null;
  const trimmed = header.trim();
  if (!trimmed) return null;
  const seconds = Number(trimmed);
  if (!Number.isFinite(seconds) || seconds < 0) return null;
  return Math.min(seconds * 1000, MAX_RETRY_WAIT_MS);
}

/**
 * 이번 시도에서 기다릴 시간.
 *
 * 서버가 알려준 값이 우리 추측을 이긴다 — 게이트웨이는 자기 부하를 알고 우리는 모른다.
 */
export function retryDelayMs(attempt: number, retryAfterMs: number | null): number {
  if (retryAfterMs !== null) return retryAfterMs;
  return Math.min(500 * 2 ** attempt, MAX_RETRY_WAIT_MS);
}
