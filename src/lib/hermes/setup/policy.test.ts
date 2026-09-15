import test from "node:test";
import assert from "node:assert/strict";
import {
  hermesInstallAllowed,
  hostSetupAllowed,
  validateProfileName,
  validateProfileDescription,
  sameOriginMutation,
  validateGatewayUrl,
  safeSetupError,
  validateTimezone,
} from "./policy";

test("host execution requires operator opt-in AND system administrator", () => {
  assert.equal(hostSetupAllowed({}, "system_admin"), false);
  assert.equal(hostSetupAllowed({ DESKRPG_HOST_SETUP_ENABLED: "1" }, "user"), false);
  assert.equal(hostSetupAllowed({ DESKRPG_HOST_SETUP_ENABLED: "1" }, "system_admin"), true);
});
test("mutations fail closed for absent, cross-site or malformed origin", () => {
  assert.equal(sameOriginMutation("http://localhost:3102", "localhost:3102"), true);
  assert.equal(sameOriginMutation("https://evil.test", "localhost:3102"), false);
  assert.equal(sameOriginMutation(null, "localhost:3102"), false);
  assert.equal(sameOriginMutation("null", "localhost:3102"), false);
  assert.equal(sameOriginMutation("http://localhost:3102", "localhost:3102", "cross-site"), false);
});
test("gateway target supports private networks but excludes credential URLs and metadata", () => {
  assert.equal(validateGatewayUrl("http://127.0.0.1:8642/"), "http://127.0.0.1:8642");
  assert.equal(
    validateGatewayUrl("https://gateway.example/prefix"),
    "https://gateway.example/prefix",
  );
  for (const url of [
    "file:///etc/passwd",
    "http://user:pass@host",
    "http://169.254.169.254",
    "http://metadata.google.internal",
    "http://metadata.google.internal./",
    "http://[::ffff:169.254.169.254]/",
    "http://[::ffff:a9fe:a9fe]/",
    "http://[fe90::1]/",
    "http://[febf::1]/",
    "http://host/?token=secret",
    "http://host/#secret",
    "http://evil.deskrpg-ssh.invalid",
  ]) {
    assert.throws(() => validateGatewayUrl(url));
  }
});
test("unexpected subprocess/DB messages never leave server", () => {
  assert.equal(safeSetupError(new Error("ssh failed token=secret-value")), "setup_failed");
  assert.equal(safeSetupError(new Error("multiplex_conflict")), "multiplex_conflict");
});

test("security scan and source failures are safe structured errors", () => {
  for (const code of ["plugin_security_review_required", "plugin_source_unavailable"])
    assert.equal(safeSetupError(new Error(code)), code);
});

test("점 구간이 든 시간대는 모양이 맞아도 거부한다", () => {
  // `Asia/../Seoul` 은 정규식을 통과하지만 zoneinfo 가 해석하지 못한다 —
  // 운영자의 config.yaml 에 쓸 수 없는 값을 남기지 않는다.
  for (const bad of ["Asia/../Seoul", "Asia/./Seoul", "../Seoul"]) {
    assert.throws(() => validateTimezone(bad), /timezone_invalid/);
  }
  assert.equal(validateTimezone("Asia/Seoul"), "Asia/Seoul");
});

test("Hermes 설치는 게이트 셋이 모두 켜져야만 허용된다", () => {
  const full = { DESKRPG_HOST_SETUP_ENABLED: "1", DESKRPG_HERMES_INSTALL_ENABLED: "1" };
  assert.equal(hermesInstallAllowed(full, "system_admin", "local"), true);
  // 게이트를 하나씩 끄면 전부 거부된다.
  assert.equal(
    hermesInstallAllowed({ DESKRPG_HERMES_INSTALL_ENABLED: "1" }, "system_admin", "local"),
    false,
  );
  assert.equal(
    hermesInstallAllowed({ DESKRPG_HOST_SETUP_ENABLED: "1" }, "system_admin", "local"),
    false,
  );
  assert.equal(hermesInstallAllowed(full, "user", "local"), false);
  // SSH 대상이면 어떤 조합으로도 열리지 않는다.
  assert.equal(hermesInstallAllowed(full, "system_admin", "ssh"), false);
  assert.equal(hermesInstallAllowed(full, "system_admin", undefined), false);
});
test("프로필 이름은 소문자·숫자·하이픈 64자이고 예약어를 거부한다", () => {
  assert.equal(validateProfileName("sophie-2"), "sophie-2");
  assert.equal(validateProfileName(" sophie "), "sophie");
  for (const bad of [
    "Sophie",
    "-sophie",
    "so phie",
    "a".repeat(65),
    "",
    "default",
    "hermes",
    "root",
    "sudo",
    "tmp",
    "test",
    42,
  ])
    assert.throws(() => validateProfileName(bad), /profile_name_invalid/);
});
test("프로필 설명은 200자 이하 한 줄만 받는다", () => {
  assert.equal(validateProfileDescription("리서치 담당"), "리서치 담당");
  assert.equal(validateProfileDescription(undefined), undefined);
  assert.equal(validateProfileDescription("   "), undefined);
  for (const bad of ["x".repeat(201), "두\n줄", "캐리지\r리턴", 7])
    assert.throws(() => validateProfileDescription(bad), /profile_name_invalid/);
});
test("계약 2의 새 오류 코드는 그대로 통과하고 나머지는 setup_failed 다", () => {
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
  ])
    assert.equal(safeSetupError(new Error(code)), code);
  // 경고는 오류 경로에 오르지 않는다.
  for (const warning of ["profile_not_served", "model_provider_required"])
    assert.equal(safeSetupError(new Error(warning)), "setup_failed");
});
