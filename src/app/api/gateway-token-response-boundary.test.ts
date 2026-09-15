import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

/**
 * 하드 게이트 2: 복호화된 게이트웨이·프로필 토큰은 응답 본문에 실리지 않는다.
 *
 * 2026-09-15 실측으로 세 군데가 이 게이트를 깨고 있었다 —
 * `GET /api/channels/:id/gateway`, `GET /api/gateways/:id`, `PATCH /api/gateways/:id` 가
 * `token: decryptGatewayToken(...)` 를 그대로 돌려줬다. 소유자에게만 준다는 조건이 붙어도
 * 브라우저 메모리·프록시 로그·확장 프로그램으로 흘러간다.
 *
 * 이 테스트는 라우트 소스에서 "응답 객체에 token 키를 담는" 모양을 금지한다. 서버가
 * Hermes 를 부르려고 복호화하는 것(변수·함수 인자)은 막지 않는다.
 */
const API_DIR = path.join(process.cwd(), "src", "app", "api");

/**
 * `token:` 필드에 복호화된 값을 담는 줄을 전부 잡는다.
 *
 * 응답 객체가 `NextResponse.json(...)` 안에 직접 쓰였는지, 헬퍼가 만들어 돌려주는지는 구분하지
 * 않는다 — 2026-09-15 에 실제로 샌 곳(`buildResponseGatewayConfig`)이 바로 헬퍼였다.
 *
 * 서버가 Hermes 를 부르려고 복호화해 **함수 인자로** 넘기는 것은 정상이므로, 그런 줄에는
 * 바로 위에 `deskrpg-allow-token-arg` 주석을 달아 명시적으로 면제한다. 면제는 눈에 보여야 한다.
 */
const ALLOW_MARKER = "deskrpg-allow-token-arg";

function findDecryptedTokenFields(source: string): number[] {
  const lines = source.split("\n");
  const hits: number[] = [];
  lines.forEach((line, index) => {
    if (!/(^|[^A-Za-z])token:/.test(line)) return;
    // 포매터가 `token:` 과 값을 다른 줄로 나눈다 — 뒤 두 줄까지 한 문장으로 본다.
    const statement = lines.slice(index, index + 3).join("\n");
    if (!statement.includes("decryptGatewayToken")) return;
    const previous = lines.slice(Math.max(0, index - 3), index).join("\n");
    if (previous.includes(ALLOW_MARKER) || statement.includes(ALLOW_MARKER)) return;
    hits.push(index + 1);
  });
  return hits;
}

function* walk(dir: string): Generator<string> {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) yield full;
  }
}

test("API 라우트는 복호화된 게이트웨이 토큰을 응답에 싣지 않는다", () => {
  const offenders: string[] = [];
  for (const file of walk(API_DIR)) {
    for (const line of findDecryptedTokenFields(fs.readFileSync(file, "utf8"))) {
      offenders.push(`${path.relative(process.cwd(), file)}:${line}`);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `복호화된 토큰을 응답 필드로 내보내는 곳: ${offenders.join(", ")}\n` +
      "저장 여부만 필요하다면 hasToken 같은 불리언으로 바꾸세요.",
  );
});
