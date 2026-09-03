import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  availableSteps,
  classifyServingCheck,
  identityDecision,
  nextStep,
} from "./hire-wizard-steps";

describe("availableSteps — 축소 사다리", () => {
  it("플러그인이 있으면 4단 전부 열린다", () => {
    const steps = availableSteps("plugin_ready", false);
    assert.deepEqual(
      steps.map((s) => s.step),
      ["profile", "identity", "config", "placement"],
    );
    assert.ok(steps.every((s) => s.enabled));
  });

  it("플러그인이 없고 로컬 발견이 되면 인격·설정만 잠긴다", () => {
    // 프로필은 파일시스템 발견으로 찾아 등록할 수 있고, 배치도 된다.
    // 인격·설정만 원격에서 손댈 방법이 없다.
    const steps = availableSteps("plugin_absent", true);
    const byStep = Object.fromEntries(steps.map((s) => [s.step, s]));
    assert.equal(byStep.profile.enabled, true);
    assert.equal(byStep.identity.enabled, false);
    assert.equal(byStep.config.enabled, false);
    assert.equal(byStep.placement.enabled, true);
    assert.ok(byStep.identity.lockedReason);
  });

  it("플러그인도 로컬 발견도 없으면 배치만 남는다", () => {
    const steps = availableSteps("plugin_absent", false);
    const byStep = Object.fromEntries(steps.map((s) => [s.step, s]));
    assert.equal(byStep.profile.enabled, false);
    assert.equal(byStep.placement.enabled, true);
  });

  it("401 은 404 와 다른 이유를 준다", () => {
    // 사용자가 할 일이 정반대다 — 키 교체 vs 플러그인 설치.
    const unauthorized = availableSteps("plugin_unauthorized", false);
    const absent = availableSteps("plugin_absent", false);
    const a = unauthorized.find((s) => s.step === "profile")!.lockedReason;
    const b = absent.find((s) => s.step === "profile")!.lockedReason;
    assert.ok(a);
    assert.ok(b);
    assert.notEqual(a, b);
  });

  it("unknown 은 기능을 켜지 않는다", () => {
    const steps = availableSteps("unknown", false);
    assert.equal(steps.find((s) => s.step === "identity")!.enabled, false);
  });
});

describe("identityDecision — 사람이 쓴 인격을 모르고 지우지 않는다", () => {
  it("기본 템플릿이면 바로 편집한다", () => {
    assert.equal(identityDecision({ isDefaultTemplate: true }), "edit_fresh");
  });

  it("사람이 쓴 것이면 물어본다", () => {
    assert.equal(identityDecision({ isDefaultTemplate: false }), "ask_overwrite");
  });

  it("읽을 수 없으면 편집기를 열지 않는다", () => {
    // 빈 편집기를 열면 저장 버튼 한 번으로 원본이 사라진다.
    assert.equal(identityDecision({ isDefaultTemplate: null, unreadable: true }), "blocked");
  });

  it("isDefaultTemplate 이 null 이면 읽지 못한 것으로 본다", () => {
    // null 을 false 처럼 다루면 '사람이 쓴 것'으로 오인해 덮어쓰기를 제안하고,
    // true 처럼 다루면 곧바로 빈 편집기를 연다. 둘 다 위험하다.
    assert.equal(identityDecision({ isDefaultTemplate: null }), "blocked");
  });
});

describe("nextStep", () => {
  it("잠긴 단계는 건너뛴다", () => {
    const steps = availableSteps("plugin_absent", true);
    assert.equal(nextStep("profile", steps), "placement");
  });

  it("마지막 단계 다음은 없다", () => {
    const steps = availableSteps("plugin_ready", false);
    assert.equal(nextStep("placement", steps), null);
  });
});

describe("classifyServingCheck — 401 과 404 를 가른다 (수정 라운드 1)", () => {
  it("errorCode 가 없으면 서빙되는 것이다", () => {
    assert.equal(classifyServingCheck({ errorCode: null, upstreamStatus: null }), "served");
  });

  it("업스트림 401 은 키 문제다 — allowlist 안내와는 다른 조치가 필요하다", () => {
    assert.equal(
      classifyServingCheck({ errorCode: "plugin_error", upstreamStatus: 401 }),
      "key_rejected",
    );
  });

  it("업스트림 404 는 이 게이트웨이가 새 프로필을 서빙하지 않는다는 뜻이다", () => {
    assert.equal(
      classifyServingCheck({ errorCode: "plugin_error", upstreamStatus: 404 }),
      "not_served",
    );
  });

  it("업스트림 상태가 401/404 가 아니면 이름 있는 에러코드라도 unknown 으로 접는다", () => {
    // identity_unreadable(409) 처럼 서빙 여부와 무관한 다른 문제를 401/404 로
    // 오인해 엉뚱한 안내를 하면 안 된다 — 이 경우는 일반 에러코드 메시지로 넘긴다.
    assert.equal(
      classifyServingCheck({ errorCode: "identity_unreadable", upstreamStatus: 409 }),
      "unknown",
    );
  });

  it("도달 실패(status 0)나 그 외 상태코드는 unknown 으로 접는다", () => {
    assert.equal(classifyServingCheck({ errorCode: "unreachable", upstreamStatus: 0 }), "unknown");
    assert.equal(classifyServingCheck({ errorCode: "timeout", upstreamStatus: null }), "unknown");
  });
});

describe("identityDecision — 불리언이 아닌 것은 전부 막는다", () => {
  // 스테이징에서 실제로 났다(2026-09-02): 플러그인이 `isDefaultTemplate: true` 를
  // 정직하게 줬는데 화면은 "이미 작성된 인격이 있습니다" 를 물었다. 응답 파싱이
  // 깨져 `{}` 가 payload 로 흘렀고, `undefined` 가 falsy 라 ask_overwrite 로 접혔다.
  // null 만 걸러서는 부족하다 — 폴백이 하필 위험한 쪽이었다.
  const cases: Array<[string, unknown, string]> = [
    ["필드가 아예 없다", {}, "blocked"],
    ["undefined 를 명시", { isDefaultTemplate: undefined }, "blocked"],
    ["null", { isDefaultTemplate: null }, "blocked"],
    ["문자열 'true'", { isDefaultTemplate: "true" }, "blocked"],
    ["숫자 1", { isDefaultTemplate: 1 }, "blocked"],
    ["진짜 true", { isDefaultTemplate: true }, "edit_fresh"],
    ["진짜 false", { isDefaultTemplate: false }, "ask_overwrite"],
  ];

  for (const [name, payload, expected] of cases) {
    it(name, () => {
      assert.equal(
        identityDecision(payload as Parameters<typeof identityDecision>[0]),
        expected,
      );
    });
  }

  it("unreadable 은 다른 무엇보다 먼저 막는다", () => {
    assert.equal(identityDecision({ isDefaultTemplate: true, unreadable: true }), "blocked");
  });
});
