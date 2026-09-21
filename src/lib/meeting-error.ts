// 회의 중 NPC 응답 실패를 소켓으로 내보낼 모양으로 정규화한다.
// 브로커의 onError 는 어댑터가 던진 값을 그대로 넘기는데(HermesError·Error·임의 객체),
// 그것을 그대로 실으면 화면이 `회의: [object Object]` 를 그린다. 서버 경계에서 문자열 코드와
// 사람이 읽을 짧은 사유로 바꾸고, 클라이언트는 문자열이 아닌 값을 코드로 쓰지 않는다.
//
// 이 파일은 브라우저 번들에도 들어가므로 hermes-client 를 import 하지 않는다 — HermesError 는
// name·code·status 모양으로 알아본다.

export type MeetingFailureCode =
  | "backend_usage_limit"
  | "gateway_busy"
  | "backend_unavailable"
  | "backend_unauthorized"
  | "npc_response_failed";

export type MeetingFailure = { error: MeetingFailureCode; detail: string | null };

const DETAIL_MAX = 160;

// 모델 제공자의 계정·요금 한도. 게이트웨이 동시 실행 상한(HTTP 429)과는 사용자가 할 일이 다르다.
const USAGE_LIMIT = /\b429\b|usage limit|rate[ _-]?limit|quota|insufficient[ _]credits?/i;

function field(value: unknown, key: string): unknown {
  return value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)[key]
    : undefined;
}

function rawMessage(err: unknown): string | null {
  if (typeof err === "string") return err;
  const message = field(err, "message");
  if (typeof message === "string" && message) return message;
  return null;
}

function sanitize(text: string | null): string | null {
  if (!text) return null;
  const oneLine = text
    .replace(/\bBearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/\bsk-[A-Za-z0-9_-]{8,}/g, "[redacted]")
    .replace(/\s+/g, " ")
    .trim();
  if (!oneLine) return null;
  return oneLine.length > DETAIL_MAX ? `${oneLine.slice(0, DETAIL_MAX - 1)}…` : oneLine;
}

export function describeMeetingFailure(err: unknown): MeetingFailure {
  const detail = sanitize(rawMessage(err));
  const code = field(err, "code");
  const status = field(err, "status");

  let error: MeetingFailureCode = "npc_response_failed";
  if (code === "run_failed" && detail && USAGE_LIMIT.test(detail)) error = "backend_usage_limit";
  else if (status === 429) error = "gateway_busy";
  else if (code === "unreachable") error = "backend_unavailable";
  else if (code === "unauthorized") error = "backend_unauthorized";
  else if (!code && detail && USAGE_LIMIT.test(detail)) error = "backend_usage_limit";

  return { error, detail };
}

/** 소켓으로 받은 error 필드를 코드로 쓸 수 있을 때만 쓴다. */
export function meetingErrorCode(value: unknown): string {
  return typeof value === "string" && value ? value : "unknown";
}

/**
 * 회의 채팅에 그릴 문구. 번역이 있는 코드는 번역하고, 없는 옛 문자열 오류("Permission denied")는
 * 그대로 보인다. detail 은 문자열일 때만 괄호로 붙인다.
 */
export function meetingErrorMessage(
  data: { error?: unknown; detail?: unknown },
  t: (key: string) => string,
): string {
  const code = meetingErrorCode(data.error);
  const key = `meeting.reason.${code}`;
  const translated = t(key);
  const reason = translated === key ? code : translated;
  const detail = typeof data.detail === "string" && data.detail ? data.detail : null;
  return detail ? `${reason} (${detail})` : reason;
}
