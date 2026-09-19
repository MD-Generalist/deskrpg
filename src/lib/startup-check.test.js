import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import startupCheck from "./startup-check.js";

const { checkDatabaseReachable, inspectEnvironment, hostSetupHint } = startupCheck;

/** 이 테스트가 보려는 변수 외에는 전부 채워 둔다 — 무관한 경고가 섞이지 않게. */
function baseEnv(overrides = {}) {
  return {
    JWT_SECRET: "x".repeat(32),
    INTERNAL_RPC_SECRET: "y".repeat(32),
    ...overrides,
  };
}

test("프로덕션에서 JWT_SECRET 이 비면 기동을 막는 오류다", () => {
  const result = inspectEnvironment(baseEnv({ NODE_ENV: "production", JWT_SECRET: "" }));
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0], /JWT_SECRET/);
});

test("개발 모드에서 JWT_SECRET 이 비면 경고에 그친다", () => {
  const result = inspectEnvironment(baseEnv({ NODE_ENV: "development", JWT_SECRET: "" }));
  assert.deepEqual(result.errors, []);
  assert.ok(result.warnings.some((line) => line.includes("JWT_SECRET")));
});

test("DB_TYPE 이 postgresql 인데 DATABASE_URL 이 없으면 오류다", () => {
  const result = inspectEnvironment(baseEnv({ DB_TYPE: "postgresql" }));
  assert.equal(result.dbTarget, "postgresql");
  assert.ok(result.errors.some((line) => line.includes("DATABASE_URL")));
});

test("DB_TYPE=postgres 표기도 같은 오류로 잡는다", () => {
  const result = inspectEnvironment(baseEnv({ DB_TYPE: "POSTGRES" }));
  assert.equal(result.dbTarget, "postgresql");
  assert.equal(result.errors.length, 1);
});

test("DATABASE_URL 도 DB_TYPE 도 없으면 SQLite 전환을 경고로 드러낸다", () => {
  const result = inspectEnvironment(baseEnv());
  assert.deepEqual(result.errors, []);
  assert.equal(result.dbTarget, "sqlite");
  assert.ok(result.warnings.some((line) => line.includes("SQLite")));
});

test("DATABASE_URL 만 있으면 PostgreSQL 대상이고 경고가 없다", () => {
  const result = inspectEnvironment(
    baseEnv({ DATABASE_URL: "postgresql://user:pw@localhost:5432/deskrpg" }),
  );
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.warnings, []);
  assert.equal(result.dbTarget, "postgresql");
});

test("DB_TYPE=sqlite 를 명시하면 조용한 전환 경고를 내지 않는다", () => {
  const result = inspectEnvironment(baseEnv({ DB_TYPE: "sqlite" }));
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.warnings, []);
  assert.equal(result.dbTarget, "sqlite");
});

test("INTERNAL_RPC_SECRET 이 없어 JWT_SECRET 으로 대체되면 경고한다", () => {
  const result = inspectEnvironment(baseEnv({ INTERNAL_RPC_SECRET: "" }));
  assert.deepEqual(result.errors, []);
  assert.ok(result.warnings.some((line) => line.includes("INTERNAL_RPC_SECRET")));
});

test("경고 문구에 비밀 값 자체는 들어가지 않고 길이만 들어간다", () => {
  const secret = "supersecretvalue-do-not-print";
  const result = inspectEnvironment({ JWT_SECRET: secret });
  const joined = [...result.errors, ...result.warnings].join("\n");
  assert.ok(!joined.includes(secret));
  assert.ok(joined.includes(`${secret.length}자`));
});

test("두 비밀이 모두 비면 내부 RPC 가 전부 거부된다고 경고한다", () => {
  const result = inspectEnvironment({ NODE_ENV: "development" });
  assert.ok(result.warnings.some((line) => line.includes("403")));
});

test("공백만 든 값은 비어 있는 것으로 취급한다", () => {
  const result = inspectEnvironment({ NODE_ENV: "production", JWT_SECRET: "   " });
  assert.ok(result.errors.some((line) => line.includes("JWT_SECRET")));
});

test("DB 도달성 확인은 실패해도 throw 하지 않고 결과 객체를 준다", async () => {
  const result = await checkDatabaseReachable({ sqlitePath: "/definitely/missing/dir/deskrpg.db" });
  assert.equal(result.ok, false);
  assert.equal(result.target, "sqlite");
  assert.ok(result.message.length > 0);
});

