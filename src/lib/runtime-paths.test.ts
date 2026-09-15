import assert from "node:assert/strict";
import test from "node:test";

test("runtime paths resolve under DESKRPG_HOME when provided", async () => {
  process.env.DESKRPG_HOME = "/tmp/deskrpg-home";

  const runtimePaths = await import("./runtime-paths");

  assert.equal(runtimePaths.getDeskRpgHomeDir(), "/tmp/deskrpg-home");
  assert.equal(runtimePaths.getDeskRpgEnvPath(), "/tmp/deskrpg-home/.env.local");
  assert.equal(runtimePaths.getDeskRpgDataDir(), "/tmp/deskrpg-home/data");
  assert.equal(runtimePaths.getDeskRpgSqlitePath(), "/tmp/deskrpg-home/data/deskrpg.db");
  assert.equal(runtimePaths.getDeskRpgUploadsDir(), "/tmp/deskrpg-home/uploads");
  assert.equal(runtimePaths.getDeskRpgLogsDir(), "/tmp/deskrpg-home/logs");
});

test("`.env.example` 의 자리표시자 JWT_SECRET 은 임의 값으로 바뀐다", async () => {
  const fs = await import("node:fs");
  const os = await import("node:os");
  const path = await import("node:path");

  const home = fs.mkdtempSync(path.join(os.tmpdir(), "deskrpg-home-"));
  const example = path.join(home, ".env.example");
  fs.writeFileSync(example, "JWT_SECRET=change-me-to-a-random-64-char-string\n");

  const runtimePaths = await import("./runtime-paths");
  runtimePaths.ensureDeskRpgHome({ homeDir: home, envExamplePath: example });

  const envText = fs.readFileSync(path.join(home, ".env.local"), "utf8");
  const value = /^JWT_SECRET=(.*)$/m.exec(envText)?.[1] ?? "";
  assert.notEqual(value, "change-me-to-a-random-64-char-string");
  assert.equal(value.length, 48, "randomBytes(24).toString('hex') 길이");

  // 두 번째 호출은 이미 만들어 둔 진짜 비밀을 건드리지 않는다.
  runtimePaths.ensureDeskRpgHome({ homeDir: home, envExamplePath: example });
  const again = fs.readFileSync(path.join(home, ".env.local"), "utf8");
  assert.equal(/^JWT_SECRET=(.*)$/m.exec(again)?.[1], value);

  fs.rmSync(home, { recursive: true, force: true });
});

test("자리표시자 판정은 안내 문구와 너무 짧은 값을 잡는다", async () => {
  const { isPlaceholderSecret } = await import("./runtime-paths");
  for (const placeholder of [
    "",
    "short",
    "change-me-to-a-random-64-char-string",
    "CHANGE_THIS_SECRET_PLEASE_NOW_OK",
    "your-secret-goes-right-here-ok",
  ]) {
    assert.equal(isPlaceholderSecret(placeholder), true, placeholder);
  }
  assert.equal(isPlaceholderSecret("a".repeat(48)), false);
});
