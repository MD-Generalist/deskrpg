const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { bootstrapRuntimeEnv, applyEnvText, parseEnvLine } = require("./runtime-env-bootstrap.js");

const PACKAGE_ROOT = path.join(__dirname, "..", "..");

function tmpHome(label) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `deskrpg-envboot-${label}-`));
}

test("KEY=value 를 파싱하고 주석·빈 줄은 무시한다", () => {
  assert.deepEqual(parseEnvLine("FOO=bar"), { key: "FOO", value: "bar" });
  assert.deepEqual(parseEnvLine('QUOTED="hello"'), { key: "QUOTED", value: "hello" });
  assert.equal(parseEnvLine("# FOO=bar"), null);
  assert.equal(parseEnvLine(""), null);
  assert.equal(parseEnvLine("not an assignment"), null);
});

test("이미 설정된 값은 덮지 않는다 — 사용자가 직접 넣은 값이 이긴다", () => {
  const env = { KEEP: "user-value" };
  const applied = applyEnvText("KEEP=file-value\nNEW=from-file\n", env);
  assert.equal(env.KEEP, "user-value");
  assert.equal(env.NEW, "from-file");
  assert.deepEqual(applied, ["NEW"]);
});

test("빈 문자열은 '설정되지 않음' 으로 본다", () => {
  // 컨테이너 환경변수는 비어 있어도 정의돼 있다. 값이 있는지만 보면 빈 값이 홈 파일을 가린다.
  const env = { BLANK: "" };
  applyEnvText("BLANK=from-file\n", env);
  assert.equal(env.BLANK, "from-file");
});

test("런타임 홈에 JWT_SECRET 을 만들어 적고 환경에 올린다", () => {
  const homeDir = tmpHome("gen");
  try {
    const env = { DESKRPG_HOME: homeDir };
    const result = bootstrapRuntimeEnv({ packageRoot: PACKAGE_ROOT, env, warn() {} });
    assert.ok(result.envPath, "envPath 가 있어야 한다");
    assert.ok(env.JWT_SECRET, "JWT_SECRET 이 채워져야 한다");
    assert.ok(env.JWT_SECRET.length >= 24, `너무 짧다: ${env.JWT_SECRET.length}`);
    // 홈 파일에도 남아야 다음 기동에서 같은 키를 쓴다.
    assert.match(fs.readFileSync(result.envPath, "utf8"), /^JWT_SECRET=.+$/m);
  } finally {
    fs.rmSync(homeDir, { recursive: true, force: true });
  }
});

test("같은 홈으로 다시 부르면 키가 그대로다 — Update 로 재생성돼도 로그아웃되지 않는다", () => {
  const homeDir = tmpHome("stable");
  try {
    const first = { DESKRPG_HOME: homeDir };
    bootstrapRuntimeEnv({ packageRoot: PACKAGE_ROOT, env: first, warn() {} });
    const second = { DESKRPG_HOME: homeDir };
    bootstrapRuntimeEnv({ packageRoot: PACKAGE_ROOT, env: second, warn() {} });
    assert.equal(first.JWT_SECRET, second.JWT_SECRET);
  } finally {
    fs.rmSync(homeDir, { recursive: true, force: true });
  }
});

test("사용자가 넣은 JWT_SECRET 은 생성값으로 덮이지 않는다", () => {
  const homeDir = tmpHome("user");
  try {
    const env = { DESKRPG_HOME: homeDir, JWT_SECRET: "my-production-key-9f3a2b7c1d4e6f8a" };
    bootstrapRuntimeEnv({ packageRoot: PACKAGE_ROOT, env, warn() {} });
    assert.equal(env.JWT_SECRET, "my-production-key-9f3a2b7c1d4e6f8a");
  } finally {
    fs.rmSync(homeDir, { recursive: true, force: true });
  }
});

test("런타임 경로 모듈이 없으면 조용히 넘어간다 — 기동을 막지 않는다", () => {
  const env = {};
  const result = bootstrapRuntimeEnv({
    packageRoot: path.join(os.tmpdir(), "deskrpg-does-not-exist"),
    env,
    warn() {},
  });
  assert.equal(result.envPath, null);
  assert.deepEqual(result.applied, []);
});

