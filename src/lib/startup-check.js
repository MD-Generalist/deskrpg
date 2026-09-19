// 기동·진단 시점의 환경 검증. server.js(커스텀 서버)와 bin/deskrpg.js(doctor)가 함께 쓴다.
// internal-transport.js 와 같은 CommonJS 형식이라 `require` 로도 `import` 로도 로드된다.
//
// 원칙: 비밀 값 자체는 절대 메시지에 싣지 않는다. 존재 여부와 길이만 말한다.

const POSTGRES_DB_TYPES = new Set(["postgresql", "postgres"]);
const DEFAULT_DB_PROBE_TIMEOUT_MS = 5000;

function readTrimmed(env, key) {
  const value = env[key];
  return typeof value === "string" ? value.trim() : "";
}

/**
 * 환경변수만 보고 기동을 막아야 할 문제(errors)와 알려야 할 문제(warnings)를 가른다.
 * 순수 함수 — process.env 를 읽지도, 쓰지도 않는다(기본값으로만 받는다).
 *
 * @param {Record<string, string | undefined>} env
 * @returns {{ errors: string[], warnings: string[], dbTarget: "postgresql" | "sqlite" }}
 */
/**
 * 이 컴퓨터에 Hermes 가 없으면 한 줄 알려 준다. Hermes 가 있으면 아무 말도 하지 않는다.
 *
 * 2026-09-19 부터 호스트 설정은 관리자에게 기본으로 열린다 — 연결 마법사의 "로컬 연결" 에서 설치할 수
 * 있다고 안내한다. 운영자가 스위치를 `0` 으로 꺼 두었으면 켜는 명령을 안내한다.
 *
 * @param {Record<string, string | undefined>} [env]
 * @param {string} [homeDir]
 * @returns {string | null}
 */
function hostSetupHint(env = process.env, homeDir = require("node:os").homedir()) {
  const fs = require("node:fs");
  const path = require("node:path");
  const off = (key) => ["0", "false", "no", "off"].includes((env[key] ?? "").trim().toLowerCase());
  try {
    if (fs.existsSync(path.join(homeDir, ".hermes", "hermes-agent"))) return null;
    // 결합 이미지(deskrpg-office)는 Hermes 를 같은 컨테이너에 담고 HERMES_HOME 으로 가리킨다.
    // 홈 밑의 `.hermes` 만 보면 그 환경에서 "Hermes 가 없다"고 잘못 알린다(실측: 컨테이너 부팅 로그).
    const hermesHome = (env.HERMES_HOME ?? "").trim();
    if (hermesHome && fs.existsSync(hermesHome)) return null;
    // 그 밖에도 PATH 에 hermes 가 있으면 이미 깔려 있는 것이다.
    const pathDirs = (env.PATH ?? "").split(path.delimiter).filter(Boolean);
    if (pathDirs.some((dir) => fs.existsSync(path.join(dir, "hermes")))) return null;
  } catch {
    return null;
  }
  if (off("DESKRPG_HOST_SETUP_ENABLED") || off("DESKRPG_HERMES_INSTALL_ENABLED"))
    return "이 컴퓨터에 Hermes 가 없습니다 — 연결 마법사로 함께 설치하려면 `deskrpg host-setup on --with-install` 을 실행한 뒤 다시 시작하세요.";
  return "이 컴퓨터에 Hermes 가 없습니다 — 관리자 계정으로 연결 → 새 게이트웨이 → 로컬 연결에서 설치할 수 있습니다.";
}

const { isPlaceholderSecret } = require("./runtime-paths.js");

