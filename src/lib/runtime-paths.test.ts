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
    // 우리 자신의 compose 기본값. `deskrpg-` 로 시작해 접두사 검사를 빠져나가고 48자라
    // 길이 검사도 통과했다 — 손대지 않은 Hostinger 배포가 전부 이 공개 키로 세션 토큰을
    // 서명하고 있었다(2026-09-16 실측). 접두사가 아니라 어디에 있든 잡는다.
    "deskrpg-change-this-secret-before-inviting-anyone",
    "prod-CHANGE-ME-later-abcdefghijklmnop",
  ]) {
    assert.equal(isPlaceholderSecret(placeholder), true, placeholder);
  }
  assert.equal(isPlaceholderSecret("a".repeat(48)), false);
  // 진짜 난수는 통과해야 한다 — 사용자가 직접 넣은 값을 런타임이 덮어쓰면 안 된다.
  assert.equal(isPlaceholderSecret("a3f9c1e07b2d48a6f5c1e9d720b4a8c6"), false);
  // `my` 로 시작하는 진짜 키도 통과해야 한다. 접두사 목록에 `my` 가 있던 동안에는
  // 사용자가 직접 넣은 값을 런타임이 자리표시자로 보고 덮어썼다.
  assert.equal(isPlaceholderSecret("my-production-key-9f3a2b7c1d4e6f8a"), false);
});