test("SQLite 파일이 없어도 부모 디렉터리에 쓸 수 있으면 통과한다", async () => {
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const result = await checkDatabaseReachable({
    sqlitePath: join(tmpdir(), `deskrpg-startup-check-${process.pid}.db`),
  });
  assert.equal(result.ok, true);
});

test("SQLite 런타임에 옛 DATABASE_URL 이 남아 있어도 SQLite 를 찌른다", async () => {
  // deskrpg init 는 .env.example 을 복사하므로 SQLite 홈에도 PostgreSQL URL 줄이 남는다.
  // URL 유무로 대상을 정하면 멀쩡한 SQLite 사용자에게 "PostgreSQL 접속 실패" 가 뜬다(실측).
  const result = await checkDatabaseReachable({
    databaseUrl: "postgresql://nobody@127.0.0.1:1/none",
    sqlitePath: path.join(os.tmpdir(), "deskrpg-startup-check-probe.db"),
    target: "sqlite",
  });
  assert.equal(result.target, "sqlite");
  assert.equal(result.ok, true);
});

test("PostgreSQL 대상인데 URL 이 없으면 찌르지 않고 실패로 알린다", async () => {
  const result = await checkDatabaseReachable({ target: "postgresql" });
  assert.equal(result.ok, false);
  assert.equal(result.target, "postgresql");
  assert.match(result.message, /DATABASE_URL/);
});

test("Hermes 가 없으면 연결 마법사에서 설치할 수 있다고 알린다(기본 켜짐)", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "deskrpg-hint-"));
  assert.match(String(startupCheck.hostSetupHint({ PATH: "" }, home)), /로컬 연결에서 설치/);
});

test("운영자가 스위치를 꺼 두었으면 켜는 명령을 알린다", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "deskrpg-hint-"));
  for (const env of [
    { DESKRPG_HOST_SETUP_ENABLED: "0" },
    { DESKRPG_HERMES_INSTALL_ENABLED: "off" },
  ]) {
    assert.match(
      String(startupCheck.hostSetupHint({ ...env, PATH: "" }, home)),
      /host-setup on --with-install/,
    );
  }
});

test("Hermes 가 이미 있으면 조용하다", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "deskrpg-hint-"));
  fs.mkdirSync(path.join(home, ".hermes", "hermes-agent"), { recursive: true });
  assert.equal(startupCheck.hostSetupHint({}, home), null);
});

test("HERMES_HOME 이 있는 결합 이미지에서는 Hermes 설치 안내를 내지 않는다", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hermes-home-"));
  const emptyHome = fs.mkdtempSync(path.join(os.tmpdir(), "user-home-"));
  try {
    assert.equal(hostSetupHint({ HERMES_HOME: dir, PATH: "" }, emptyHome), null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(emptyHome, { recursive: true, force: true });
  }
});

test("PATH 에 hermes 가 있으면 설치 안내를 내지 않는다", () => {
  const binDir = fs.mkdtempSync(path.join(os.tmpdir(), "hermes-bin-"));
  const emptyHome = fs.mkdtempSync(path.join(os.tmpdir(), "user-home-"));
  fs.writeFileSync(path.join(binDir, "hermes"), "#!/bin/sh\n");
  try {
    assert.equal(hostSetupHint({ PATH: binDir }, emptyHome), null);
  } finally {
    fs.rmSync(binDir, { recursive: true, force: true });
    fs.rmSync(emptyHome, { recursive: true, force: true });
  }
});

test("Hermes 가 어디에도 없으면 설치 안내를 낸다", () => {
  const emptyHome = fs.mkdtempSync(path.join(os.tmpdir(), "user-home-"));
  const missing = path.join(emptyHome, "nope");
  try {
    const hint = hostSetupHint({ HERMES_HOME: missing, PATH: missing }, emptyHome);
    assert.match(String(hint), /Hermes 가 없습니다/);
  } finally {
    fs.rmSync(emptyHome, { recursive: true, force: true });
  }
});

test("자리표시자 JWT_SECRET 은 프로덕션에서 기동을 막는다", () => {
  const result = inspectEnvironment(
    baseEnv({ NODE_ENV: "production", JWT_SECRET: "change-me-to-a-random-64-char-string" }),
  );
  assert.ok(
    result.errors.some((line) => line.includes("자리표시자")),
    `errors: ${JSON.stringify(result.errors)}`,
  );
});
