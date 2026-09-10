import test from "node:test";
import assert from "node:assert/strict";
import { isSetupWarningBlocking, setupHostError } from "./setup-copy";

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
