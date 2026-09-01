import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { availableSteps, identityDecision, nextStep } from "./hire-wizard-steps";

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