function inspectEnvironment(env = process.env) {
  const errors = [];
  const warnings = [];

  const nodeEnv = readTrimmed(env, "NODE_ENV");
  const isProduction = nodeEnv === "production";
  const dbTypeRaw = readTrimmed(env, "DB_TYPE").toLowerCase();
  const databaseUrl = readTrimmed(env, "DATABASE_URL");
  const jwtSecret = readTrimmed(env, "JWT_SECRET");
  const internalRpcSecret = readTrimmed(env, "INTERNAL_RPC_SECRET");

  // src/db/index.ts 와 같은 판정 규칙을 쓴다: DB_TYPE || (DATABASE_URL ? postgresql : sqlite)
  const effectiveDbType = dbTypeRaw || (databaseUrl ? "postgresql" : "sqlite");
  const dbTarget = POSTGRES_DB_TYPES.has(effectiveDbType) ? "postgresql" : "sqlite";

  // `.env.example` 에서 그대로 옮겨 온 안내 문구는 비밀이 아니다. 공개된 값으로 세션 토큰을
  // 서명하면 누구나 남의 세션을 위조할 수 있으므로, 비어 있는 것과 똑같이 막는다.
  const jwtIsPlaceholder = Boolean(jwtSecret) && isPlaceholderSecret(jwtSecret);
  if (!jwtSecret || jwtIsPlaceholder) {
    const what = jwtIsPlaceholder
      ? "JWT_SECRET 이 `.env.example` 의 자리표시자 그대로입니다"
      : "JWT_SECRET 이 비어 있습니다";
    if (isProduction) {
      errors.push(
        `${what} — 프로덕션에서 로그인 토큰을 서명할 수 없습니다. .env.local 에 충분히 긴 임의 문자열로 JWT_SECRET 을 설정한 뒤 다시 기동하세요(\`openssl rand -hex 32\`).`,
      );
    } else {
      warnings.push(
        `${what} — 개발 모드에서만 넘어갑니다. 배포 전에 .env.local 에 JWT_SECRET 을 설정하세요.`,
      );
    }
  }

  if (POSTGRES_DB_TYPES.has(dbTypeRaw) && !databaseUrl) {
    errors.push(
      `DB_TYPE=${dbTypeRaw} 로 지정됐는데 DATABASE_URL 이 없어 접속할 곳이 없습니다 — DATABASE_URL 을 채우거나 DB_TYPE 을 지우고 SQLite 로 동작시키세요.`,
    );
  }

  if (!databaseUrl && !dbTypeRaw) {
    warnings.push(
      "DATABASE_URL 도 DB_TYPE 도 없어 PostgreSQL 이 아니라 SQLite 로 동작합니다 — PostgreSQL 을 쓸 생각이었다면 DATABASE_URL 을 설정하세요.",
    );
  }

  if (!internalRpcSecret && jwtSecret) {
    warnings.push(
      `INTERNAL_RPC_SECRET 이 없어 내부 RPC 인증이 JWT_SECRET(${jwtSecret.length}자) 으로 대체됩니다 — 두 비밀을 분리하려면 INTERNAL_RPC_SECRET 을 따로 설정하세요.`,
    );
  }

  if (!internalRpcSecret && !jwtSecret) {
    warnings.push(
      "INTERNAL_RPC_SECRET 과 JWT_SECRET 이 모두 비어 내부 RPC 요청이 전부 403 으로 거부됩니다 — 둘 중 하나는 반드시 설정하세요.",
    );
  }

  return { errors, warnings, dbTarget };
}

/**
 * 오류를 한 조각의 사람이 읽을 문자열로. `pg` 는 메시지가 빈 오류를 던지는 경로가 있어
 * (실측: 접속 실패 시 `(  )` 만 찍혔다) code·name 까지 훑어 빈 괄호를 만들지 않는다.
 */
function describeError(error) {
  if (!error) return "원인 불명";
  if (typeof error === "string") return error || "원인 불명";
  const message = typeof error.message === "string" ? error.message.trim() : "";
  if (message) return message;
  const code = typeof error.code === "string" ? error.code : "";
  const name = typeof error.name === "string" ? error.name : "";
  return code || name || "원인 불명";
}

