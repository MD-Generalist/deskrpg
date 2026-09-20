import test from "node:test";
import assert from "node:assert/strict";
import {
  isSetupWarningBlocking,
  setupCopy,
  setupHostError,
  setupProgress,
  setupStep,
} from "./setup-copy";

test("host remediation is present in all four locales without raw error codes", () => {
  for (const code of [
    "managed_service_required",
    "service_identity_ambiguous",
    "service_identity_mismatch",
    "listener_owner_required",
    "external_secret_provider",
    "api_key_invalid",
    "multiplex_override_present",
    "multiplex_conflict",
    "port_conflict",
    "listener_ownership_unverified",
    "plugin_identity_ambiguous",
    "plugin_install_failed",
    "plugin_security_review_required",
    "plugin_source_unavailable",
    "gateway_restart_failed",
    "gateway_verification_failed",
    "profile_verification_failed",
    "host_operation_failed",
    "unsafe_host_path",
    "invalid_host_config",
    "invalid_candidate",
  ]) {
    for (const locale of ["ko", "en", "ja", "zh"] as const) {
      const message = setupHostError(locale, code);
      assert.ok(message && message.length > 20, `${locale}: ${code}`);
      assert.ok(!message.includes(code));
    }
  }
});
test("only known repairable warning states allow preparation", () => {
  for (const code of [
    undefined,
    "gateway_unreachable",
    "plugin_absent",
    "plugin_disabled",
    "plugin_pending_restart",
    "api_key_missing",
  ])
    assert.equal(isSetupWarningBlocking(code), false);
  for (const code of [
    "plugin_unauthorized",
    "multiplex_conflict",
    "external_secret_provider",
    "future_unknown_state",
  ])
    assert.equal(isSetupWarningBlocking(code), true);
  assert.equal(setupHostError("ko", "secret raw subprocess output"), undefined);
});

test("host_busy uses localized retry guidance", async () => {
  const { setupCopy, setupError } = await import("./setup-copy");
  for (const locale of ["ko", "en", "ja", "zh"] as const) {
    assert.equal(setupError(setupCopy[locale], "host_busy"), setupCopy[locale].busy);
  }
});

test("새 오류 코드는 네 언어 모두에서 원시 코드 없이 안내 문구를 돌려준다", async () => {
  const { setupCopy, setupError } = await import("./setup-copy");
  for (const code of [
    "hermes_version_unsupported",
    "plugin_update_failed",
    "service_install_failed",
    "timezone_invalid",
    "timezone_write_failed",
  ]) {
    for (const locale of ["ko", "en", "ja", "zh"] as const) {
      const message = setupHostError(locale, code);
      assert.ok(message && message.length > 20, `${locale}: ${code}`);
      assert.ok(!message.includes(code));
      // 호스트 안내가 있으므로 일반 폴백보다 구체적이어야 한다.
      assert.notEqual(message, setupError(setupCopy[locale], code));
    }
  }
  assert.match(setupHostError("ko", "hermes_version_unsupported")!, /0\.21\.1/);
});

test("새 진행 단계는 네 언어 모두 고유한 라벨을 가진다", async () => {
  const { setupCopy, setupStep } = await import("./setup-copy");
  for (const locale of ["ko", "en", "ja", "zh"] as const) {
    const copy = setupCopy[locale];
    const labels = ["installing_service", "updating_plugin", "setting_timezone"].map((code) =>
      setupStep(copy, code),
    );
    for (const label of labels) {
      assert.ok(label.length > 0);
      assert.notEqual(label, copy.step, `${locale}: 일반 폴백으로 새면 안 된다`);
    }
    assert.equal(new Set(labels).size, 3, `${locale}: 세 단계가 서로 달라야 한다`);
    assert.ok(copy.pluginVersion.length > 0);
  }
});

test("계약 2 의 새 오류 코드도 네 언어 모두 원시 코드 없이 안내를 돌려준다", async () => {
  const { setupCopy, setupError } = await import("./setup-copy");
  for (const code of [
    "profile_name_invalid",
    "profile_exists",
    "profile_create_failed",
    "profile_key_failed",
    "profile_provision_forbidden",
    "profile_verify_failed",
    "hermes_already_installed",
    "hermes_install_forbidden",
    "hermes_install_failed",
    "hermes_installer_unavailable",
  ]) {
    for (const locale of ["ko", "en", "ja", "zh"] as const) {
      const message = setupHostError(locale, code);
      assert.ok(message && message.length > 20, `${locale}: ${code}`);
      assert.ok(!message.includes(code));
      assert.notEqual(message, setupError(setupCopy[locale], code));
    }
  }
});

test("경고는 네 언어에서 안내를 돌려주고, 모르는 코드는 화면에 그리지 않는다", async () => {
  const { setupWarning } = await import("./setup-copy");
  for (const code of ["profile_not_served", "model_provider_required"]) {
    for (const locale of ["ko", "en", "ja", "zh"] as const) {
      const message = setupWarning(locale, code);
      assert.ok(message && message.length > 20, `${locale}: ${code}`);
      assert.ok(!message.includes(code));
    }
  }
  assert.match(setupWarning("ko", "model_provider_required")!, /hermes model/);
  // 화이트리스트 밖은 undefined — 원시 코드나 호스트 출력이 새면 안 된다.
  assert.equal(setupWarning("ko", "raw subprocess tail"), undefined);
  assert.equal(setupWarning("ko", undefined), undefined);
});

test("계약 2 의 새 진행 단계는 네 언어 모두 고유한 라벨을 가진다", async () => {
  const { setupCopy, setupStep } = await import("./setup-copy");
  for (const locale of ["ko", "en", "ja", "zh"] as const) {
    const copy = setupCopy[locale];
    const labels = ["installing_hermes", "creating_profile", "provisioning_keys"].map((code) =>
      setupStep(copy, code),
    );
    for (const label of labels) assert.notEqual(label, copy.step, `${locale}: 일반 폴백 금지`);
    assert.equal(new Set(labels).size, 3, `${locale}: 세 단계가 서로 달라야 한다`);
  }
});

test("설치 이정표는 네 로케일 모두에 있고 모르는 코드는 아무것도 돌려주지 않는다", () => {
  for (const code of ["deps", "clone", "venv", "node_modules", "skills", "done"]) {
    for (const locale of ["ko", "en", "ja", "zh"] as const) {
      const message = setupProgress(locale, code);
      assert.ok(message && message.length > 2, `${locale}: ${code}`);
    }
  }
  for (const code of [undefined, null, 42, "", "raw output line", "installing python 3.12"])
    assert.equal(setupProgress("ko", code), undefined);
});
test("모델 확인 단계는 네 로케일 모두에서 원시 코드가 아닌 문구로 나온다", () => {
  for (const locale of ["ko", "en", "ja", "zh"] as const) {
    const label = setupStep(setupCopy[locale], "checking_model");
    assert.ok(label && label.length > 2, locale);
    assert.ok(!label.includes("checking_model"));
    assert.notEqual(label, setupCopy[locale].step);
  }
});

test("갱신 전용 오류도 네 언어에서 이유를 말한다 — 원시 코드를 화면에 내보내지 않는다", async () => {
  for (const code of ["plugin_update_unsupported_host", "plugin_update_candidate_not_found"]) {
    for (const locale of ["ko", "en", "ja", "zh"] as const) {
      const message = setupHostError(locale, code);
      assert.ok(message && message.length > 20, `${locale}: ${code}`);
      assert.ok(!message.includes(code));
    }
  }
});
