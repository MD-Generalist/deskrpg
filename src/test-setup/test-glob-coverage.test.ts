import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

/**
 * `npm run test` 의 글롭이 **모든 테스트 파일을 실제로 집는지** 확인한다.
 *
 * 왜 필요한가: 글롭에서 대괄호는 문자 클래스다. `src/**\/*.test.ts` 는 Next 의 동적 경로
 * 폴더(`[id]`, `[name]`)를 지나가지 못해, 그 안의 테스트가 **한 번도 실행되지 않은 채**
 * 초록으로 보였다(2026-09-18 실측: `src/app/api/npcs/[id]/placement-route.test.ts` 3개).
 * 안 돌아가는 테스트는 없는 테스트보다 나쁘다 — 있다고 믿게 만든다.
 */
test("테스트 글롭이 src 의 모든 테스트 파일을 집는다", () => {
  const root = process.cwd();
  const script = String(
    (
      JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")) as {
        scripts: Record<string, string>;
      }
    ).scripts.test,
  );
  const patterns = [...script.matchAll(/"([^"]*\*[^"]*)"/g)].map((match) => match[1]);
  assert.ok(patterns.length > 0, "test 스크립트에서 글롭을 찾지 못했다");

  // `fs.globSync` 는 Node 22 에 있지만 @types/node 가 아직 노출하지 않는다.
  const globSync = (
    fs as unknown as {
      globSync: (pattern: string, options: { cwd: string }) => string[];
    }
  ).globSync;
  const matched = new Set<string>();
  for (const pattern of patterns) {
    for (const file of globSync(pattern, { cwd: root })) matched.add(String(file));
  }

  const found: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
      const rel = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(rel);
      else if (/\.test\.(ts|tsx|js)$/.test(entry.name)) found.push(rel);
    }
  };
  walk("src");

  const missed = found.filter((file) => !matched.has(file));
  assert.deepEqual(missed, [], `글롭이 지나친 테스트 파일: ${missed.join(", ")}`);
});