async function probePostgres(databaseUrl, timeoutMs) {
  const { Client } = require("pg");
  const client = new Client({
    connectionString: databaseUrl,
    connectionTimeoutMillis: timeoutMs,
    query_timeout: timeoutMs,
    statement_timeout: timeoutMs,
  });

  let timer = null;
  try {
    await Promise.race([
      (async () => {
        await client.connect();
        await client.query("SELECT 1");
      })(),
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${timeoutMs}ms 안에 응답이 없었습니다`)),
          timeoutMs,
        );
      }),
    ]);
    return {
      ok: true,
      target: "postgresql",
      message: "PostgreSQL 에 접속해 SELECT 1 을 확인했습니다.",
    };
  } catch (error) {
    return {
      ok: false,
      target: "postgresql",
      message: `PostgreSQL 에 접속하지 못했습니다(${describeError(error)}) — DATABASE_URL 의 호스트·포트·계정과 DB 기동 상태를 확인하세요.`,
    };
  } finally {
    if (timer) clearTimeout(timer);
    try {
      await client.end();
    } catch {
      // 접속조차 못 했으면 end() 도 실패한다 — 진단 결과에 영향을 주지 않는다.
    }
  }
}

async function probeSqlite(sqlitePath) {
  const fs = require("node:fs");
  const path = require("node:path");

  if (!sqlitePath) {
    return {
      ok: false,
      target: "sqlite",
      message:
        "SQLite 파일 경로를 알 수 없습니다 — SQLITE_PATH 를 설정하거나 deskrpg init 를 먼저 실행하세요.",
    };
  }

  try {
    await fs.promises.access(sqlitePath, fs.constants.R_OK | fs.constants.W_OK);
    return {
      ok: true,
      target: "sqlite",
      message: `SQLite 파일을 읽고 쓸 수 있습니다: ${sqlitePath}`,
    };
  } catch {
    // 파일이 아직 없는 것은 정상일 수 있다 — 부모 디렉터리에 쓸 수 있으면 부팅 시 만들어진다.
    try {
      await fs.promises.access(path.dirname(sqlitePath), fs.constants.W_OK);
      return {
        ok: true,
        target: "sqlite",
        message: `SQLite 파일이 아직 없지만 기동 시 생성됩니다: ${sqlitePath}`,
      };
    } catch {
      return {
        ok: false,
        target: "sqlite",
        message: `SQLite 파일과 그 디렉터리에 접근할 수 없습니다: ${sqlitePath} — 경로와 권한을 확인하거나 deskrpg init 를 실행하세요.`,
      };
    }
  }
}

/**
 * DB 에 실제로 닿는지 확인한다. 절대 throw 하지 않고 결과 객체를 돌려준다.
 *
 * @param {{ databaseUrl?: string, sqlitePath?: string, target?: "postgresql" | "sqlite", timeoutMs?: number }} options
 * @returns {Promise<{ ok: boolean, target: "postgresql" | "sqlite", message: string }>}
 */
async function checkDatabaseReachable(options = {}) {
  const { databaseUrl, sqlitePath, target, timeoutMs = DEFAULT_DB_PROBE_TIMEOUT_MS } = options;

  // 어느 DB 를 찌를지는 앱이 실제로 쓰는 것과 같아야 한다. `deskrpg init` 은 .env.example 을
  // 복사하므로 SQLite 런타임에도 PostgreSQL DATABASE_URL 줄이 남아 있다 — URL 유무로 정하면
  // SQLite 사용자에게 "PostgreSQL 접속 실패" 라는 거짓 진단을 낸다(실측).
  const resolved = target || (databaseUrl ? "postgresql" : "sqlite");

  try {
    if (resolved === "postgresql") {
      if (!databaseUrl) {
        return {
          ok: false,
          target: "postgresql",
          message:
            "DB_TYPE=postgresql 인데 DATABASE_URL 이 없어 접속할 곳이 없습니다 — DATABASE_URL 을 채우세요.",
        };
      }
      return await probePostgres(databaseUrl, timeoutMs);
    }
    return await probeSqlite(sqlitePath);
  } catch (error) {
    return {
      ok: false,
      target: resolved,
      message: `데이터베이스 확인 중 예상치 못한 오류가 났습니다(${describeError(error)}) — 드라이버 설치 상태를 확인하세요.`,
    };
  }
}

/**
 * 포트가 이미 점유됐는지 본다. 점유 중이면 { free: false }.
 *
 * @param {number} port
 * @param {string} [host]
 * @returns {Promise<{ free: boolean, message: string }>}
 */
function checkPortAvailable(port, host = "0.0.0.0") {
  const net = require("node:net");

  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", (error) => {
      if (error && error.code === "EADDRINUSE") {
        resolve({
          free: false,
          message: `포트 ${port} 을 이미 다른 프로세스가 쓰고 있습니다 — deskrpg stop 으로 멈추거나 deskrpg start -p 다른포트 로 띄우세요.`,
        });
        return;
      }
      const reason = error instanceof Error ? error.message : String(error);
      resolve({ free: true, message: `포트 ${port} 점유 여부를 확인하지 못했습니다(${reason}).` });
    });
    server.once("listening", () => {
      server.close(() => resolve({ free: true, message: `포트 ${port} 가 비어 있습니다.` }));
    });
    server.listen(port, host);
  });
}

/**
 * inspectEnvironment 결과를 사람이 읽는 줄로 찍는다.
 *
 * @returns {boolean} errors 가 하나라도 있으면 false
 */
function reportEnvironmentInspection(inspection, logger = console) {
  for (const warning of inspection.warnings) {
    logger.warn(`[startup] 경고: ${warning}`);
  }
  for (const error of inspection.errors) {
    logger.error(`[startup] 실패: ${error}`);
  }
  return inspection.errors.length === 0;
}

module.exports = {
  DEFAULT_DB_PROBE_TIMEOUT_MS,
  checkDatabaseReachable,
  checkPortAvailable,
  hostSetupHint,
  inspectEnvironment,
  reportEnvironmentInspection,
};
