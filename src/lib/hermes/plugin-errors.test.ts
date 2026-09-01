import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { mapPluginFailure } from "./plugin-errors";

describe("mapPluginFailure", () => {
  it("2xx 는 실패가 아니다", () => {
    assert.equal(mapPluginFailure({ status: 200, body: { body: "hi" } }), null);
  });

  it("unreadable 은 200 이어도 편집기를 막는다", () => {
    // 빈 편집기를 열면 사용자가 저장 버튼으로 남의 인격을 지운다.
    const got = mapPluginFailure({
      status: 200,
      body: { body: null, isDefaultTemplate: null, revision: null, unreadable: true },
    });
    assert.ok(got);
    assert.equal(got.code, "unreadable");
    assert.equal(got.blocksEditor, true);
  });

  it("409 identity_unreadable 은 쓰지 않았음을 말한다", () => {
    const got = mapPluginFailure({
      status: 409,
      body: { error: "identity_unreadable", reason: "SOUL.md 을 읽을 수 없다: UnicodeDecodeError" },
    });
    assert.ok(got);
    assert.equal(got.code, "identity_unreadable");
    assert.equal(got.blocksEditor, true);
    assert.match(got.message, /UnicodeDecodeError/);
  });

  it("409 config_unreadable 도 같은 규약이다", () => {
    const got = mapPluginFailure({
      status: 409,
      body: { error: "config_unreadable", reason: "기존 model 키가 매핑이 아니다" },
    });
    assert.ok(got);
    assert.equal(got.code, "config_unreadable");
    assert.equal(got.blocksEditor, true);
  });

  it("409 profile_has_service 는 셸 명령을 그대로 보여준다", () => {
    const got = mapPluginFailure({
      status: 409,
      body: {
        error: "profile_has_service",
        name: "noah",
        unit: "hermes-gateway-noah",
        reason:
          "프로필 'noah' 은 자기 서비스(hermes-gateway-noah)를 갖고 있어 여기서 지울 수 없습니다. 셸에서 정리하세요: hermes profile delete noah",
      },
    });
    assert.ok(got);
    assert.equal(got.code, "profile_has_service");
    assert.equal(got.showsShellCommand, "hermes profile delete noah");
  });

  it("409 revision_conflict 는 다시 읽으라는 뜻이다", () => {
    const got = mapPluginFailure({ status: 409, body: { error: "revision_conflict" } });
    assert.ok(got);
    assert.equal(got.code, "revision_conflict");
    assert.equal(got.blocksEditor, false);
  });

  it("409 already_exists 는 이름 충돌이다", () => {
    const got = mapPluginFailure({ status: 409, body: { error: "already_exists", name: "noah" } });
    assert.ok(got);
    assert.equal(got.code, "already_exists");
  });

  it("모르는 오류도 코드를 잃지 않는다", () => {
    const got = mapPluginFailure({ status: 500, body: {} });
    assert.ok(got);
    assert.equal(got.code, "plugin_error");
  });

  it("본문이 객체가 아니어도 던지지 않는다", () => {
    const got = mapPluginFailure({ status: 400, body: "bad request" });
    assert.ok(got);
    assert.equal(got.code, "plugin_error");
  });
});

// I-2: error/reason 외 구조화 필드(currentRevision·name·unit …)가 화면에 필요한데
// 지금은 버려진다. details 로 그대로 옮겨야 재읽기·병합·이름 충돌 안내가 가능하다.
describe("mapPluginFailure — details (I-2 복구)", () => {
  it("revision_conflict 의 currentRevision 은 재읽기에 필요하다 — details 에 남는다", () => {
    const got = mapPluginFailure({
      status: 409,
      body: { error: "revision_conflict", currentRevision: "zzz" },
    });
    assert.ok(got);
    assert.equal(got.details.currentRevision, "zzz");
  });

  it("already_exists 의 name 이 details 에 남아야 '이미 있다' 는 문장을 만들 수 있다", () => {
    const got = mapPluginFailure({ status: 409, body: { error: "already_exists", name: "noah" } });
    assert.ok(got);
    assert.equal(got.details.name, "noah");
  });

  it("profile_has_service 의 unit 도 details 에 남는다", () => {
    const got = mapPluginFailure({
      status: 409,
      body: {
        error: "profile_has_service",
        name: "noah",
        unit: "hermes-gateway-noah",
        reason:
          "프로필 'noah' 은 자기 서비스(hermes-gateway-noah)를 갖고 있어 여기서 지울 수 없습니다. 셸에서 정리하세요: hermes profile delete noah",
      },
    });
    assert.ok(got);
    assert.equal(got.details.unit, "hermes-gateway-noah");
    assert.equal(got.details.name, "noah");
  });

  it("code/message 가 없는 경우도 details 는 빈 객체다 — undefined 로 던지지 않는다", () => {
    const got = mapPluginFailure({ status: 500, body: {} });
    assert.ok(got);
    assert.deepEqual(got.details, {});
  });
});

