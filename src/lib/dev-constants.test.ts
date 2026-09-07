import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { DEV_JWT_SECRET } from "./dev-constants";

test("DEV_JWT_SECRET is a non-empty string", () => {
  assert.equal(typeof DEV_JWT_SECRET, "string");
  assert.ok(DEV_JWT_SECRET.length > 0);
  assert.ok(DEV_JWT_SECRET.includes("do-not-use-in-production"));
});

/**
 * 이 테스트는 원래 "consistent across imports" 라는 이름으로 두 모듈을 `await import`
 * 했지만, **가져온 값을 쓰지 않고** 앞 테스트와 같은 단언만 했다. 즉 이름이 주장하는
 * 것을 한 번도 검증하지 않았고, 어떤 회귀로도 빨개질 수 없었다(2026-09-08 발견).
 *
 * 공유는 구조적으로 보장된다 — `jwt.ts` 와 `gateway-resources.ts` 가 둘 다
 * `./dev-constants` 에서 가져온다. 깨지는 경로는 하나뿐이다: 누군가 그 리터럴을
 * 자기 파일에 다시 적는 것. 그러면 한쪽 비밀만 바뀌어 토큰이 조용히 서로 안 맞는다.
 * 그래서 검사하는 것도 그것이다.
 */
test("개발용 비밀 리터럴은 dev-constants.ts 에만 있다", () => {
  const libDir = path.dirname(fileURLToPath(import.meta.url));
  const srcDir = path.resolve(libDir, "..");
  const offenders: string[] = [];

  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!/\.(ts|tsx|js|cjs|mjs)$/.test(entry.name)) continue;
      if (full === path.join(libDir, "dev-constants.ts")) continue;
      if (full === fileURLToPath(import.meta.url)) continue;
      if (readFileSync(full, "utf8").includes(DEV_JWT_SECRET)) {
        offenders.push(path.relative(srcDir, full));
      }
    }
  };
  walk(srcDir);

  assert.deepEqual(
    offenders,
    [],
    "개발용 비밀을 직접 적은 파일이 있습니다 — dev-constants 에서 가져오세요:\n  " +
      offenders.join("\n  "),
  );
});
