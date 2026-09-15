import type { HermesErrorCode } from "./hermes-client";

/**
 * 어댑터 호출이 던진 예외를 **사용자에게 보여줄 원인**으로 접는다.
 *
 * 예전에는 게이트웨이가 꺼졌든, 키가 거부됐든, 30분째 응답이 없든 화면에는 언제나
 * "AI 게이트웨이 오류" 한 줄만 나왔다. 실제 원인은 서버 콘솔에만 남아서, 자기 서버를
 * 직접 호스팅하는 사용자조차 무엇을 고쳐야 하는지 알 수 없었다.
 *
 * 판정 순서가 곧 규칙이다:
 *   1. **중단/타임아웃 먼저.** `HermesClient.request` 는 `fetch` 가 던진 것을 전부
 *      `HermesError("unreachable")` 로 싸기 때문에(hermes-client.ts:93-97), 취소·타임아웃도
 *      "못 닿았다" 로 도착한다. 코드만 보면 타임아웃을 영원히 도달 불가로 오진한다.
 *   2. **구조화된 코드**(`HermesError.code`). 문자열 매칭보다 언제나 우선한다.
 *   3. 마지막에만 메시지/`cause.code` 휴리스틱 — 어댑터가 `HermesError` 가 아닌 것을
 *      던지는 경로(플러그인 클라이언트·원시 `fetch`)가 있어서 필요하다.
 */
export type GatewayFailureKind = "unreachable" | "auth" | "timeout" | "unknown";

/** `HermesError` 를 구조로 알아본다 — 클래스를 import 하면 전송 계층까지 딸려 온다. */
function hermesCode(err: unknown): HermesErrorCode | null {
  if (typeof err !== "object" || err === null) return null;
  const record = err as { name?: unknown; code?: unknown };
  if (record.name !== "HermesError") return null;
  return typeof record.code === "string" ? (record.code as HermesErrorCode) : null;
}

/** `TypeError: fetch failed` 는 진짜 원인을 `cause.code`(ECONNREFUSED 등)에 숨긴다. */
function causeCode(err: unknown): string {
  if (typeof err !== "object" || err === null) return "";
  const cause = (err as { cause?: unknown }).cause;
  if (typeof cause !== "object" || cause === null) return "";
  const code = (cause as { code?: unknown }).code;
  return typeof code === "string" ? code.toUpperCase() : "";
}

function errorName(err: unknown): string {
  if (typeof err !== "object" || err === null) return "";
  const name = (err as { name?: unknown }).name;
  return typeof name === "string" ? name : "";
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  return "";
}

const TIMEOUT_CAUSE_CODES = new Set([
  "ETIMEDOUT",
  "ESOCKETTIMEDOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_BODY_TIMEOUT",
  "UND_ERR_CONNECT_TIMEOUT",
]);

const UNREACHABLE_CAUSE_CODES = new Set([
  "ECONNREFUSED",
  "ENOTFOUND",
  "EAI_AGAIN",
  "ECONNRESET",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "EPIPE",
  "UND_ERR_SOCKET",
]);

const TIMEOUT_MESSAGE_RE = /\b(timed? ?out|timeout|aborted|abort)\b/i;
const AUTH_MESSAGE_RE =
  /\b(unauthorized|forbidden|invalid[ _-]?(api[ _-]?)?key|auth(entication|orization)?[ _-]?(failed|error))\b/i;
const UNREACHABLE_MESSAGE_RE =
  /\b(fetch failed|econnrefused|enotfound|network|unreachable|connection refused)\b/i;

export function classifyGatewayFailure(err: unknown): GatewayFailureKind {
  const cause = causeCode(err);
  const name = errorName(err);
  const message = errorMessage(err);

  // 1. 중단·타임아웃 — 코드 판정보다 먼저다(모듈 주석 참조).
  if (name === "AbortError" || name === "TimeoutError") return "timeout";
  if (TIMEOUT_CAUSE_CODES.has(cause)) return "timeout";

  // 2. 구조화된 코드.
  const code = hermesCode(err);
  if (code === "unauthorized") return "auth";
  if (code === "unreachable") {
    if (TIMEOUT_MESSAGE_RE.test(message)) return "timeout";
    return "unreachable";
  }
  if (code === "unknown_profile" || code === "http_error" || code === "run_failed")
    return "unknown";

  // 3. 휴리스틱 — HermesError 가 아닌 예외 경로.
  if (UNREACHABLE_CAUSE_CODES.has(cause)) return "unreachable";
  if (AUTH_MESSAGE_RE.test(message)) return "auth";
  if (TIMEOUT_MESSAGE_RE.test(message)) return "timeout";
  if (UNREACHABLE_MESSAGE_RE.test(message)) return "unreachable";

  return "unknown";
}

/** 분류 결과를 `npc:response` 가 싣는 메시지 코드로 옮긴다. */
export const GATEWAY_FAILURE_MESSAGE_CODE = {
  unreachable: "gateway_unreachable",
  auth: "gateway_auth_failed",
  timeout: "gateway_timeout",
  unknown: "gateway_unknown_error",
} as const;

export type GatewayFailureMessageCode = (typeof GATEWAY_FAILURE_MESSAGE_CODE)[GatewayFailureKind];

export function gatewayFailureMessageCode(err: unknown): GatewayFailureMessageCode {
  return GATEWAY_FAILURE_MESSAGE_CODE[classifyGatewayFailure(err)];
}
