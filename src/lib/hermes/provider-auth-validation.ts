/**
 * 프로바이더 인증 프록시 라우트(키 PUT/DELETE, OAuth start/poll/cancel/disconnect)의
 * 입력 검증. 형식의 정본은 플러그인이다 — 여기서는 경로에 실어 보내도 안전한지와
 * 본문 모양만 본다.
 *
 * 오류 결과에는 입력 값을 절대 싣지 않는다(키 값이 응답·로그로 새지 않게).
 */

const AUTH_SEGMENT_RE = /^[A-Za-z0-9_.-]{1,128}$/;
// encodeURIComponent 는 "." 을 이스케이프하지 않는다. "." / ".." 가 그대로 경로에
// 실리면 URL 정규화로 `/p/{name}/deskrpg/...` 의 스코프가 접힌다 — 점만으로 된
// 세그먼트는 정규식이 허용해도 거절한다.
const DOTS_ONLY_RE = /^\.+$/;

export const PROVIDER_KEY_MAX_LENGTH = 1024;

/** provider·sessionId 경로 세그먼트 검증. */
export function validateAuthSegment(value: string): boolean {
  return typeof value === "string" && AUTH_SEGMENT_RE.test(value) && !DOTS_ONLY_RE.test(value);
}

export type KeyBodyResult = { ok: true; value: string } | { ok: false; errorCode: "bad_request" };

/** 키 PUT 본문 `{ value: string }`(1~1024자)만 받는다. */
export function validateKeyBody(input: unknown): KeyBodyResult {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return { ok: false, errorCode: "bad_request" };
  }
  const value = (input as { value?: unknown }).value;
  if (typeof value !== "string" || value.length < 1 || value.length > PROVIDER_KEY_MAX_LENGTH) {
    return { ok: false, errorCode: "bad_request" };
  }
  return { ok: true, value };
}

// 0.10.0 — 도구 프로바이더 선택 본문. 키 이름은 플러그인이 그 행의 것만 받는다(여기서는 모양만).
const ENV_KEY_RE = /^[A-Z][A-Z0-9_]{0,127}$/;
const PROVIDER_NAME_MAX = 128;
const ENV_ENTRIES_MAX = 16;

export type ToolProviderBodyResult =
  | { ok: true; provider: string; env: Record<string, string> }
  | { ok: false; errorCode: "bad_request" };

/** `{ provider: string, env?: { KEY: string } }` 만 받는다. 값은 오류에 싣지 않는다. */
export function validateToolProviderBody(input: unknown): ToolProviderBodyResult {
  const bad = { ok: false, errorCode: "bad_request" } as const;
  if (typeof input !== "object" || input === null || Array.isArray(input)) return bad;
  const { provider, env } = input as { provider?: unknown; env?: unknown };
  if (
    typeof provider !== "string" ||
    provider.trim() === "" ||
    provider.length > PROVIDER_NAME_MAX
  ) {
    return bad;
  }
  const out: Record<string, string> = {};
  if (env !== undefined && env !== null) {
    if (typeof env !== "object" || Array.isArray(env)) return bad;
    const entries = Object.entries(env as Record<string, unknown>);
    if (entries.length > ENV_ENTRIES_MAX) return bad;
    for (const [key, value] of entries) {
      if (!ENV_KEY_RE.test(key)) return bad;
      if (typeof value !== "string" || value.length > PROVIDER_KEY_MAX_LENGTH) return bad;
      out[key] = value;
    }
  }
  return { ok: true, provider, env: out };
}
