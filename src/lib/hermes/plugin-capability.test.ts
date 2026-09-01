import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { describe, it } from "node:test";

import { classifyPluginProbe, probeDeskrpgPlugin, shouldReprobePlugin } from "./plugin-capability";
import type {
  PluginCapability,
  buildPluginCacheUpdate as BuildPluginCacheUpdateFn,
} from "./plugin-capability";

const require = createRequire(import.meta.url);

// PostgreSQL: `timestamp(withTimezone)` 컬럼은 date 모드라 드라이버가 `Date` 를 기대한다.
// SQLite: `text` 컬럼은 문자열을 기대한다. `buildPluginCacheUpdate()` 는 이제 스스로
// `nowForDb()` 를 부르므로(호출자가 값을 주입할 자리가 없다 — Task 9 라운드 3), 그
// 방언 분기를 관찰하려면 `nowForDb()` 가 캡처된 시점의 `src/db/index.ts` 자체를
// 다시 읽어야 한다. `isPostgres` 는 그 모듈 로드 시점의 상수라
// (task-manager-timestamps.test.ts 와 같은 사고), require 캐시를 지우고 환경변수를
// 바꿔 같은 프로세스 안에서 `db/index.ts` 와 `plugin-capability.ts` 를 함께
// 다시 읽는다 — plugin-capability.ts 의 `import { nowForDb } from "@/db"` 가 새로
// 읽힌 db/index.ts 를 다시 가리키게 하기 위해서다.
function loadBuildPluginCacheUpdate(env: {
  DB_TYPE: string;
  DATABASE_URL?: string;
}): typeof BuildPluginCacheUpdateFn {
  const prevDbType = process.env.DB_TYPE;
  const prevDatabaseUrl = process.env.DATABASE_URL;
  process.env.DB_TYPE = env.DB_TYPE;
  if (env.DATABASE_URL) process.env.DATABASE_URL = env.DATABASE_URL;
  else delete process.env.DATABASE_URL;

  const dbModulePath = require.resolve("../../db/index.ts");
  const pluginCapabilityModulePath = require.resolve("./plugin-capability.ts");
  delete require.cache[dbModulePath];
  delete require.cache[pluginCapabilityModulePath];
  const { buildPluginCacheUpdate } = require("./plugin-capability.ts") as {
    buildPluginCacheUpdate: typeof BuildPluginCacheUpdateFn;
  };

  if (prevDbType === undefined) delete process.env.DB_TYPE;
  else process.env.DB_TYPE = prevDbType;
  if (prevDatabaseUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = prevDatabaseUrl;

  return buildPluginCacheUpdate;
}

describe("classifyPluginProbe", () => {
  // 401 과 404 를 뭉치면 사용자가 할 일이 사라진다 — 전자는 키 교체,
  // 후자는 게이트웨이 머신에 플러그인 설치다.
  const cases: Array<[string, { status: number; body: unknown }, string, string | null]> = [
    [
      "200 이면 준비됨",
      { status: 200, body: { plugin: "deskrpg", version: "0.3.0" } },
      "plugin_ready",
      "0.3.0",
    ],
    [
      "200 인데 version 이 없으면 준비됐지만 버전은 모른다",
      { status: 200, body: { plugin: "deskrpg" } },
      "plugin_ready",
      null,
    ],
    ["401 은 키 문제", { status: 401, body: {} }, "plugin_unauthorized", null],
    ["403 도 키 문제로 본다", { status: 403, body: {} }, "plugin_unauthorized", null],
    ["404 는 플러그인 부재", { status: 404, body: {} }, "plugin_absent", null],
    ["500 은 모른다 — 기능을 켜지 않는다", { status: 500, body: {} }, "unknown", null],
    [
      "200 인데 본문이 우리 플러그인이 아니면 모른다",
      { status: 200, body: { hello: "world" } },
      "unknown",
      null,
    ],
    ["200 인데 본문이 객체가 아니면 모른다", { status: 200, body: "ok" }, "unknown", null],
  ];

  for (const [name, input, status, version] of cases) {
    it(name, () => {
      const got = classifyPluginProbe(input);
      assert.equal(got.status, status);
      assert.equal(got.version, version);
    });
  }
});

describe("probeDeskrpgPlugin", () => {
  it("게이트웨이 스코프 경로를 Bearer 토큰으로 부른다", async () => {
    const seen: Array<{ url: string; auth: string | null }> = [];
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      seen.push({
        url: String(url),
        auth: new Headers(init?.headers).get("authorization"),
      });
      return new Response(JSON.stringify({ plugin: "deskrpg", version: "0.3.0" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;

    const got = await probeDeskrpgPlugin({
      baseUrl: "http://gw.example:8642/",
      token: "default-key-1234567890",
      fetchImpl,
    });

    assert.equal(got.status, "plugin_ready");
    assert.equal(got.version, "0.3.0");
    // 프리픽스가 붙으면 프로필 스코프가 되어 default 키로는 401 이 난다.
    assert.equal(seen[0].url, "http://gw.example:8642/deskrpg/info");
    assert.equal(seen[0].auth, "Bearer default-key-1234567890");
  });

  it("JSON 이 아니어도 던지지 않고 unknown 을 돌려준다", async () => {
    const fetchImpl = (async () =>
      new Response("<html>dashboard</html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      })) as unknown as typeof fetch;

    const got = await probeDeskrpgPlugin({ baseUrl: "http://x", token: "t", fetchImpl });
    assert.equal(got.status, "unknown");
  });

  it("도달 실패는 unknown 이다 — 예외를 밖으로 던지지 않는다", async () => {
    const fetchImpl = (async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;

    const got = await probeDeskrpgPlugin({ baseUrl: "http://x", token: "t", fetchImpl });
    assert.equal(got.status, "unknown");
  });

  // M-1: 이 시그널·타이머 배선을 전부 제거해도 기존 테스트가 통과했다(격리 사본 실측).
  // fetchImpl 이 signal 의 abort 를 실제로 기다리게 해서 신호가 정말 전달되는지 물게 한다.
  it("timeoutMs 안에 응답이 없으면 신호를 중단시켜 unknown 을 돌려준다", async () => {
    const fetchImpl = ((_url: string, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          const err = new Error("aborted");
          err.name = "AbortError";
          reject(err);
        });
      })) as unknown as typeof fetch;

    const got = await probeDeskrpgPlugin({
      baseUrl: "http://x",
      token: "t",
      fetchImpl,
      timeoutMs: 5,
    });
    assert.equal(got.status, "unknown");
  });
});

describe("shouldReprobePlugin", () => {
  const now = new Date("2026-09-01T00:00:00Z");

  it("한 번도 찌른 적 없으면 찌른다", () => {
    assert.equal(shouldReprobePlugin({ checkedAt: null, now }), true);
  });

  it("최근에 찔렀으면 다시 찌르지 않는다", () => {
    assert.equal(shouldReprobePlugin({ checkedAt: "2026-08-31T23:50:00Z", now }), false);
  });

  it("오래됐으면 다시 찌른다 — 플러그인은 나중에 설치될 수 있다", () => {
    assert.equal(shouldReprobePlugin({ checkedAt: "2026-08-30T00:00:00Z", now }), true);
  });

  it("깨진 타임스탬프는 찌른다 — 모르면 확인하는 쪽이 안전하다", () => {
    assert.equal(shouldReprobePlugin({ checkedAt: "not-a-date", now }), true);
  });

  // PG 판정 E: PostgreSQL 은 pluginCheckedAt 을 Date 객체로 돌려준다 — 문자열만 받으면
  // 스테이징에서 이 분기가 항상 "다시 찌른다"로 새서 캐시가 무력화된다.
  it("Date 객체로 들어와도 최근이면 다시 찌르지 않는다 (PG 방언)", () => {
    assert.equal(shouldReprobePlugin({ checkedAt: new Date("2026-08-31T23:50:00Z"), now }), false);
  });

  it("Date 객체로 들어와도 오래됐으면 다시 찌른다 (PG 방언)", () => {
    assert.equal(shouldReprobePlugin({ checkedAt: new Date("2026-08-30T00:00:00Z"), now }), true);
  });
});

// 판정 D·F 회귀 방어: 게이트웨이 테스트 라우트가 db.update(...).set(...) 에 넘길 payload 의
// 값 TYPE 을 방언별로 고정한다. `nowForDb()` 를 `new Date().toISOString()` 으로 되돌리면
// PG 방언 케이스가 실패해야 한다 — 실제로 되돌려 확인함(task-9-report.md 참조).
describe("buildPluginCacheUpdate", () => {
  const plugin: PluginCapability = { status: "plugin_ready", version: "0.3.0" };

  // 라운드 2 까지는 `now` 를 호출자가 주입했다 — 그래서 호출부(route.ts)가
  // `new Date().toISOString()` 같은 방언-무관 값을 대신 넘겨도 이 테스트는 그
  // 실수를 못 잡았다(실제로 실증됨). 이제 함수가 스스로 nowForDb() 를 부르므로,
  // 호출부는 `buildPluginCacheUpdate(plugin)` 외의 선택지가 없다 — 여기서 물리면
  // 실제 코드 경로(함수 몸통 안의 nowForDb() 호출)를 보는 것이다.
  it("PostgreSQL 방언: 스스로 부른 nowForDb() 가 Date 를 낸다", () => {
    const buildPluginCacheUpdate = loadBuildPluginCacheUpdate({
      DB_TYPE: "postgresql",
      DATABASE_URL: "postgres://fake:fake@localhost:5432/fake",
    });

    const payload = buildPluginCacheUpdate(plugin);
    assert.ok(payload.pluginCheckedAt instanceof Date, "PG 방언에서는 Date 여야 한다");
    assert.ok(payload.updatedAt instanceof Date);
  });

  it("SQLite 방언: 스스로 부른 nowForDb() 가 ISO 문자열을 낸다", () => {
    const buildPluginCacheUpdate = loadBuildPluginCacheUpdate({ DB_TYPE: "sqlite" });

    const payload = buildPluginCacheUpdate(plugin);
    assert.equal(typeof payload.pluginCheckedAt, "string", "SQLite 방언에서는 문자열이어야 한다");
    assert.equal(typeof payload.updatedAt, "string");
  });
});
