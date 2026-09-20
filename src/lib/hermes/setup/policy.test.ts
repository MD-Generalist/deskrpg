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
  validateSetupPort,
  collectSetupWarnings,
  SETUP_WARNING_CODES,
} from "./policy";

test("호스트 실행은 system_admin 이면 기본으로 열리고, 운영자가 0 으로 끌 수 있다", () => {
  // 2026-09-19 단테 결정: 관리자는 환경변수 없이 로컬·SSH 를 쓴다. 스위치는 거절용으로만 남는다.
  assert.equal(hostSetupAllowed({}, "system_admin"), true);
  assert.equal(hostSetupAllowed({}, "user"), false);
  assert.equal(hostSetupAllowed({}, undefined), false);
  for (const off of ["0", "false", "no", "off", " OFF "]) {
    assert.equal(hostSetupAllowed({ DESKRPG_HOST_SETUP_ENABLED: off }, "system_admin"), false, off);
  }
  assert.equal(hostSetupAllowed({ DESKRPG_HOST_SETUP_ENABLED: "1" }, "system_admin"), true);
  assert.equal(hostSetupAllowed({ DESKRPG_HOST_SETUP_ENABLED: "1" }, "user"), false);
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

test("Hermes 설치는 관리자에게 로컬·SSH 모두 기본으로 열리고, 스위치 둘 중 하나라도 0 이면 닫힌다", () => {
  assert.equal(hermesInstallAllowed({}, "system_admin", "local"), true);
  assert.equal(hermesInstallAllowed({}, "system_admin", "ssh"), true);
  assert.equal(hermesInstallAllowed({}, "user", "local"), false);
  assert.equal(
    hermesInstallAllowed({ DESKRPG_HERMES_INSTALL_ENABLED: "0" }, "system_admin", "local"),
    false,
  );
  assert.equal(
    hermesInstallAllowed({ DESKRPG_HOST_SETUP_ENABLED: "0" }, "system_admin", "ssh"),
    false,
  );
  // 대상이 없거나 모르는 모드면 열지 않는다.
  assert.equal(hermesInstallAllowed({}, "system_admin", undefined), false);
  assert.equal(hermesInstallAllowed({}, "system_admin", "url"), false);
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

test("Hermes 를 방금 설치했으면 모델 제공자 경고를 붙인다", () => {
  // 제공자가 하나도 없어도 /v1/models 는 200 과 모델 하나를 돌려준다(실측) —
  // 목록이 비었는지로는 판정할 수 없어 "설치했다" 는 사실을 신호로 쓴다.
  assert.deepEqual(collectSetupWarnings([], true), ["model_provider_required"]);
  assert.deepEqual(collectSetupWarnings(undefined, false), []);
});

test("호스트가 준 경고는 보존하고 중복은 접는다", () => {
  assert.deepEqual(collectSetupWarnings(["profile_not_served"], true), [
    "profile_not_served",
    "model_provider_required",
  ]);
  assert.deepEqual(collectSetupWarnings(["model_provider_required"], true), [
    "model_provider_required",
  ]);
});

test("모델 확인이 ready 면 설치 직후라도 경고가 사라진다", () => {
  // 확인이 가능하면 확인이 이긴다 — "설치했으니 경고" 는 추정일 뿐이다.
  assert.deepEqual(collectSetupWarnings([], true, "ready"), []);
  assert.deepEqual(collectSetupWarnings(["model_provider_required"], false, "ready"), []);
  assert.deepEqual(collectSetupWarnings(["profile_not_served"], true, "ready"), [
    "profile_not_served",
  ]);
});
test("모델 확인이 missing 이면 설치하지 않았어도 경고를 붙인다", () => {
  assert.deepEqual(collectSetupWarnings([], false, "missing"), ["model_provider_required"]);
  assert.deepEqual(collectSetupWarnings([], true, "missing"), ["model_provider_required"]);
});
test("판정이 unknown 이거나 없으면 기존 규칙 그대로다", () => {
  assert.deepEqual(collectSetupWarnings([], true, "unknown"), ["model_provider_required"]);
  assert.deepEqual(collectSetupWarnings([], false, "unknown"), []);
  assert.deepEqual(collectSetupWarnings([], false, undefined), []);
});
test("계약 3의 새 오류 코드도 화이트리스트를 통과한다", () => {
  assert.equal(safeSetupError(new Error("resume_unavailable")), "resume_unavailable");
});

test("수락한 포트는 1024~65535 정수만 통과한다", () => {
  assert.equal(validateSetupPort(8643), 8643);
  assert.equal(validateSetupPort(1024), 1024);
  assert.equal(validateSetupPort(65535), 65535);
  for (const value of [1023, 65536, 8643.5, "8643", null, undefined, NaN, Infinity])
    assert.throws(() => validateSetupPort(value), /setup_invalid_request/);
});
test("포트 쓰기 실패는 화이트리스트 코드로 그대로 나간다", () => {
  assert.equal(safeSetupError(new Error("port_write_failed")), "port_write_failed");
  assert.equal(safeSetupError(new Error("port_write_failed /home/op/.env")), "setup_failed");
});
test("logon_required 는 실패가 아니라 경고다", () => {
  assert.ok(SETUP_WARNING_CODES.has("logon_required"));
  assert.equal(safeSetupError(new Error("logon_required")), "setup_failed");
});