for (const dbType of [undefined, "", "postgresql", "postgres", "sqlite"]) {
  test(`external DATABASE_URL preserves explicit DB_TYPE=${String(dbType)}`, () => {
    const env = { DATABASE_URL: "postgresql://localhost/test", DB_TYPE: dbType };
    applyEnvText("DB_TYPE=sqlite\nSQLITE_PATH=/saved/custom.db\n", env);
    assert.equal(env.DB_TYPE, dbType);
    assert.equal(env.SQLITE_PATH, dbType === "sqlite" ? "/saved/custom.db" : undefined);
  });
}

test("saved SQLite configuration survives bootstrap and a restart", () => {
  const homeDir = tmpHome("sqlite-preserved");
  try {
    const envPath = path.join(homeDir, ".env.local");
    const sqlitePath = path.join(homeDir, "custom.db");
    fs.writeFileSync(sqlitePath, "existing user data");
    fs.writeFileSync(envPath, `DB_TYPE=sqlite\nSQLITE_PATH=${sqlitePath}\n`);
    for (let i = 0; i < 2; i++) {
      const env = { DESKRPG_HOME: homeDir };
      bootstrapRuntimeEnv({ packageRoot: PACKAGE_ROOT, env });
      assert.equal(env.DB_TYPE, "sqlite");
      assert.equal(env.SQLITE_PATH, sqlitePath);
      assert.equal(fs.readFileSync(sqlitePath, "utf8"), "existing user data");
    }
  } finally {
    fs.rmSync(homeDir, { recursive: true, force: true });
  }
});

for (const text of [
  "DATABASE_URL=postgresql://localhost/saved\nDB_TYPE=sqlite\nSQLITE_PATH=/saved.db\n",
  "DB_TYPE=sqlite\nSQLITE_PATH=/saved.db\nDATABASE_URL=postgresql://localhost/saved\n",
]) {
  test("a saved URL does not override the saved SQLite choice regardless of line order", () => {
    const env = {};
    applyEnvText(text, env);
    assert.equal(env.DB_TYPE, "sqlite");
    assert.equal(env.SQLITE_PATH, "/saved.db");
  });
}

test("PostgreSQL override leaves saved SQLite settings and data untouched", () => {
  const homeDir = tmpHome("override");
  try {
    const envPath = path.join(homeDir, ".env.local");
    const sqlitePath = path.join(homeDir, "custom.db");
    fs.writeFileSync(sqlitePath, "existing data");
    const saved = `DB_TYPE=sqlite\nSQLITE_PATH=${sqlitePath}\nJWT_SECRET=${"a".repeat(48)}\n`;
    fs.writeFileSync(envPath, saved);
    const env = { DESKRPG_HOME: homeDir, DATABASE_URL: "postgresql://localhost/test" };
    bootstrapRuntimeEnv({ packageRoot: PACKAGE_ROOT, env });
    assert.equal(env.DB_TYPE, undefined);
    assert.equal(env.SQLITE_PATH, undefined);
    assert.match(fs.readFileSync(envPath, "utf8"), /DB_TYPE=sqlite/);
    assert.ok(fs.readFileSync(envPath, "utf8").includes(`SQLITE_PATH=${sqlitePath}`));
    assert.equal(fs.readFileSync(sqlitePath, "utf8"), "existing data");
  } finally {
    fs.rmSync(homeDir, { recursive: true, force: true });
  }
});

test(
  "native dotenv syntax survives CLI environment loading",
  { skip: typeof require("node:util").parseEnv !== "function" },
  () => {
    const env = {};
    applyEnvText(
      'PLAIN=value # comment\nQUOTED="value # literal"\nMULTILINE="first\nsecond"\n',
      env,
    );
    assert.deepEqual(env, {
      PLAIN: "value",
      QUOTED: "value # literal",
      MULTILINE: "first\nsecond",
    });
  },
);
