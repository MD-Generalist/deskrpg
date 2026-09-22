/**
 * 런타임 홈을 준비하고, 거기 적힌 값 중 **환경에 없는 것만** `process.env` 로 올린다.
 *
 * 왜 서버 기동 경로에 있나: `ensureDeskRpgHome` 을 부르는 곳이 `deskrpg init` 하나뿐이던
 * 동안, 컨테이너에는 JWT_SECRET 을 만들 경로가 **아예 없었다.** 진입점이 자리표시자를
 * unset 해도 아무도 대신 만들지 않아 기동이 멈췄다(2026-09-16 Hostinger 실측).
 * 이제 npm(`deskrpg start`)·Docker·로컬 개발이 모두 같은 함수를 지난다.
 *
 * 우선순위는 세 단계다:
 *   1. 이미 설정된 환경변수      → 그대로 쓴다. **절대 덮지 않는다**
 *   2. 런타임 홈에 저장된 값      → 재시작·Update 를 견딘다(홈이 볼륨일 때)
 *   3. 둘 다 없으면              → `ensureDeskRpgHome` 이 만들어 홈에 적는다
 *
 * 빈 문자열은 "설정되지 않음" 으로 본다. 컨테이너 환경변수는 비어 있어도 정의되어 있어서,
 * 값이 있는지만 보면 빈 값이 홈 파일을 가려 버린다.
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { parseEnv } = require("node:util");

/** `KEY=value` 한 줄을 파싱한다. 주석·빈 줄·이상한 줄은 null. */
function parseEnvLine(line) {
  const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
  if (!match) return null;
  const [, key, rawValue] = match;
  return { key, value: rawValue.trim().replace(/^["']|["']$/g, "") };
}

/**
 * @param {string} text        런타임 홈의 env 파일 내용
 * @param {Record<string, string | undefined>} env  대상 환경(기본 `process.env`)
 * @returns {string[]} 실제로 채운 키 이름들
 */
function applyEnvText(text, env) {
  const applied = [];
  // Capture the incoming environment before reading the home file. A saved URL must not
  // override a saved SQLite selection, but an external URL outranks home defaults.
  const externalPostgres =
    Boolean(env.DATABASE_URL) &&
    (!env.DB_TYPE || ["postgresql", "postgres"].includes(env.DB_TYPE.toLowerCase()));
  // Keep Node's dotenv syntax (quoted # and multiline values) when the CLI uses this
  // loader instead of process.loadEnvFile. Older Node versions retain the fallback.
  const entries =
    typeof parseEnv === "function"
      ? Object.entries(parseEnv(text)).map(([key, value]) => ({ key, value }))
      : text.split(/\r?\n/).map(parseEnvLine).filter(Boolean);
  for (const parsed of entries) {
    if (externalPostgres && ["DB_TYPE", "SQLITE_PATH"].includes(parsed.key)) continue;
    const current = env[parsed.key];
    // 빈 문자열도 "없음" 으로 본다 — 그러지 않으면 빈 환경변수가 홈 파일을 가린다.
    if (current !== undefined && current !== "") continue;
    env[parsed.key] = parsed.value;
    applied.push(parsed.key);
  }
  return applied;
}

/**
 * @param {object} [options]
 * @param {string} [options.packageRoot]  `src/lib/runtime-paths.js` 를 찾을 기준 경로
 * @param {Record<string, string | undefined>} [options.env]
 * @param {(message: string) => void} [options.warn]
 * @returns {{ envPath: string | null, applied: string[] }}
 */
function bootstrapRuntimeEnv(options = {}) {
  const packageRoot = options.packageRoot || path.join(__dirname, "..", "..");
  const env = options.env || process.env;
  const warn = options.warn || ((message) => console.warn(message));

  let runtimePaths;
  try {
    runtimePaths = require(path.join(packageRoot, "src", "lib", "runtime-paths.js"));
  } catch {
    // 런타임 경로 모듈이 없는 빌드는 그대로 둔다 — 기동을 막을 이유가 없다.
    return { envPath: null, applied: [] };
  }

  let envPath;
  try {
    envPath = runtimePaths.ensureDeskRpgHome({ homeDir: env.DESKRPG_HOME }).envPath;
  } catch (err) {
    warn(`[startup] 런타임 홈을 준비하지 못했습니다: ${err.message}`);
    return { envPath: null, applied: [] };
  }

  let text;
  try {
    text = fs.readFileSync(envPath, "utf8");
  } catch (err) {
    warn(`[startup] 런타임 env 를 읽지 못했습니다: ${err.message}`);
    return { envPath, applied: [] };
  }

  return { envPath, applied: applyEnvText(text, env) };
}

module.exports = { bootstrapRuntimeEnv, applyEnvText, parseEnvLine };
