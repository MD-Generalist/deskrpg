import assert from "node:assert/strict";
import test from "node:test";

import { describeMeetingFailure, meetingErrorCode, meetingErrorMessage } from "./meeting-error";

/** hermes-client 의 HermesError 와 같은 모양 — 이 모듈은 브라우저에서도 읽히므로 클래스를 import 하지 않는다. */
function hermesError(code: string, message: string, status: number) {
  return Object.assign(new Error(message), { name: "HermesError", code, status });
}

test("모델 백엔드 사용 한도(실행 실패 안의 429)는 한도 코드로 구분된다", () => {
  // 스테이징 실측: Codex 계정 한도가 찼을 때 게이트웨이가 run.failed 로 돌려준 사유
  const out = describeMeetingFailure(
    hermesError("run_failed", "HTTP 429: The usage limit has been reached", 200),
  );
  assert.equal(out.error, "backend_usage_limit");
  assert.equal(out.detail, "HTTP 429: The usage limit has been reached");
});

test("게이트웨이 동시 실행 상한(HTTP 429)은 사용 한도와 다른 코드다", () => {
  assert.equal(
    describeMeetingFailure(hermesError("http_error", "Too Many Requests", 429)).error,
    "gateway_busy",
  );
});

test("게이트웨이에 닿지 못하거나 인증이 거절되면 각자의 코드다", () => {
  assert.equal(
    describeMeetingFailure(hermesError("unreachable", "connect ECONNREFUSED", 0)).error,
    "backend_unavailable",
  );
  assert.equal(
    describeMeetingFailure(hermesError("unauthorized", "401", 401)).error,
    "backend_unauthorized",
  );
});

test("Error·평범한 객체·문자열·없음 어느 것이 와도 error 와 detail 은 문자열이다", () => {
  for (const input of [
    new Error("boom"),
    { code: "adapter_failed", message: "adapter blew up" },
    { nested: { deep: true } },
    "plain failure",
    null,
    undefined,
    42,
  ]) {
    const out = describeMeetingFailure(input);
    assert.equal(typeof out.error, "string", `error 가 문자열이 아니다: ${String(input)}`);
    assert.ok(out.detail === null || typeof out.detail === "string");
    assert.doesNotMatch(JSON.stringify(out), /\[object Object\]/);
  }
  assert.equal(describeMeetingFailure({ nested: { deep: true } }).detail, null);
  assert.equal(describeMeetingFailure("plain failure").detail, "plain failure");
});

test("detail 은 한 줄로 줄이고 길이를 제한하며 토큰 모양을 가린다", () => {
  const long = describeMeetingFailure(new Error(`first line\nsecond ${"x".repeat(500)}`));
  assert.ok(long.detail);
  assert.doesNotMatch(long.detail!, /\n/);
  assert.ok(long.detail!.length <= 160, `길이 ${long.detail!.length}`);

  const secret = describeMeetingFailure(
    new Error("upstream said: Bearer abcdefghijklmnop key sk-proj-1234567890abcdef"),
  );
  assert.doesNotMatch(secret.detail!, /abcdefghijklmnop|sk-proj-1234567890abcdef/);
});

test("클라이언트는 문자열이 아닌 오류 값을 코드로 쓰지 않는다", () => {
  assert.equal(meetingErrorCode("backend_usage_limit"), "backend_usage_limit");
  assert.equal(meetingErrorCode({ code: "x" }), "unknown");
  assert.equal(meetingErrorCode(undefined), "unknown");
  assert.equal(meetingErrorCode(""), "unknown");
});

test("회의 채팅에 그릴 문구는 객체를 받아도 [object Object] 를 만들지 않는다", () => {
  const dict: Record<string, string> = {
    "meeting.reason.backend_usage_limit": "AI 백엔드 사용 한도가 찼습니다.",
    "meeting.reason.unknown": "알 수 없는 오류입니다.",
  };
  const t = (key: string) => dict[key] ?? key;

  assert.equal(
    meetingErrorMessage({ error: "backend_usage_limit", detail: "HTTP 429" }, t),
    "AI 백엔드 사용 한도가 찼습니다. (HTTP 429)",
  );
  // 서버가 옛 버전이라 객체를 그대로 보내도 글자가 새지 않는다
  assert.equal(meetingErrorMessage({ error: { message: "x" } }, t), "알 수 없는 오류입니다.");
  // 번역이 없는 옛 문자열 오류는 그대로 보인다(기존 리터럴 발행처들)
  assert.equal(meetingErrorMessage({ error: "Permission denied" }, t), "Permission denied");
  assert.equal(
    meetingErrorMessage({ error: "backend_usage_limit", detail: { a: 1 } }, t),
    "AI 백엔드 사용 한도가 찼습니다.",
  );
});