// M-3: 셸 명령 추출이 코드와 무관하게 문장 끝 모양만 보고 붙는다. 우연히 같은 모양으로
// 끝나는 무관한 코드에서 명령 버튼이 뜨면 안 된다 — 화이트리스트로 좁힌다.
describe("mapPluginFailure — showsShellCommand 는 화이트리스트 코드에만 (M-3)", () => {
  it("profile_has_service 는 셸 명령을 보여준다 (기존 동작 유지)", () => {
    const got = mapPluginFailure({
      status: 409,
      body: {
        error: "profile_has_service",
        reason: "정리하세요: hermes profile delete noah",
      },
    });
    assert.ok(got);
    assert.equal(got.showsShellCommand, "hermes profile delete noah");
  });

  it("revision_conflict 의 설명이 우연히 같은 모양으로 끝나도 셸 명령을 보여주지 않는다", () => {
    const got = mapPluginFailure({
      status: 409,
      body: {
        error: "revision_conflict",
        reason: "다시 시도하기 전에 참고: hermes profile delete noah",
      },
    });
    assert.ok(got);
    assert.equal(got.showsShellCommand, null);
  });
});

// M-4: unreachable 과 5xx(plugin_error) 는 둘 다 "서버가 응답을 못 줬다"인데
// blocksEditor 가 반대였다. 5xx 에서 편집기가 열리면 저장 시점에 다시 실패한다.
describe("mapPluginFailure — 5xx 도 편집기를 막는다 (M-4)", () => {
  it("500 은 blocksEditor: true 다", () => {
    const got = mapPluginFailure({ status: 500, body: {} });
    assert.ok(got);
    assert.equal(got.blocksEditor, true);
  });

  it("503 도 blocksEditor: true 다", () => {
    const got = mapPluginFailure({ status: 503, body: {} });
    assert.ok(got);
    assert.equal(got.blocksEditor, true);
  });

  it("4xx 는 이름 있는 코드가 아니면 여전히 blocksEditor: false 다 (재시도 가능한 사용자 입력 오류)", () => {
    const got = mapPluginFailure({ status: 400, body: "bad request" });
    assert.ok(got);
    assert.equal(got.blocksEditor, false);
  });
});

describe("profile_has_service 안내", () => {
  it("셸 명령에 프로필 이름이 그대로 들어간다", () => {
    // 사용자가 복붙해서 바로 실행할 수 있어야 한다. 이름을 우리가 다시
    // 조립하면 인코딩·공백에서 틀릴 수 있으니 플러그인이 준 문자열을 쓴다.
    const got = mapPluginFailure({
      status: 409,
      body: {
        error: "profile_has_service",
        unit: "hermes-gateway-my-bot",
        reason:
          "프로필 'my-bot' 은 자기 서비스(hermes-gateway-my-bot)를 갖고 있어 여기서 지울 수 없습니다. 셸에서 정리하세요: hermes profile delete my-bot",
      },
    });
    assert.ok(got);
    assert.equal(got.showsShellCommand, "hermes profile delete my-bot");
  });
});

describe("record.error 의 세 모양 (수정 라운드 2 — 라이브 실측, MiniPC 게이트웨이, Hermes v0.21.0)", () => {
  it("404 — error 가 평문 문장이면 코드 자리에 문장을 흘리지 않는다", () => {
    // 실측 그대로: { "error": "Unknown or unconfigured profile" }
    const got = mapPluginFailure({
      status: 404,
      body: { error: "Unknown or unconfigured profile" },
    });
    assert.ok(got);
    assert.equal(
      got.code,
      "upstream_error",
      "문장은 wizard-error-codes 사전에 없는 값이라 코드로 쓰면 안 된다",
    );
    assert.equal(
      got.message,
      "Unknown or unconfigured profile",
      "문장 자체는 잃지 않고 message 에 보존한다",
    );
  });

  it("401 — error 가 객체면 안의 진짜 code 를 꺼낸다", () => {
    // 실측 그대로: { "error": { "message": "...", "type": "gateway_auth_error",
    //                            "code": "gateway_auth_failed" } }
    const got = mapPluginFailure({
      status: 401,
      body: {
        error: {
          message: "Invalid gateway API key (API_SERVER_KEY)",
          type: "gateway_auth_error",
          code: "gateway_auth_failed",
        },
      },
    });
    assert.ok(got);
    assert.equal(got.code, "gateway_auth_failed", "plugin_error 로 뭉개면 진짜 원인을 잃는다");
    assert.equal(got.message, "Invalid gateway API key (API_SERVER_KEY)");
  });

  it("409 — error 가 짧은 코드 문자열이면 기존처럼 그대로 코드로 쓴다", () => {
    // 실측 그대로: { "error": "config_unreadable", "reason": "..." } — 우리 플러그인 모양.
    const got = mapPluginFailure({
      status: 409,
      body: { error: "config_unreadable", reason: "기존 model 키가 매핑이 아니다" },
    });
    assert.ok(got);
    assert.equal(got.code, "config_unreadable");
    assert.equal(got.message, "기존 model 키가 매핑이 아니다");
  });

  it("객체 error 에 code 가 없으면 plugin_error 로 접되 message 는 살린다", () => {
    const got = mapPluginFailure({
      status: 500,
      body: { error: { message: "internal failure" } },
    });
    assert.ok(got);
    assert.equal(got.code, "plugin_error");
    assert.equal(got.message, "internal failure");
  });
});
