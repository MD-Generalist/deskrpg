import test from "node:test";
import assert from "node:assert/strict";

import {
  getNpcResponseMessageKey,
  resolveNpcResponseChunk,
  type NpcResponseMessageCode,
} from "./npc-response-messages";

// 전수 목록이다 — 타입이 `Record<NpcResponseMessageCode, string>` 이므로 코드가
// 늘면 여기가 비어 컴파일이 막힌다. 예전엔 12개 중 5개만 적혀 있었고, 타입은
// "전수" 라고 주장했지만 tsc 오류로만 남아 아무도 보지 않았다.
const TEST_CODES: Record<NpcResponseMessageCode, string> = {
  no_agent: "npc.noAgent",
  gateway_not_connected: "npc.gatewayNotConnected",
  gateway_error: "npc.gatewayError",
  gateway_unreachable: "npc.gatewayUnreachable",
  gateway_auth_failed: "npc.gatewayAuthFailed",
  gateway_timeout: "npc.gatewayTimeout",
  gateway_unknown_error: "npc.gatewayUnknownError",
  unsupported_adapter: "npc.unsupportedAdapter",
  wait_before_sending: "npc.waitBeforeSending",
  npc_not_found: "npc.notFound",
  unsupported_file_type: "npc.unsupportedFileType",
  file_too_large: "npc.fileTooLarge",
  too_many_files: "npc.tooManyFiles",
  npc_unbound: "npc.unbound",
  hermes_image_unsupported: "npc.hermesImageUnsupported",
};

test("npc response message codes map to stable translation keys", () => {
  for (const [code, key] of Object.entries(TEST_CODES)) {
    assert.equal(getNpcResponseMessageKey(code as NpcResponseMessageCode), key);
  }
});

test("resolveNpcResponseChunk localizes system message codes", () => {
  const calls: Array<{ key: string; params?: Record<string, string | number> }> = [];
  const result = resolveNpcResponseChunk(
    {
      chunk: "",
      messageCode: "gateway_error",
    },
    (key, params) => {
      calls.push({ key, params });
      return `translated:${key}`;
    },
  );

  assert.equal(result, "translated:npc.gatewayError");
  assert.deepEqual(calls, [{ key: "npc.gatewayError", params: undefined }]);
});

test("resolveNpcResponseChunk preserves streamed text when no system message code exists", () => {
  const result = resolveNpcResponseChunk(
    {
      chunk: "hello",
    },
    () => "should-not-be-used",
  );

  assert.equal(result, "hello");
});

// 코드를 등록해도 번역이 없으면 사용자는 키 문자열이나 빈 말풍선을 본다.
// 에러코드 쪽에는 이 가드가 있었지만 NPC 시스템 메시지에는 없었다.
test("등록된 NPC 시스템 메시지 코드는 4개 로케일에 전부 번역이 있다", async () => {
  const [ko, en, ja, zh] = await Promise.all([
    import("./i18n/locales/ko"),
    import("./i18n/locales/en"),
    import("./i18n/locales/ja"),
    import("./i18n/locales/zh"),
  ]);
  const locales: Array<[string, Record<string, string>]> = [
    ["ko", ko.default],
    ["en", en.default],
    ["ja", ja.default],
    ["zh", zh.default],
  ];
  const missing: string[] = [];
  for (const key of Object.values(TEST_CODES)) {
    for (const [lang, dict] of locales) {
      if (!dict[key]) missing.push(`${lang}: ${key}`);
    }
  }
  assert.deepEqual(missing, [], `번역이 없는 NPC 메시지 코드:\n  ${missing.join("\n  ")}`);
});
