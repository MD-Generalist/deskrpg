import test from "node:test";
import assert from "node:assert/strict";
import { hostSetupAllowed, sameOriginMutation, validateGatewayUrl, safeSetupError } from "./policy";

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
