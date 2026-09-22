import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

type DeskRpgHomeOptions = {
  homeDir?: string;
  envExamplePath?: string;
};

function upsertEnvLine(envText: string, key: string, value: string) {
  const line = `${key}=${value}`;
  const pattern = new RegExp(`^#?\\s*${key}=.*$`, "m");

  if (pattern.test(envText)) {
    return envText.replace(pattern, line);
  }

  const normalized = envText.endsWith("\n") || envText.length === 0 ? envText : `${envText}\n`;
  return `${normalized}${line}\n`;
}

export function getDeskRpgHomeDir(options: DeskRpgHomeOptions = {}) {
  return options.homeDir || process.env.DESKRPG_HOME || path.join(os.homedir(), ".deskrpg");
}

export function getDeskRpgEnvPath(options: DeskRpgHomeOptions = {}) {
  return path.join(getDeskRpgHomeDir(options), ".env.local");
}

export function getDeskRpgDataDir(options: DeskRpgHomeOptions = {}) {
  return path.join(getDeskRpgHomeDir(options), "data");
}

export function getDeskRpgSqlitePath(options: DeskRpgHomeOptions = {}) {
  return path.join(getDeskRpgDataDir(options), "deskrpg.db");
}

export function getDeskRpgUploadsDir(options: DeskRpgHomeOptions = {}) {
  return path.join(getDeskRpgHomeDir(options), "uploads");
}

export function getDeskRpgLogsDir(options: DeskRpgHomeOptions = {}) {
  return path.join(getDeskRpgHomeDir(options), "logs");
}

export function getDeskRpgTemplateUploadDir(templateId: string, options: DeskRpgHomeOptions = {}) {
  return path.join(getDeskRpgUploadsDir(options), templateId);
}

/**
 * 사람이 채우라고 적어 둔 자리표시자인가. `.env.example` 의 안내 문구와, 그 문구를 조금 고쳤을
 * 뿐인 값들을 잡는다. 진짜 비밀로 쓰기에 너무 짧은 값도 자리표시자로 본다.
 */
export function isPlaceholderSecret(value: string): boolean {
  const normalized = value.trim().replace(/^["']|["']$/g, "");
  if (normalized.length < 24) return true;
  // 접두사만 보면 `deskrpg-change-this-secret-…` 같은 우리 자신의 기본값을 놓친다.
  // 48자라 길이 검사도 통과해, 손대지 않은 설치가 공개된 키로 조용히 뜬다(2026-09-16 실측).
  if (/change[-_ ]?(me|this)/i.test(normalized)) return true;
  // `my` 는 뺐다. `my-production-key-…` 같은 **진짜** 사용자 키를 자리표시자로 판정해
  // 런타임이 덮어써 버린다 — 사용자가 직접 넣은 값이 이기는 것이 이 함수의 전제다.
  // 우리 안내 문구 중 `my` 로 시작하는 것은 없다.
  return /^(change|replace|set|your|example|placeholder|todo|fixme|insert)[-_ ]?/i.test(normalized);
}

export function ensureDeskRpgHome(options: DeskRpgHomeOptions = {}) {
  const homeDir = getDeskRpgHomeDir(options);
  const envPath = getDeskRpgEnvPath(options);
  const dataDir = getDeskRpgDataDir(options);
  const uploadsDir = getDeskRpgUploadsDir(options);
  const logsDir = getDeskRpgLogsDir(options);
  const sqlitePath = getDeskRpgSqlitePath(options);

  fs.mkdirSync(homeDir, { recursive: true });
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(uploadsDir, { recursive: true });
  fs.mkdirSync(logsDir, { recursive: true });

  if (!fs.existsSync(envPath)) {
    if (options.envExamplePath && fs.existsSync(options.envExamplePath)) {
      fs.copyFileSync(options.envExamplePath, envPath);
    } else {
      fs.writeFileSync(envPath, "");
    }
  }

  let envText = fs.readFileSync(envPath, "utf8");
  // Fill defaults only; startup must preserve the user's saved dialect and data path.
  for (const [key, fallback] of [
    ["DB_TYPE", "sqlite"],
    ["SQLITE_PATH", sqlitePath],
  ]) {
    const saved = envText.match(new RegExp(`^\\s*${key}=(.*)$`, "m"));
    if (!saved?.[1].trim().replace(/^["']|["']$/g, "")) {
      envText = upsertEnvLine(envText, key, fallback);
    }
  }

  // `.env.example` 를 복사해 온 런타임은 JWT_SECRET 자리에 안내 문구가 들어 있다. 값이 비어
  // 있는지만 보면 그 안내 문구를 진짜 비밀로 착각해, 모든 설치가 공개된 같은 키로 세션 토큰을
  // 서명하고 게이트웨이 토큰을 암호화한다. 자리표시자는 값이 없는 것과 똑같이 취급한다.
  const jwtLine = envText.match(/^#?\s*JWT_SECRET=(.*)$/m);
  const jwtValue = jwtLine ? jwtLine[1].trim() : "";
  if (!jwtValue || isPlaceholderSecret(jwtValue)) {
    envText = upsertEnvLine(envText, "JWT_SECRET", crypto.randomBytes(24).toString("hex"));
  }

  // Standalone (non-Docker) runs on HTTP localhost — secure cookies must be off
  // so browsers accept the Set-Cookie header.
  const hasCookieSecure = /^#?\s*COOKIE_SECURE=.*$/m.test(envText);
  if (!hasCookieSecure) {
    envText = upsertEnvLine(envText, "COOKIE_SECURE", "false");
  }

  fs.writeFileSync(envPath, envText);

  return {
    homeDir,
    envPath,
    dataDir,
    uploadsDir,
    logsDir,
    sqlitePath,
  };
}
