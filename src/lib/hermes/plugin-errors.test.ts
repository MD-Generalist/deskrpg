import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { mapPluginFailure, pluginUpgradeRequired } from "./plugin-errors";
import { supportsSwarm, swarmGate } from "./plugin-capability";
import type { PluginInfo } from "./deskrpg-plugin-types";

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

  it("error 가 배열이면 객체 분기(code/message 추출)를 타지 않는다", () => {
    // typeof [] === "object" 라 Array.isArray 가드가 없으면 nested.code 를 찾다가
    // 조용히 undefined 를 만나거나, 배열 요소를 코드로 오인할 수 있다.
    const got = mapPluginFailure({
      status: 400,
      body: { error: ["one", "two"], reason: "여러 문제가 있다" },
    });
    assert.ok(got);
    assert.equal(got.code, "plugin_error");
    assert.equal(got.message, "여러 문제가 있다", "reason 이 있으면 그것을 message 로 쓴다");
  });
});

describe("isCodeLikeString 경계 (수정 라운드 3 I-4 — 리뷰어 실증)", () => {
  it("대문자로 시작하는 한 단어 문장은 코드로 오인되지 않고, 문장이 message 에 남는다", () => {
    // 예전 정규식(`i` 플래그)은 이걸 코드로 통과시켰다 — 그러면 미등록 코드가 되고
    // (화면엔 "알 수 없는 오류") reason 이 없으니 message 도 "" 라 원문이 통째로 사라졌다.
    for (const sentence of ["Unauthorized", "Forbidden"]) {
      const got = mapPluginFailure({ status: 401, body: { error: sentence } });
      assert.ok(got);
      assert.equal(got.code, "upstream_error", `${sentence} 는 코드가 아니다`);
      assert.equal(got.message, sentence, `${sentence} 자체가 message 에 남아야 한다`);
    }
  });

  it("구분자(_ 또는 -) 없는 소문자 한 단어도 코드로 오인되지 않는다", () => {
    for (const word of ["conflict", "error", "failed"]) {
      const got = mapPluginFailure({ status: 409, body: { error: word } });
      assert.ok(got);
      assert.equal(got.code, "upstream_error", `${word} 는 구분자가 없어 코드가 아니다`);
      assert.equal(got.message, word);
    }
  });

  it("등록된 코드처럼 밑줄이 있으면 여전히 코드로 통과한다 (회귀 방지)", () => {
    for (const code of [
      "config_unreadable",
      "already_exists",
      "profile_has_service",
      "gateway_auth_failed",
    ]) {
      const got = mapPluginFailure({ status: 409, body: { error: code } });
      assert.ok(got);
      assert.equal(got.code, code);
    }
  });

  it("코드로 판정됐지만 reason 이 없으면 message 는 코드 문자열 자체로 채워진다", () => {
    // I-4 (a): 코드 판정 여부와 무관하게 message 를 항상 채운다 — 빈 문자열로 두면
    // 화면의 상세 문구가 이유 없이 사라진다.
    const got = mapPluginFailure({ status: 409, body: { error: "revision_conflict" } });
    assert.ok(got);
    assert.equal(got.code, "revision_conflict");
    assert.equal(got.message, "revision_conflict");
  });

  it("공백이 있으면 여전히 문장으로 취급한다 (원래도 안전했던 경로 회귀 방지)", () => {
    for (const sentence of ["Not Found", "Bad Request", "internal server error"]) {
      const got = mapPluginFailure({ status: 404, body: { error: sentence } });
      assert.ok(got);
      assert.equal(got.code, "upstream_error");
      assert.equal(got.message, sentence);
    }
  });
});

