import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

/**
 * `"use client"` 파일에서 시작해 import 를 따라가며, 서버 전용 모듈이 클라이언트
 * 번들로 끌려오는 경로가 있는지 본다.
 *
 * 왜 이 테스트가 필요한가: 같은 부류로 실제 사고가 있었다. `plugin-capability.ts` 가
 * `@/db` 를 import 하자 pg·better-sqlite3 가 브라우저 번들에 실려 화면이 백지가 됐다.
 * `npm run test` 도 `tsc` 도 그걸 잡지 못한다 — 타입은 맞고 런타임은 서버에서만 돈다.
 * 번들러의 트리셰이킹이 가려 줄 때도 있어서 "지금 안 깨진다" 는 근거가 되지 않는다.
 */

const SRC = path.join(process.cwd(), "src");
const SERVER_ONLY_SPECIFIERS = [
  /^node:/,
  /^@\/db(\/|$)/,
  /^better-sqlite3$/,
  /^pg$/,
  /^drizzle-orm\/node-postgres$/,
];

function listFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) listFiles(full, out);
    else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\.(ts|tsx)$/.test(entry.name))
      out.push(full);
  }
  return out;
}

const IMPORT_RE = /(?:^|\n)\s*import\s+(?:[^"';]*?\sfrom\s+)?["']([^"']+)["']/g;

function importsOf(file: string): string[] {
  const src = fs.readFileSync(file, "utf8");
  const found: string[] = [];
  for (const m of src.matchAll(IMPORT_RE)) found.push(m[1]);
  return found;
}

function resolve(spec: string, fromFile: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = path.join(SRC, spec.slice(2));
  else if (spec.startsWith(".")) base = path.resolve(path.dirname(fromFile), spec);
  else return null; // 외부 패키지는 파일로 따라가지 않는다
  for (const cand of [
    base + ".ts",
    base + ".tsx",
    path.join(base, "index.ts"),
    path.join(base, "index.tsx"),
  ]) {
    if (fs.existsSync(cand)) return cand;
  }
  return null;
}

function isServerOnly(spec: string): boolean {
  return SERVER_ONLY_SPECIFIERS.some((re) => re.test(spec));
}

test("클라이언트 컴포넌트에서 서버 전용 모듈로 가는 import 경로가 없다", () => {
  const files = listFiles(SRC);
  const clientEntries = files.filter((f) => {
    const head = fs.readFileSync(f, "utf8").slice(0, 200);
    return /^\s*["']use client["']/.test(head);
  });
  assert.ok(clientEntries.length > 0, '"use client" 파일을 하나도 못 찾았다 — 탐색이 깨졌다');

  const violations: string[] = [];
  for (const entry of clientEntries) {
    const seen = new Set<string>();
    // [파일, 여기까지 온 경로]
    const stack: Array<[string, string[]]> = [[entry, [path.relative(SRC, entry)]]];
    while (stack.length > 0) {
      const [file, trail] = stack.pop()!;
      if (seen.has(file)) continue;
      seen.add(file);
      for (const spec of importsOf(file)) {
        if (isServerOnly(spec)) {
          violations.push(`${trail.join(" → ")} → ${spec}`);
          continue;
        }
        const next = resolve(spec, file);
        if (next) stack.push([next, [...trail, path.relative(SRC, next)]]);
      }
    }
  }

  assert.deepEqual(
    violations,
    [],
    `클라이언트 번들이 서버 전용 모듈을 끌어온다:\n  ${violations.join("\n  ")}`,
  );
});
