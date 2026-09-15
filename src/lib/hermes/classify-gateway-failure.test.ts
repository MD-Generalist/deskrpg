import assert from "node:assert/strict";
import test from "node:test";

import { classifyGatewayFailure, gatewayFailureMessageCode } from "./classify-gateway-failure";
import { HermesError } from "./hermes-client";

test("게이트웨이가 꺼져 있으면 도달 불가로 분류한다", () => {
  const err = new HermesError("unreachable", "fetch failed", 0);
  assert.equal(classifyGatewayFailure(err), "unreachable");
});

test("키가 거부되면 인증 실패로 분류한다", () => {
  assert.equal(
    classifyGatewayFailure(new HermesError("unauthorized", "Unauthorized", 401)),
    "auth",
  );
  assert.equal(classifyGatewayFailure(new HermesError("unauthorized", "Forbidden", 403)), "auth");
});

test("중단된 요청은 도달 불가가 아니라 타임아웃으로 분류한다", () => {
  // HermesClient.request 는 fetch 가 던진 것을 전부 unreachable 로 싼다 —
  // 코드만 믿으면 타임아웃이 영원히 "게이트웨이가 꺼졌다" 로 보인다.
  const wrapped = new HermesError("unreachable", "This operation was aborted", 0);
  assert.equal(classifyGatewayFailure(wrapped), "timeout");

  const abort = new Error("aborted");
  abort.name = "AbortError";
  assert.equal(classifyGatewayFailure(abort), "timeout");
});

test("소켓 타임아웃 cause 코드는 타임아웃으로 분류한다", () => {
  const err = Object.assign(new TypeError("fetch failed"), {
    cause: { code: "UND_ERR_HEADERS_TIMEOUT" },
  });
  assert.equal(classifyGatewayFailure(err), "timeout");
});

test("연결 거부 cause 코드는 도달 불가로 분류한다", () => {
  for (const code of ["ECONNREFUSED", "ENOTFOUND", "EHOSTUNREACH"]) {
    const err = Object.assign(new TypeError("fetch failed"), { cause: { code } });
    assert.equal(classifyGatewayFailure(err), "unreachable", code);
  }
});

test("그 밖의 Hermes 오류 코드는 알 수 없는 오류로 접는다", () => {
  assert.equal(classifyGatewayFailure(new HermesError("http_error", "HTTP 500", 500)), "unknown");
  assert.equal(
    classifyGatewayFailure(new HermesError("run_failed", "model error", 200)),
    "unknown",
  );
  assert.equal(
    classifyGatewayFailure(new HermesError("unknown_profile", "Unknown profile", 404)),
    "unknown",
  );
});

test("구조화된 정보가 전혀 없으면 알 수 없는 오류로 분류한다", () => {
  assert.equal(classifyGatewayFailure(new Error("boom")), "unknown");
  assert.equal(classifyGatewayFailure(null), "unknown");
  assert.equal(classifyGatewayFailure("something"), "unknown");
});

test("HermesError 가 아닌 예외도 문구로 인증 실패를 알아본다", () => {
  assert.equal(classifyGatewayFailure(new Error("invalid api key")), "auth");
  assert.equal(classifyGatewayFailure(new Error("Unauthorized")), "auth");
});

test("분류 결과가 npc:response 메시지 코드로 옮겨진다", () => {
  assert.equal(
    gatewayFailureMessageCode(new HermesError("unreachable", "fetch failed", 0)),
    "gateway_unreachable",
  );
  assert.equal(
    gatewayFailureMessageCode(new HermesError("unauthorized", "Unauthorized", 401)),
    "gateway_auth_failed",
  );
  assert.equal(gatewayFailureMessageCode(new Error("boom")), "gateway_unknown_error");
});