describe("자동화 계약 실패 코드", () => {
  it("400 unknown_cursor 는 코드 그대로 접힌다 — 폴러가 커서를 버리고 다시 시작해야 한다", () => {
    const got = mapPluginFailure({ status: 400, body: { error: "unknown_cursor" } });
    assert.ok(got);
    assert.equal(got.code, "unknown_cursor");
    assert.equal(got.blocksEditor, false);
  });

  it("pluginUpgradeRequired 는 계약 게이트 결과를 같은 실패 모양으로 옮긴다", () => {
    const got = pluginUpgradeRequired({
      ok: false,
      minVersion: "0.6.0",
      reason: "missing_capability",
      missing: ["events"],
    });
    assert.equal(got.code, "plugin_upgrade_required");
    assert.equal(got.blocksEditor, true);
    assert.equal(got.showsShellCommand, null);
    assert.deepEqual(got.details, {
      minVersion: "0.6.0",
      reason: "missing_capability",
      missing: ["events"],
    });
  });
});

// 스웜 기능 가용성 판정 (Task 5)
describe("스웜 capability 게이트", () => {
  it("capabilities 에 swarm 이 있으면 통과한다", () => {
    const info = {
      version: "0.7.0",
      capabilities: ["kanban", "cron", "events", "swarm"],
    } as PluginInfo;
    assert.equal(supportsSwarm(info), true);
    assert.equal(swarmGate(info).ok, true);
  });

  it("버전이 높아도 capability 가 없으면 거절한다", () => {
    // 심볼이 없는 Hermes 빌드. 버전만 보면 "새 플러그인인데 404" 가 된다.
    const info = { version: "0.9.0", capabilities: ["kanban", "cron", "events"] } as PluginInfo;
    assert.equal(supportsSwarm(info), false);
    const gate = swarmGate(info);
    assert.equal(gate.ok, false);
    assert.equal(gate.ok === false && gate.reason, "missing_capability");
    assert.deepEqual(gate.ok === false && gate.missing, ["swarm"]);
  });

  it("info 가 없으면 거절한다", () => {
    assert.equal(supportsSwarm(null), false);
    assert.equal(swarmGate(null).ok, false);
  });

  it("스웜 게이트 거절은 기존 업그레이드 실패 모양으로 옮겨진다", () => {
    const gate = swarmGate({ version: "0.6.0", capabilities: ["kanban"] } as PluginInfo);
    assert.equal(gate.ok, false);
    const failure = pluginUpgradeRequired(gate as Exclude<typeof gate, { ok: true }>);
    assert.equal(failure.code, "plugin_upgrade_required");
    assert.equal(failure.details.minVersion, "0.7.0");
  });

  it("버전이 낮아도 capability 가 있으면 통과한다", () => {
    // 게이트는 버전을 보지 않는다. 플러그인이 Hermes 빌드에 스웜이 없으면 capability 에서
    // 빼기 때문에, capability 하나가 가용성의 정본이다. 테스트용 가짜 서버가 실제로
    // 0.6.0 을 보고하면서 swarm capability 를 싣는다 — 이 조합이 통과해야 한다.
    const info = {
      version: "0.6.0",
      capabilities: ["kanban", "cron", "events", "swarm"],
    } as PluginInfo;
    assert.equal(supportsSwarm(info), true);
    assert.equal(swarmGate(info).ok, true);
  });
});

describe("mapPluginFailure — native 전이 거절 사유", () => {
  it("플러그인 detail 문장을 코드와 함께 보존한다", () => {
    const detail = "human approval is required for this protected task";
    const got = mapPluginFailure({
      status: 409,
      body: { error: "invalid_transition", detail },
    });
    assert.ok(got);
    assert.equal(got.code, "invalid_transition");
    assert.equal(got.message, detail);
    assert.equal(got.details.detail, detail);
  });

  it("기존 reason을 우선하고 구조화 detail을 문자열로 바꾸지 않는다", () => {
    assert.equal(
      mapPluginFailure({
        status: 409,
        body: {
          error: "invalid_transition",
          reason: "기존 설명",
          detail: "추가 설명",
        },
      })?.message,
      "기존 설명",
    );
    assert.equal(
      mapPluginFailure({
        status: 409,
        body: {
          error: "invalid_transition",
          detail: { expected: "review" },
        },
      })?.message,
      "invalid_transition",
    );
  });
});
