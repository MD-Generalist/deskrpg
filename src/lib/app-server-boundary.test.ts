import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

/**
 * Next 앱 코드(`src/app/**`, `src/lib/**`)는 소켓 서버 모듈(`src/server/**`)을 import 하지 않는다.
 *
 * 왜 이 테스트가 필요한가: 실제 사고가 있었다. `kanban-routes.ts` 가 `@/server/automation-events`
 * 를, 게이트웨이 라우트가 `@/server/automation-poller` 를 import 하자 `socket-handlers.ts` 가
 * Next/Turbopack 번들로 끌려왔고, 그 파일의 `.js` 확장자 상대 import(tsx 런타임용)가
 * "Module not found" 5건으로 `npm run build` 를 깨뜨렸다. `npm run test` 도 `tsc` 도 잡지 못한다.
 *
 * 소켓 서버 쪽 기능이 라우트에 필요하면 `automation-registry.ts` 같은 `globalThis` 레지스트리를
 * 거친다(`rpc-registry.ts` 와 같은 무늬). 타입만 필요해도 서버 모듈이 아니라 lib 쪽에 둔다.
 */

const SRC = path.join(process.cwd(), "src");
const SCAN_DIRS = ["app", "lib"].map((d) => path.join(SRC, d));

function listFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) listFiles(full, out);
    else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\.(ts|tsx)$/.test(entry.name))
      out.push(full);
  }
  return out;
}

// 정적 import 와 동적 import() 둘 다 본다 — 동적이라도 번들러는 따라간다.
const IMPORT_RE =
  /(?:^|\n)\s*(?:import|export)\s+(?:[^"';]*?\sfrom\s+)?["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g;

function importsOf(file: string): string[] {
  const src = fs.readFileSync(file, "utf8");
  const found: string[] = [];
  for (const m of src.matchAll(IMPORT_RE)) found.push(m[1] ?? m[2]);
  return found;
}

function pointsAtServer(spec: string, fromFile: string): boolean {
  if (/^@\/server(\/|$)/.test(spec)) return true;
  if (!spec.startsWith(".")) return false;
  const target = path.resolve(path.dirname(fromFile), spec);
  const rel = path.relative(path.join(SRC, "server"), target);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

test("src/app 와 src/lib 는 src/server 를 import 하지 않는다", () => {
  const files = SCAN_DIRS.flatMap((d) => listFiles(d));
  assert.ok(files.length > 50, `탐색이 깨졌다 — 파일 ${files.length}개만 찾았다`);

  const violations: string[] = [];
  for (const file of files) {
    for (const spec of importsOf(file)) {
      if (pointsAtServer(spec, file)) violations.push(`${path.relative(SRC, file)} → ${spec}`);
    }
  }

  assert.deepEqual(
    violations,
    [],
    `Next 앱 코드가 소켓 서버 모듈을 끌어온다 (빌드가 깨진다 — 레지스트리를 거칠 것):\n  ${violations.join("\n  ")}`,
  );
});
